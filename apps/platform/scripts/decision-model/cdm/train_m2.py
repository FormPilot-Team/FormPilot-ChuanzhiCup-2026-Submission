"""M2 fp-cdm pairwise preference ranker: training, selection, calibration, frozen test, ablation (E1/E3/E6).

Run (apps/platform):
  python -I -B scripts/decision-model/cdm/train_m2.py --labels human   --labels-dir <dir> --out <dir>
  python -I -B scripts/decision-model/cdm/train_m2.py --labels planted --seed 1 --out <dir>   # pipeline validation only
  python -I -B scripts/decision-model/cdm/train_m2.py --labels null    --seed 1 --out <dir>   # leakage control only

Labels: ONLY human graded judgments (final-labels.v1.json from ingest_labels.py) produce a model. 'planted'
labels come from a random hidden linear function of the features (not from any design rule) and 'null'
labels are random; both exist to prove the pipeline can learn a planted signal and cannot learn noise.
Split: families fixed in scenarios.v1.json before labels existed (6 test families, 18 dev families).
"""
import argparse, hashlib, json, math, os, sys, time
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20261107
FEATURE_SETS = {'A_profile': ['P'], 'B_profile_history': ['P', 'H'], 'C_profile_history_report': ['P', 'H', 'R']}
CONFIGS = [('pairwise_lr', c) for c in (0.003, 0.01, 0.03, 0.1, 0.3, 1.0)] + [('pointwise_ridge', a) for a in (1.0, 10.0, 100.0)] + [('pointwise_hgb', d) for d in (2, 3)]


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


# ---------------- metrics ----------------
def dcg(gains):
    return sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(gains))


def scenario_metrics(labels, order):
    """labels: array per candidate; order: candidate indices, best first."""
    ranked = [labels[i] for i in order]
    ideal = sorted(labels, reverse=True)
    rel = [l >= 2 for l in labels]
    nrel = sum(rel)
    out = {}
    for k in (3, 5):
        idcg = dcg(ideal[:k])
        out[f'ndcg@{k}'] = dcg(ranked[:k]) / idcg if idcg > 0 else None
        out[f'p@{k}'] = sum(l >= 2 for l in ranked[:k]) / k
        out[f'r@{k}'] = sum(l >= 2 for l in ranked[:k]) / nrel if nrel else None
    pos = {c: i for i, c in enumerate(order)}
    agree = total = 0.0
    for i in range(len(labels)):
        for j in range(len(labels)):
            if labels[i] - labels[j] >= 1:
                total += 1
                agree += 1.0 if pos[i] < pos[j] else 0.0
    out['pairwise_acc'] = agree / total if total else None
    return out


def summarise(per):
    keys = ['ndcg@3', 'ndcg@5', 'p@3', 'p@5', 'r@3', 'r@5', 'pairwise_acc']
    return {k: (float(np.mean([m[k] for m in per if m[k] is not None])) if any(m[k] is not None for m in per) else None) for k in keys}


# ---------------- models ----------------
def pairs(X, y, groups):
    rows, targets, weights = [], [], []
    for g in np.unique(groups):
        idx = np.where(groups == g)[0]
        for a in idx:
            for b in idx:
                d = y[a] - y[b]
                if d >= 1:
                    rows.append(X[a] - X[b]); targets.append(1); weights.append(d)
                    rows.append(X[b] - X[a]); targets.append(0); weights.append(d)
    return np.array(rows), np.array(targets), np.array(weights)


class Ranker:
    def __init__(self, family, hp):
        self.family, self.hp = family, hp

    def fit(self, X, y, groups):
        self.scaler = StandardScaler().fit(X)
        Z = self.scaler.transform(X)
        if self.family == 'pairwise_lr':
            P, t, w = pairs(Z, y, groups)
            self.model = LogisticRegression(C=self.hp, fit_intercept=False, max_iter=5000).fit(P, t, sample_weight=w)
            self.coef = self.model.coef_[0]
        elif self.family == 'pointwise_ridge':
            self.model = Ridge(alpha=self.hp).fit(Z, y)
            self.coef = self.model.coef_
        else:
            self.model = HistGradientBoostingRegressor(max_depth=self.hp, learning_rate=0.05, max_iter=200, min_samples_leaf=10, random_state=SEED).fit(Z, y)
            self.coef = None
        return self

    def score(self, X):
        Z = self.scaler.transform(X)
        return Z @ self.coef if self.coef is not None else self.model.predict(Z)


def rank_metrics(scores, y, scen):
    per = []
    for s in np.unique(scen):
        idx = np.where(scen == s)[0]
        order = sorted(range(len(idx)), key=lambda i: (-scores[idx[i]], i))
        per.append(scenario_metrics(list(y[idx]), order))
    return per


