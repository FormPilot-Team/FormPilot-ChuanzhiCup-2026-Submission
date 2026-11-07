"""M2 research on DEV families only (frozen test families are never touched here).

Run (apps/platform):
  python -I -B scripts/decision-model/cdm/research_m2.py --matrix <m2-matrix.json> --labels ai --ai-labels <file> --out <dir>
Experiments: feature-group & M1 ablations, simple learned baselines, learning curve, label-noise robustness,
calibration (ECE), abstain coverage/precision curve, cross-programme ranker generalisation.
All numbers are grouped 6-fold CV over the 18 dev families with family-level bootstrap CIs.
"""
import argparse, hashlib, json, math, os, sys, time
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_m2 import Ranker, scenario_metrics, summarise  # noqa: E402

SEED = 20261107
PROGRAMME = {'bdj': 'baduanjin', 'tjq': 'taijiquan', 'wqx': 'wuqinxi', 'yjj': 'yijinjing'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matrix', required=True); ap.add_argument('--labels', choices=['ai', 'human'], required=True)
    ap.add_argument('--ai-labels'); ap.add_argument('--labels-dir'); ap.add_argument('--out', required=True)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); t0 = time.time()
    M = json.load(open(a.matrix, encoding='utf-8')); names, groups = M['featureNames'], M['featureGroups']
    rows = [r for r in M['rows'] if r['split'] == 'dev']
    X = np.array([r['features'] for r in rows], float)
    scen = np.array([r['scenarioId'] for r in rows]); fam = np.array([r['familyId'] for r in rows]); cand = np.array([r['candidateId'] for r in rows])
    cond = np.array([r['condition'] for r in rows]); p0 = np.array([r['p0Rank'] for r in rows]); pr = np.array([r['pr49Rank'] for r in rows])
    if a.labels == 'ai':
        L = json.load(open(a.ai_labels, encoding='utf-8')); lab = {(l['scenarioId'], l['candidateId']): l['grade'] for l in L['labels']}
        label_kind = 'ai_single_annotator'
    else:
        L = json.load(open(os.path.join(a.labels_dir, 'final-labels.v1.json'), encoding='utf-8')); lab = {(l['scenarioId'], l['candidateId']): l['grade'] for l in L['labels']}
        label_kind = 'human'
    y = np.array([lab[(s, c)] for s, c in zip(scen, cand)], float)
    fams = sorted(set(fam)); fold = {f: i % 6 for i, f in enumerate(fams)}
    foldv = np.array([fold[f] for f in fam])

    def cols(pred):
        return [i for i, n in enumerate(names) if pred(n)]
    SETS = {
        'P': cols(lambda n: groups[n] == 'P'),
        'P_no_m1': cols(lambda n: groups[n] == 'P' and 'm1' not in n),
        'PH': cols(lambda n: groups[n] in ('P', 'H')),
        'PHR': cols(lambda n: True),
        'PHR_no_m1': cols(lambda n: 'm1' not in n),
        'PHR_crosses_only': cols(lambda n: not n.startswith('c_')),
        'tiny_3feat': [names.index(n) for n in ('x_region_f1', 'x_pref_kind_match', 'c_caution_count')],
    }

    def cv(c, family='pairwise_lr', hp=0.01, ylab=None, train_mask=None, eval_mask=None):
        ylab = y if ylab is None else ylab
        oof = np.full(len(rows), np.nan)
        for k in range(6):
            tr = (foldv != k) & (train_mask if train_mask is not None else True)
            va = (foldv == k) & (eval_mask if eval_mask is not None else True)
            if va.sum() == 0: continue
            oof[va] = Ranker(family, hp).fit(X[tr][:, c], ylab[tr], scen[tr]).score(X[va][:, c])
        return oof

    def per_scen(scores, mask=None, ylab=None):
        ylab = y if ylab is None else ylab
        out = []
        for s in np.unique(scen):
            k = np.where((scen == s) & (mask if mask is not None else True))[0]
            if len(k) < 2: continue
            order = sorted(range(len(k)), key=lambda i: (-scores[k[i]], i))
            m = scenario_metrics(list(ylab[k]), order); m['family'] = fam[k[0]]; out.append(m)
        return out

    rng = np.random.default_rng(SEED)
    def boot(per, key='ndcg@5', n=1000):
        fs = sorted({m['family'] for m in per}); vals = []
        for _ in range(n):
            smp = rng.choice(fs, size=len(fs), replace=True)
            v = [m[key] for f in smp for m in per if m['family'] == f and m[key] is not None]
            vals.append(np.mean(v))
        return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
    def row(per):
        s = summarise(per); s['ndcg@5_ci95'] = boot(per); return s

    res = {'labels': label_kind, 'devFamilies': len(fams), 'devScenarios': int(len(np.unique(scen))), 'matrixSha256': hashlib.sha256(open(a.matrix, 'rb').read()).hexdigest()}
    # 1. feature-group / M1 ablations (+ baselines on the same scenarios)
    res['ablation'] = {name: row(per_scen(cv(c))) for name, c in SETS.items()}
    res['ablation']['rules_p0'] = row(per_scen(-p0.astype(float)))
    res['ablation']['pr49_manual_ranker'] = row(per_scen(-pr.astype(float)))
    res['ablationOnHistoryReportScenarios'] = {name: summarise(per_scen(cv(SETS[name]), mask=(cond == 'C_history_report'))) for name in ('P', 'PH', 'PHR')}
    # 2. learning curve: train on the first k dev folds' complement subsets
    lc = {}
    for k_keep in (1, 2, 3, 4, 5):
        oof = np.full(len(rows), np.nan)
        for k in range(6):
            others = [f for f in range(6) if f != k][:k_keep]
            tr = np.isin(foldv, others); va = foldv == k
            oof[va] = Ranker('pairwise_lr', 0.01).fit(X[tr][:, SETS['PHR']], y[tr], scen[tr]).score(X[va][:, SETS['PHR']])
        lc[f'{k_keep * 3}_train_families'] = summarise(per_scen(oof))['ndcg@5']
    res['learningCurveNdcg5'] = lc
    # 3. label-noise robustness: perturb TRAIN labels by +/-1 on p% of items, evaluate on clean labels
    noise = {}
    for p in (0.1, 0.2, 0.3):
        vals = []
        for rep in range(5):
            r2 = np.random.default_rng(SEED + rep)
            yn = y.copy(); idx = r2.random(len(y)) < p
            yn[idx] = np.clip(yn[idx] + r2.choice([-1, 1], size=idx.sum()), 0, 3)
            vals.append(summarise(per_scen(cv(SETS['PHR'], ylab=yn)))['ndcg@5'])
        noise[f'{int(p * 100)}pct'] = {'meanNdcg5': float(np.mean(vals)), 'min': float(np.min(vals)), 'max': float(np.max(vals))}
    res['labelNoiseRobustness'] = noise
    # 4. calibration of suitability (P(label>=2)) on OOF scores, cross-fitted Platt
    oof = cv(SETS['PHR']); prob = np.zeros(len(rows))
    for k in range(6):
        tr, va = foldv != k, foldv == k
        pl = LogisticRegression().fit(oof[tr].reshape(-1, 1), (y[tr] >= 2).astype(int))
        prob[va] = pl.predict_proba(oof[va].reshape(-1, 1))[:, 1]
    bins = np.linspace(0, 1, 11); ece = 0.0; table = []
    for i in range(10):
        m = (prob >= bins[i]) & (prob < bins[i + 1] if i < 9 else prob <= 1)
        if m.sum():
            gap = abs(prob[m].mean() - (y[m] >= 2).mean()); ece += m.sum() / len(prob) * gap
            table.append({'bin': f'{bins[i]:.1f}-{bins[i + 1]:.1f}', 'n': int(m.sum()), 'meanPredicted': float(prob[m].mean()), 'observedSuitable': float((y[m] >= 2).mean())})
    res['calibration'] = {'ece10': float(ece), 'reliability': table, 'brier': float(np.mean((prob - (y >= 2)) ** 2)), 'baseRate': float((y >= 2).mean())}
    # 5. abstain curve: top-1 suitability threshold vs coverage and top-1 precision (label>=2)
    top = []
    for s in np.unique(scen):
        k = np.where(scen == s)[0]; i = k[np.argmax(oof[k])]; top.append((prob[i], y[i] >= 2, y[i] == y[k].max()))
    curve = []
    for t in np.linspace(0, 0.95, 20):
        kept = [x for x in top if x[0] >= t]
        if kept: curve.append({'threshold': round(float(t), 2), 'coverage': len(kept) / len(top), 'top1Suitable': float(np.mean([x[1] for x in kept])), 'top1IsBest': float(np.mean([x[2] for x in kept]))})
    res['abstainCurve'] = curve
    # 6. cross-programme ranker generalisation: train without one programme's chapters, rank that programme's chapters
    xg = {}
    for code, prog in PROGRAMME.items():
        is_prog = np.array([c.startswith(code + '-') for c in cand])
        if is_prog.sum() < 10: continue
        oofp = cv(SETS['PHR'], train_mask=~is_prog, eval_mask=is_prog)
        per = per_scen(oofp, mask=is_prog); per_p0 = per_scen(-p0.astype(float), mask=is_prog); per_pr = per_scen(-pr.astype(float), mask=is_prog)
        if not per: continue
        xg[prog] = {'scenarios': len(per), 'model_ndcg5': summarise(per)['ndcg@5'], 'model_pairacc': summarise(per)['pairwise_acc'],
                    'rules_p0_ndcg5': summarise(per_p0)['ndcg@5'], 'pr49_ndcg5': summarise(per_pr)['ndcg@5']}
    res['crossProgrammeRanker'] = xg
    res['seconds'] = round(time.time() - t0, 1)
    json.dump(res, open(os.path.join(a.out, f'm2-research-{label_kind}.json'), 'w', encoding='utf-8'), indent=1)
    f = lambda v: '-' if v is None else f'{v:.3f}'
    for k, v in res['ablation'].items(): print('ABL', k.ljust(20), 'ndcg5', f(v['ndcg@5']), v['ndcg@5_ci95'] and [round(x, 3) for x in v['ndcg@5_ci95']], 'pair', f(v['pairwise_acc']))
    print('C-cond', {k: round(v['ndcg@5'], 3) for k, v in res['ablationOnHistoryReportScenarios'].items()})
    print('LC', {k: round(v, 3) for k, v in lc.items()}); print('NOISE', {k: round(v['meanNdcg5'], 3) for k, v in noise.items()})
    print('CAL ece', round(ece, 4), 'brier', round(res['calibration']['brier'], 4)); print('ABST', [(c['threshold'], round(c['coverage'], 2), round(c['top1IsBest'], 2)) for c in curve[::4]])
    print('XPROG', json.dumps({k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in xg.items()}))


if __name__ == '__main__':
    main()
