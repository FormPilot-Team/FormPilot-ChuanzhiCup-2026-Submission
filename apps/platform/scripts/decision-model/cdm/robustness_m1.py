"""M1 robustness: leave-one-programme-out with perturbed TEST features (tracking jitter / missing measurements).

Run (apps/platform):  python -I -B scripts/decision-model/cdm/robustness_m1.py --out <dir>
Config fixed to the deployable M1 v1.1 choice (v1 features, HGB depth 2). Training data is never perturbed.
Seeds fixed; 5 repetitions per condition.
"""
import argparse, json, os, time
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20261107
LABELS = [('region', r) for r in ['shoulders', 'neck', 'arms', 'trunk', 'legs']] + [('caution', c) for c in ['overhead', 'balance', 'twist', 'bending', 'weight_bearing']]
PROGRAMS = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); t0 = time.time()
    d = json.load(open(os.path.join(HERE, 'data', 'm1-windows.v1.json'), encoding='utf-8'))
    X = np.array([[np.nan if r['features'][n] is None else r['features'][n] for n in d['featureNames']] for r in d['rows']], float)
    ch = np.array([r['chapterId'] for r in d['rows']]); pr = np.array([r['programId'] for r in d['rows']])
    tags = {c['chapterId']: c for c in d['chapters']}
    chapters = sorted(set(ch.tolist()), key=lambda c: (tags[c]['programId'], c)); chp = {c: tags[c]['programId'] for c in chapters}
    yc = lambda k, n, c: int(n in (tags[c]['regions'] if k == 'region' else tags[c]['caution']))
    learn = [(k, n) for k, n in LABELS if len({chp[c] for c in chapters if yc(k, n, c)}) >= 2]
    sd = np.nanstd(X, axis=0)
    models = {}
    for k, n in learn:
        yw = np.array([yc(k, n, c) for c in ch])
        for held in PROGRAMS:
            tr = pr != held
            if len(set(yw[tr])) < 2: continue
            models[(k, n, held)] = HistGradientBoostingClassifier(max_depth=2, learning_rate=0.08, max_iter=150, min_samples_leaf=20, l2_regularization=1.0, class_weight='balanced', random_state=SEED).fit(X[tr], yw[tr])

    def macro(Xt):
        aucs = []
        for k, n in learn:
            s = {}
            for held in PROGRAMS:
                te = pr == held; m = models.get((k, n, held))
                if m is None: continue
                p = m.predict_proba(Xt[te])[:, 1]
                for c in chapters:
                    if chp[c] == held:
                        pc = p[ch[te] == c]; s[c] = float(np.mean(pc)) if k == 'region' else float(np.percentile(pc, 90))
            cs = [c for c in chapters if c in s]
            y = [yc(k, n, c) for c in cs]
            if len(set(y)) == 2: aucs.append(roc_auc_score(y, [s[c] for c in cs]))
        return float(np.mean(aucs))

    res = {'clean': macro(X)}
    for sigma in (0.1, 0.25, 0.5):
        vals = []
        for rep in range(5):
            rng = np.random.default_rng(SEED + rep)
            vals.append(macro(X + rng.normal(size=X.shape) * sd * sigma))
        res[f'gaussian_{sigma}sd'] = {'mean': float(np.mean(vals)), 'min': float(np.min(vals)), 'max': float(np.max(vals))}
    for frac in (0.2, 0.4):
        vals = []
        for rep in range(5):
            rng = np.random.default_rng(SEED + 100 + rep); Xm = X.copy(); Xm[rng.random(X.shape) < frac] = np.nan
            vals.append(macro(Xm))
        res[f'missing_{int(frac * 100)}pct'] = {'mean': float(np.mean(vals)), 'min': float(np.min(vals)), 'max': float(np.max(vals))}
    out = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'config': 'v1 features / HGB depth 2 (M1 v1.1 deployable)', 'protocol': 'LOPO; only held-out programme features perturbed; 5 seeds per condition',
           'learnableLabels': [f'{k}:{n}' for k, n in learn], 'macroAuc': res, 'seconds': round(time.time() - t0, 1)}
    json.dump(out, open(os.path.join(a.out, 'fp-cdm-m1-robustness.json'), 'w', encoding='utf-8'), indent=1)
    print(json.dumps(res))


if __name__ == '__main__':
    main()