def baseline_metrics(ranks, y, scen):
    return rank_metrics(-ranks.astype(float), y, scen)


def bootstrap(per_fn, families, n=2000, seed=SEED):
    rng = np.random.default_rng(seed)
    fams = np.array(sorted(set(families)))
    vals = []
    for _ in range(n):
        sample = rng.choice(fams, size=len(fams), replace=True)
        v = per_fn(sample)
        if v is not None:
            vals.append(v)
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))] if vals else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', choices=['human', 'planted', 'null'], required=True)
    ap.add_argument('--labels-dir')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    mpath = os.path.join(HERE, 'data', 'm2-matrix.v1.json')
    M = json.load(open(mpath, encoding='utf-8'))
    names, groups_of = M['featureNames'], M['featureGroups']
    rows = M['rows']
    X = np.array([r['features'] for r in rows], float)
    scen = np.array([r['scenarioId'] for r in rows]); fam = np.array([r['familyId'] for r in rows])
    split = np.array([r['split'] for r in rows]); cond = np.array([r['condition'] for r in rows])
    p0 = np.array([r['p0Rank'] for r in rows]); pr = np.array([r['pr49Rank'] for r in rows])
    cand = np.array([r['candidateId'] for r in rows])
    per_annot = None
    if args.labels == 'human':
        L = json.load(open(os.path.join(args.labels_dir, 'final-labels.v1.json'), encoding='utf-8'))
        if L['scenarioSha256'] != M['scenarioSha256']:
            sys.exit('label/scenario sha mismatch')
        lab = {(l['scenarioId'], l['candidateId']): l for l in L['labels']}
        y = np.array([lab[(s, c)]['grade'] for s, c in zip(scen, cand)], float)
        a_ids = list(L['annotatorFiles'])
        per_annot = {a: np.array([lab[(s, c)][a] for s, c in zip(scen, cand)], float) for a in a_ids}
        label_info = {'kind': 'human', 'file_sha256': sha(os.path.join(args.labels_dir, 'final-labels.v1.json')), 'annotators': L['annotatorFiles'], 'unresolvedAdjudications': L['unresolvedAdjudications']}
    else:
        rng = np.random.default_rng(args.seed)
        if args.labels == 'planted':
            Z = StandardScaler().fit_transform(X)
            w = np.zeros(X.shape[1]); idx = rng.choice(X.shape[1], size=15, replace=False); w[idx] = rng.normal(size=15)
            u = Z @ w + rng.normal(scale=0.5 * np.std(Z @ w), size=len(rows))
            y = np.zeros(len(rows))
            for s in np.unique(scen):
                k = np.where(scen == s)[0]
                y[k] = np.floor(4 * (np.argsort(np.argsort(u[k])) / len(k))).clip(0, 3)
            label_info = {'kind': 'planted_random_linear_signal', 'seed': args.seed, 'plantedFeatures': [names[i] for i in idx]}
        else:
            y = rng.integers(0, 4, size=len(rows)).astype(float)
            label_info = {'kind': 'null_random_labels', 'seed': args.seed}

    dev, test = split == 'dev', split == 'test'
    dev_fams = sorted(set(fam[dev]))
    fold_of = {f: i % 6 for i, f in enumerate(dev_fams)}
    t0 = time.time()

    def cols(set_name):
        return [i for i, n in enumerate(names) if groups_of[n] in FEATURE_SETS[set_name]]

    def cv(set_name, family, hp):
        c = cols(set_name)
        oof = np.zeros(len(rows))
        for k in range(6):
            tr = dev & np.array([fold_of.get(f, -1) != k for f in fam])
            va = dev & np.array([fold_of.get(f, -1) == k for f in fam])
            m = Ranker(family, hp).fit(X[tr][:, c], y[tr], scen[tr])
            oof[va] = m.score(X[va][:, c])
        return oof

    selection, hgb_best = {}, {}
    for set_name in FEATURE_SETS:
        best = None
        for family, hp in CONFIGS:
            oof = cv(set_name, family, hp)
            s = summarise(rank_metrics(oof[dev], y[dev], scen[dev]))
            selection.setdefault(set_name, []).append({'family': family, 'hp': hp, **s})
            # Pre-declared (before human labels): only linear families are deployable in the browser, so the
            # exported/primary model is the best LINEAR config; the best HGB config is reported as offline comparison.
            if family != 'pointwise_hgb' and (best is None or s['ndcg@5'] > best[2]['ndcg@5'] + 1e-12):
                best = (family, hp, s, oof)
            if family == 'pointwise_hgb' and (set_name not in hgb_best or s['ndcg@5'] > hgb_best[set_name][1]['ndcg@5'] + 1e-12):
                hgb_best[set_name] = (hp, s)
        selection[set_name + '_chosen'] = {'family': best[0], 'hp': best[1], 'devCv': best[2]}
        selection[set_name + '_oof'] = best[3]

    # Calibration on dev out-of-fold scores of the main model (C).
    oofC = selection['C_profile_history_report_oof']
    fam_c, hp_c = selection['C_profile_history_report_chosen']['family'], selection['C_profile_history_report_chosen']['hp']
    diffs, wins = [], []
    for s in np.unique(scen[dev]):
        k = np.where((scen == s) & dev)[0]
        for a in k:
            for b in k:
                if y[a] - y[b] >= 1:
                    diffs.append(oofC[a] - oofC[b]); wins.append(1)
                    diffs.append(oofC[b] - oofC[a]); wins.append(0)
    diffs, wins = np.array(diffs), np.array(wins)
    def nll(T):
        p = 1 / (1 + np.exp(-diffs / T)); p = p.clip(1e-6, 1 - 1e-6)
        return float(-np.mean(wins * np.log(p) + (1 - wins) * np.log(1 - p)))
    temps = np.exp(np.linspace(np.log(0.05), np.log(20), 200))
    T = float(temps[int(np.argmin([nll(t) for t in temps]))])
    platt = LogisticRegression(C=1.0).fit(oofC[dev].reshape(-1, 1), (y[dev] >= 2).astype(int))
    suit = lambda s: platt.predict_proba(np.asarray(s).reshape(-1, 1))[:, 1]
    top = []
    for s in np.unique(scen[dev]):
        k = np.where((scen == s) & dev)[0]
        i = k[np.argmax(oofC[k])]
        top.append((float(suit([oofC[i]])[0]), y[i] >= 2))
    tau = 1.01
    for t in sorted({p for p, _ in top}):
        kept = [ok for p, ok in top if p >= t]
        if kept and np.mean(kept) >= 0.85:
            tau = float(t); break
    coverage = float(np.mean([p >= tau for p, _ in top]))

    # Frozen test: fit on all dev families, evaluate once.
    test_report, final_models = {}, {}
    for set_name in FEATURE_SETS:
        ch = selection[set_name + '_chosen']
        c = cols(set_name)
        m = Ranker(ch['family'], ch['hp']).fit(X[dev][:, c], y[dev], scen[dev])
        final_models[set_name] = (m, c)
        sc = m.score(X[test][:, c])
        per = rank_metrics(sc, y[test], scen[test])
        test_report[set_name] = {'all': summarise(per)}
        for cname in ('A_profile', 'B_history', 'C_history_report'):
            mask = cond[test] == cname
            test_report[set_name][cname] = summarise(rank_metrics(sc[mask], y[test][mask], scen[test][mask]))
    hp_h = hgb_best['C_profile_history_report'][0]
    mh = Ranker('pointwise_hgb', hp_h).fit(X[dev][:, cols('C_profile_history_report')], y[dev], scen[dev])
    test_report['C_offline_hgb_comparison'] = {'hp': hp_h, 'all': summarise(rank_metrics(mh.score(X[test][:, cols('C_profile_history_report')]), y[test], scen[test]))}
    for bname, ranks in (('rules_p0', p0), ('pr49_manual_ranker', pr)):
        per = baseline_metrics(ranks[test], y[test], scen[test])
        test_report[bname] = {'all': summarise(per)}
        for cname in ('A_profile', 'B_history', 'C_history_report'):
            mask = cond[test] == cname
            test_report[bname][cname] = summarise(baseline_metrics(ranks[test][mask], y[test][mask], scen[test][mask]))

    mC, cC = final_models['C_profile_history_report']
    scC = np.full(len(rows), np.nan); scC[test] = mC.score(X[test][:, cC])
    tfams = sorted(set(fam[test]))
    def metric_for(sample, scorer, key='ndcg@5'):
        vals = []
        for f in sample:
            for s in np.unique(scen[(fam == f) & test]):
                k = np.where(scen == s)[0]
                order = sorted(range(len(k)), key=lambda i: (-scorer(k)[i], i))
                v = scenario_metrics(list(y[k]), order)[key]
                if v is not None:
                    vals.append(v)
        return float(np.mean(vals)) if vals else None
    model_s = lambda k: scC[k]
    p0_s = lambda k: -p0[k].astype(float)
    pr_s = lambda k: -pr[k].astype(float)
    cis = {
        'model_C_ndcg@5': bootstrap(lambda smp: metric_for(smp, model_s), tfams),
        'rules_p0_ndcg@5': bootstrap(lambda smp: metric_for(smp, p0_s), tfams),
        'pr49_ndcg@5': bootstrap(lambda smp: metric_for(smp, pr_s), tfams),
        'model_minus_p0_ndcg@5': bootstrap(lambda smp: (metric_for(smp, model_s) or 0) - (metric_for(smp, p0_s) or 0), tfams),
        'model_minus_pr49_ndcg@5': bootstrap(lambda smp: (metric_for(smp, model_s) or 0) - (metric_for(smp, pr_s) or 0), tfams),
    }

    e6 = {}
    if per_annot:
        a, b = list(per_annot)
        for src, dst in ((a, b), (b, a)):
            m = Ranker(fam_c, hp_c).fit(X[dev][:, cC], per_annot[src][dev], scen[dev])
            e6[f'train_{src}_test_{dst}'] = summarise(rank_metrics(m.score(X[test][:, cC]), per_annot[dst][test], scen[test]))
            e6[f'rules_p0_vs_{dst}'] = summarise(baseline_metrics(p0[test], per_annot[dst][test], scen[test]))

    errors = []
    for s in np.unique(scen[test]):
        k = np.where(scen == s)[0]
        i = k[np.argmax(scC[k])]
        best = float(np.max(y[k]))
        if y[i] < best:
            errors.append({'scenarioId': s, 'modelTop1': cand[i], 'top1Label': float(y[i]), 'bestLabel': best, 'bestCandidates': cand[k][y[k] == best].tolist(),
                           'p0Top1': cand[k][np.argmin(p0[k])], 'p0Top1Label': float(y[k][np.argmin(p0[k])])})

    weights = None
    if args.labels == 'human' and mC.coef is not None:
        weights = {'schemaVersion': 1, 'id': 'fp-cdm-m2', 'version': '1.0.0', 'family': fam_c, 'hyperparameter': hp_c, 'featureSet': M['featureSet'],
                   'featureNames': [names[i] for i in cC], 'mean': mC.scaler.mean_.tolist(), 'scale': mC.scaler.scale_.tolist(), 'coef': mC.coef.tolist(),
                   'pairTemperature': T, 'platt': {'a': float(platt.coef_[0][0]), 'b': float(platt.intercept_[0])}, 'abstainSuitabilityBelow': tau,
                   'trainedOn': {'matrixSha256': sha(mpath), 'labels': label_info, 'devFamilies': dev_fams}}
        with open(os.path.join(args.out, 'fp-cdm-m2.weights.json'), 'w', encoding='utf-8') as f:
            json.dump(weights, f)
    coefs = None
    if mC.coef is not None:
        coefs = sorted(({'feature': names[i], 'weight': float(w)} for i, w in zip(cC, mC.coef)), key=lambda d: -abs(d['weight']))[:20]
    report = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'labels': label_info,
              'resultKind': 'MODEL_EVALUATION' if args.labels == 'human' else 'PIPELINE_VALIDATION_ONLY (not a model result)',
              'matrix': {'sha256': sha(mpath), 'rows': len(rows), 'features': len(names)}, 'splits': {'devFamilies': len(dev_fams), 'testFamilies': len(tfams), 'testScenarios': int(len(np.unique(scen[test])))},
              'devSelection': {k: v for k, v in selection.items() if not k.endswith('_oof')}, 'calibration': {'pairTemperature': T, 'platt': {'a': float(platt.coef_[0][0]), 'b': float(platt.intercept_[0])},
              'abstainSuitabilityBelow': tau, 'devTop1Coverage': coverage}, 'test': test_report, 'bootstrap95': cis, 'e6CrossAnnotator': e6,
              'errorAnalysisTop1': errors, 'topCoefficients': coefs, 'seconds': round(time.time() - t0, 1),
              'versions': {'python': sys.version.split()[0], 'sklearn': __import__('sklearn').__version__, 'numpy': np.__version__}}
    name = 'fp-cdm-m2.report.json' if args.labels == 'human' else f'pipeline-validation-{args.labels}-seed{args.seed}.json'
    with open(os.path.join(args.out, name), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1)
    t = test_report
    print(json.dumps({'kind': report['resultKind'], 'chosen': selection['C_profile_history_report_chosen'], 'test_ndcg5': {k: round(v['all']['ndcg@5'], 4) for k, v in t.items()},
                      'test_pairacc': {k: round(v['all']['pairwise_acc'], 4) for k, v in t.items()}, 'ci': cis, 'T': round(T, 3), 'tau': tau, 'coverage': coverage}))


if __name__ == '__main__':
    main()
