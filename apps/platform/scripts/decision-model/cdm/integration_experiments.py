"""Phase 3 experiments I1-I3 (pre-declared in EXPERIMENT_LOG 2026-11-07). DEV FAMILIES ONLY: the frozen test families are
never loaded into any metric here.

Run (apps/platform):
  python -I -B scripts/decision-model/cdm/integration_experiments.py --matrix scripts/decision-model/cdm/data/m2-matrix.v1.json \
      --ai-labels scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json --out <dir>

I1 profile-feature ablation, I2 history/report ablation: grouped 6-fold CV over the 18 dev families with the release
configuration (pairwise_lr, C=0.01, no re-selection); paired family-bootstrap CI of (variant - full).
I3 training-stage checkpoints: the same procedure fitted on 25/50/75/100% of dev families (order fixed by the seed).
Exports UNBOUND research weight variants (Lab "experiment condition" switch and TS probes); they are never product weights.
"""
import argparse, hashlib, json, os, sys, time
import numpy as np
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_m2 import Ranker, scenario_metrics, summarise  # noqa: E402

SEED = 20261107
FAMILY, HP = 'pairwise_lr', 0.01  # release configuration (fp-cdm-m2 v1.0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--matrix', required=True); ap.add_argument('--ai-labels', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args(); os.makedirs(os.path.join(a.out, 'variants'), exist_ok=True); t0 = time.time()
    mbytes = open(a.matrix, 'rb').read(); M = json.loads(mbytes); msha = hashlib.sha256(mbytes).hexdigest()
    lbytes = open(a.ai_labels, 'rb').read(); L = json.loads(lbytes); lsha = hashlib.sha256(lbytes).hexdigest()
    names, groups = M['featureNames'], M['featureGroups']
    rows = [r for r in M['rows'] if r['split'] == 'dev']  # frozen test rows dropped here, before anything else
    X = np.array([r['features'] for r in rows], float)
    scen = np.array([r['scenarioId'] for r in rows]); fam = np.array([r['familyId'] for r in rows]); cand = np.array([r['candidateId'] for r in rows])
    cond = np.array([r['condition'] for r in rows])
    lab = {(l['scenarioId'], l['candidateId']): l['grade'] for l in L['labels']}
    y = np.array([lab[(s, c)] for s, c in zip(scen, cand)], float)
    fams = sorted(set(fam)); fold = {f: i % 6 for i, f in enumerate(fams)}; foldv = np.array([fold[f] for f in fam])

    def cols(pred):
        return [i for i, n in enumerate(names) if pred(n)]
    full = cols(lambda n: True)
    minus = lambda pred: [i for i in full if not pred(names[i])]
    SETS = {
        'full_PHR': full,
        # I1 profile-feature ablation
        'minus_goal_crosses': minus(lambda n: n.startswith('x_goal_')),
        'minus_difficulty_crosses': minus(lambda n: n.startswith('x_diff_')),
        'minus_region_crosses': minus(lambda n: n.startswith('x_region_') or n == 'x_m1_region_selected_mean'),
        'minus_preference': minus(lambda n: n.startswith('x_pref_')),
        'minus_all_profile_crosses': minus(lambda n: n.startswith('x_')),
        'minus_m1_content': minus(lambda n: 'm1' in n),
        'minus_content_tags': minus(lambda n: n.startswith('c_') and 'm1' not in n),
        # I2 history / report ablation
        'minus_history_all': minus(lambda n: groups[n] == 'H'),
        'minus_history_practice': minus(lambda n: n in ('h_practised_this_log', 'h_practised_programme_log', 'h_novel', 'h_next_in_programme', 'h_focus_overlap_practised')),
        'minus_history_quality': minus(lambda n: n in ('h_completion_this', 'h_score_this', 'h_trend_this', 'h_recency_this')),
        'minus_history_games': minus(lambda n: n.startswith('h_game_')),
        'minus_report_all': minus(lambda n: groups[n] == 'R'),
        'profile_content_only_P': cols(lambda n: groups[n] == 'P'),
    }

    def oof(c, train_mask=None):
        out = np.full(len(rows), np.nan)
        for k in range(6):
            tr = (foldv != k) & (train_mask if train_mask is not None else True)
            va = foldv == k
            out[va] = Ranker(FAMILY, HP).fit(X[tr][:, c], y[tr], scen[tr]).score(X[va][:, c])
        return out

    def per_scen(scores, mask=None):
        res = []
        for s in np.unique(scen):
            k = np.where((scen == s) & (mask if mask is not None else True))[0]
            if len(k) < 2: continue
            order = sorted(range(len(k)), key=lambda i: (-scores[k[i]], i))
            m = scenario_metrics(list(y[k]), order); m['family'] = fam[k[0]]; m['scenario'] = s; res.append(m)
        return res

    rng = np.random.default_rng(SEED)
    def paired_ci(per_a, per_b, key, n=2000):
        fa = {}; fb = {}
        for m in per_a:
            if m[key] is not None: fa.setdefault(m['family'], []).append(m[key])
        for m in per_b:
            if m[key] is not None: fb.setdefault(m['family'], []).append(m[key])
        fs = sorted(set(fa) & set(fb)); d = np.array([np.mean(fa[f]) - np.mean(fb[f]) for f in fs])
        boots = [float(np.mean(d[rng.integers(0, len(d), len(d))])) for _ in range(n)]
        return {'meanDiff': float(np.mean(d)), 'ci95': [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))], 'families': len(fs)}

    masks = {'all_dev': None, 'with_history_B_C': np.isin(cond, ['B_history', 'C_history_report']), 'with_report_C': cond == 'C_history_report'}
    scores = {name: oof(c) for name, c in SETS.items()}
    ablation = {}
    for name, c in SETS.items():
        ablation[name] = {'features': len(c)}
        for mname, mask in masks.items():
            per, base = per_scen(scores[name], mask), per_scen(scores['full_PHR'], mask)
            ablation[name][mname] = summarise(per)
            if name != 'full_PHR':
                ablation[name][mname]['diffVsFull'] = {k: paired_ci(per, base, k) for k in ('ndcg@5', 'pairwise_acc')}

    def calibrate(c, train_mask):
        """Release procedure (train_m2.py): pair temperature + Platt on OOF scores, abstain tau = top-1 precision >= 0.85."""
        fam_in = sorted(set(fam[train_mask])); nf = min(6, len(fam_in)); fo = {f: i % nf for i, f in enumerate(fam_in)}
        o = np.full(len(rows), np.nan)
        for k in range(nf):
            tr = train_mask & np.array([fo.get(f, -1) != k for f in fam]); va = train_mask & np.array([fo.get(f, -1) == k for f in fam])
            o[va] = Ranker(FAMILY, HP).fit(X[tr][:, c], y[tr], scen[tr]).score(X[va][:, c])
        diffs, wins = [], []
        for s in np.unique(scen[train_mask]):
            k = np.where((scen == s) & train_mask)[0]
            for i in k:
                for j in k:
                    if y[i] - y[j] >= 1: diffs += [o[i] - o[j], o[j] - o[i]]; wins += [1, 0]
        diffs, wins = np.array(diffs), np.array(wins)
        nll = lambda T: float(-np.mean(wins * np.log(np.clip(1 / (1 + np.exp(-diffs / T)), 1e-6, 1 - 1e-6)) + (1 - wins) * np.log(np.clip(1 - 1 / (1 + np.exp(-diffs / T)), 1e-6, 1 - 1e-6))))
        temps = np.exp(np.linspace(np.log(0.05), np.log(20), 200)); T = float(temps[int(np.argmin([nll(t) for t in temps]))])
        platt = LogisticRegression(C=1.0).fit(o[train_mask].reshape(-1, 1), (y[train_mask] >= 2).astype(int))
        top = []
        for s in np.unique(scen[train_mask]):
            k = np.where((scen == s) & train_mask)[0]; i = k[np.argmax(o[k])]
            top.append((float(platt.predict_proba([[o[i]]])[0, 1]), y[i] >= 2))
        tau = 1.01
        for t in sorted({p for p, _ in top}):
            kept = [ok for p, ok in top if p >= t]
            if kept and np.mean(kept) >= 0.85: tau = float(t); break
        return T, float(platt.coef_[0, 0]), float(platt.intercept_[0]), tau

    def export(variant, c, train_mask, note):
        m = Ranker(FAMILY, HP).fit(X[train_mask][:, c], y[train_mask], scen[train_mask])
        T, pa, pb, tau = calibrate(c, train_mask)
        w = {'schemaVersion': 1, 'id': 'fp-cdm-m2', 'version': f'1.0.0-variant.{variant}', 'status': 'TRAINED', 'family': FAMILY, 'hyperparameter': HP,
             'featureSet': 'fp-cdm-features/v1', 'featureNames': [names[i] for i in c], 'mean': m.scaler.mean_.tolist(), 'scale': m.scaler.scale_.tolist(), 'coef': m.coef.tolist(),
             'pairTemperature': T, 'platt': {'a': pa, 'b': pb}, 'abstainSuitabilityBelow': tau,
             'featureRange': {'min': X[train_mask][:, c].min(axis=0).tolist(), 'max': X[train_mask][:, c].max(axis=0).tolist(), 'source': 'training rows of this variant'},
             'variant': {'name': variant, 'note': note, 'binding': 'UNBOUND research variant; never product weights; dev families only', 'trainFamilies': sorted(set(fam[train_mask]))},
             'trainedOn': {'matrixSha256': msha, 'labels': {'kind': 'ai_single_annotator', 'file_sha256': lsha}, 'devFamilies': sorted(set(fam[train_mask]))}}
        path = os.path.join(a.out, 'variants', f'fp-cdm-m2.variant-{variant}.weights.json')
        json.dump(w, open(path, 'w', encoding='utf-8'))
        return {'file': os.path.basename(path), 'features': len(c), 'trainFamilies': len(set(fam[train_mask])), 'pairTemperature': T, 'abstainSuitabilityBelow': tau}

    all_dev = np.ones(len(rows), bool)
    variants = {}
    for v, setname, note in (('full-refit', 'full_PHR', 'release procedure refitted here (sanity: should match the release coefficients)'),
                             ('no-history', 'minus_history_all', 'all H features removed'), ('no-report', 'minus_report_all', 'all R features removed'),
                             ('no-m1', 'minus_m1_content', 'M1 content features removed'), ('no-profile-crosses', 'minus_all_profile_crosses', 'all x_* profile x content crosses removed'),
                             ('profile-content-only', 'profile_content_only_P', 'P group only (no history, no report)')):
        variants[v] = export(v, SETS[setname], all_dev, note)
    # I3 training-stage checkpoints (full feature set, growing family subsets in a seed-fixed order)
    order = list(np.random.default_rng(SEED).permutation(fams)); checkpoints = {}
    for frac in (0.25, 0.5, 0.75, 1.0):
        k = max(2, int(round(frac * len(order)))); subset = set(order[:k]); mask = np.isin(fam, list(subset))
        info = export(f'stage-{int(frac * 100)}', full, mask, f'checkpoint trained on {k}/{len(order)} dev families')
        if frac < 1.0:
            mdl = Ranker(FAMILY, HP).fit(X[mask][:, full], y[mask], scen[mask])
            held = ~mask
            info['heldOutDevFamilies'] = int(len(set(fam[held])))
            info['heldOutDev'] = summarise(per_scen(np.where(held, mdl.score(X[:, full]), np.nan), held))
        checkpoints[f'{int(frac * 100)}%'] = info

    # sanity: refit full == release coefficients
    rel = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts', 'm2-ai-experiment', 'fp-cdm-m2.ai-experiment.weights.json'), encoding='utf-8'))
    ref = json.load(open(os.path.join(a.out, 'variants', 'fp-cdm-m2.variant-full-refit.weights.json'), encoding='utf-8'))
    same = rel['featureNames'] == ref['featureNames'] and float(np.max(np.abs(np.array(rel['coef']) - np.array(ref['coef'])))) < 1e-9
    report = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'seed': SEED, 'scope': 'DEV families only (18); frozen test families not loaded',
              'labels': {'kind': 'ai_single_annotator', 'sha256': lsha}, 'matrixSha256': msha, 'release': {'family': FAMILY, 'hp': HP},
              'devScenarios': int(len(np.unique(scen))), 'devFamilies': len(fams), 'ablation': ablation, 'variants': variants, 'checkpoints': checkpoints,
              'refitMatchesRelease': bool(same), 'seconds': round(time.time() - t0, 1)}
    json.dump(report, open(os.path.join(a.out, 'integration-experiments.json'), 'w', encoding='utf-8'), indent=1)
    print(json.dumps({'refitMatchesRelease': same, 'seconds': report['seconds']}))
    for name in SETS:
        r = ablation[name]['all_dev']; h = ablation[name]['with_history_B_C']; c = ablation[name]['with_report_C']
        d = r.get('diffVsFull', {}).get('ndcg@5', {}); dh = h.get('diffVsFull', {}).get('ndcg@5', {})
        print(f"{name:28s} nd5 {r['ndcg@5']:.3f} pa {r['pairwise_acc']:.3f} | hist nd5 {h['ndcg@5']:.3f} | rep nd5 {c['ndcg@5']:.3f} | d {d.get('meanDiff', 0):+.3f} {d.get('ci95')} | dHist {dh.get('meanDiff', 0):+.3f} {dh.get('ci95')}")
    for k, v in checkpoints.items(): print(k, v.get('trainFamilies'), v.get('heldOutDev', {}).get('ndcg@5'))


if __name__ == '__main__':
    main()
