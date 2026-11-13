"""M1 v1.1 research: feature sets x model families with NESTED leave-one-programme-out.

Run (apps/platform):  python -I -B scripts/decision-model/cdm/train_m1_v11.py --out <dir>
Outer fold = held-out routine programme (cross-programme generalisation). Inner selection = LOPO over the
three training programmes only, so the held-out programme never influences model/feature/hyper-parameter choice.
Labels = team-authored catalogue tags (human, not expert). Aggregation pre-declared: regions mean, cautions p90.
"""
import argparse, hashlib, itertools, json, os, sys, time
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20261107
REGIONS = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
CAUTIONS = ['overhead', 'balance', 'twist', 'bending', 'weight_bearing']
LABELS = [('region', r) for r in REGIONS] + [('caution', c) for c in CAUTIONS]
PROGRAMS = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']
CONFIGS = [('logreg', 0.1), ('logreg', 1.0), ('hgb', 2), ('hgb', 3), ('extratrees', 5), ('extratrees', 20)]
FEATURE_SETS = ['v1', 'v2']


def model(fam, hp):
    if fam == 'logreg':
        return make_pipeline(SimpleImputer(strategy='median'), StandardScaler(), LogisticRegression(C=hp, class_weight='balanced', max_iter=4000))
    if fam == 'hgb':
        return HistGradientBoostingClassifier(max_depth=hp, learning_rate=0.08, max_iter=150, min_samples_leaf=20, l2_regularization=1.0, class_weight='balanced', random_state=SEED)
    return make_pipeline(SimpleImputer(strategy='median'), ExtraTreesClassifier(n_estimators=300, min_samples_leaf=hp, class_weight='balanced', random_state=SEED, n_jobs=-1))


def load(version):
    path = os.path.join(HERE, 'data', f'm1-windows.{version}.json')
    d = json.load(open(path, encoding='utf-8'))
    X = np.array([[np.nan if r['features'][n] is None else r['features'][n] for n in d['featureNames']] for r in d['rows']], float)
    return d, X, hashlib.sha256(open(path, 'rb').read()).hexdigest()


def auc(y, s):
    return float(roc_auc_score(y, s)) if len(set(y)) == 2 else None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    data = {v: load(v) for v in FEATURE_SETS}
    base = data['v1'][0]
    win_ch = np.array([r['chapterId'] for r in base['rows']]); win_pr = np.array([r['programId'] for r in base['rows']])
    for v in FEATURE_SETS:  # same windows in the same order
        assert [r['chapterId'] for r in data[v][0]['rows']] == win_ch.tolist()
    tags = {c['chapterId']: c for c in base['chapters']}
    chapters = sorted(set(win_ch.tolist()), key=lambda c: (tags[c]['programId'], c))
    ch_pr = {c: tags[c]['programId'] for c in chapters}
    yc = lambda k, n, c: int(n in (tags[c]['regions'] if k == 'region' else tags[c]['caution']))

    cache = {}
    def predict(version, fam, hp, k, n, train_progs, test_prog):
        key = (version, fam, hp, k, n, tuple(sorted(train_progs)), test_prog)
        if key in cache:
            return cache[key]
        X = data[version][1]
        yw = np.array([yc(k, n, c) for c in win_ch])
        tr = np.isin(win_pr, list(train_progs)); te = win_pr == test_prog
        out = {}
        if len(set(yw[tr])) < 2:
            for c in chapters:
                if ch_pr[c] == test_prog: out[c] = float(yw[tr].mean())
        else:
            p = model(fam, hp).fit(X[tr], yw[tr]).predict_proba(X[te])[:, 1]
            for c in chapters:
                if ch_pr[c] == test_prog:
                    pc = p[win_ch[te] == c]
                    out[c] = float(np.mean(pc)) if k == 'region' else float(np.percentile(pc, 90))
        cache[key] = out
        return out

    def learnable(progs):
        return [(k, n) for k, n in LABELS if len({ch_pr[c] for c in chapters if ch_pr[c] in progs and yc(k, n, c)}) >= 2]

    def lopo_macro(version, fam, hp, progs):
        """LOPO within `progs`; macro AUC over labels learnable inside `progs` (pooled OOF)."""
        labs = learnable(progs)
        scores = {}
        for held in progs:
            for k, n in labs:
                scores.setdefault((k, n), {}).update(predict(version, fam, hp, k, n, [p for p in progs if p != held], held))
        vals = []
        for (k, n), sc in scores.items():
            cs = [c for c in chapters if ch_pr[c] in progs]
            v = auc([yc(k, n, c) for c in cs], [sc[c] for c in cs])
            if v is not None: vals.append(v)
        return float(np.mean(vals)) if vals else float('nan')

    # Non-nested LOPO over all four programmes, for every (feature set, config): transparency table.
    grid = [(v, f, h) for v in FEATURE_SETS for f, h in CONFIGS]
    flat = {f'{v}/{f}/{h}': lopo_macro(v, f, h, PROGRAMS) for v, f, h in grid}

    # Nested LOPO: inner selection on the three training programmes only.
    nested_oof, chosen = {c: {} for c in chapters}, {}
    for held in PROGRAMS:
        inner = [p for p in PROGRAMS if p != held]
        best = max(grid, key=lambda g: lopo_macro(*g, inner))
        chosen[held] = '/'.join(map(str, best))
        for k, n in LABELS:
            for c, v in predict(*best, k, n, inner, held).items():
                nested_oof[c][f'{k}:{n}'] = v

    with open(os.path.join(HERE, '..', '..', '..', 'src', 'features', 'coachAgent', 'decisionModel', 'motionDescriptors.json'), encoding='utf-8') as f:
        desc = {c['chapterId']: c for c in json.load(f)['chapters']}
    fl = {'overhead': 'overhead', 'balance': 'balance', 'twist': 'twist', 'bending': 'bending', 'weight_bearing': 'weightBearing'}
    def baseline(c, k, n):
        d = desc[c]
        if not d['reliable']: return 0.0
        return (d['involvement'][n] or 0.0) if k == 'region' else float(d['flags'][fl[n]]['sustainedSeconds'])
    v10 = json.load(open(os.path.join(HERE, 'artifacts', 'm1', 'fp-cdm-m1.oof-content-features.json'), encoding='utf-8'))['chapters']

    learn_all = learnable(PROGRAMS)
    def evaluate(score):
        per, per_prog = {}, {p: [] for p in PROGRAMS}
        for k, n in LABELS:
            y = [yc(k, n, c) for c in chapters]; s = [score(c, k, n) for c in chapters]
            per[f'{k}:{n}'] = {'auc': auc(y, s), 'learnable': (k, n) in learn_all,
                               'perHeldOut': {p: auc([y[i] for i, c in enumerate(chapters) if ch_pr[c] == p], [s[i] for i, c in enumerate(chapters) if ch_pr[c] == p]) for p in PROGRAMS}}
            if (k, n) in learn_all:
                for p in PROGRAMS:
                    v = per[f'{k}:{n}']['perHeldOut'][p]
                    if v is not None: per_prog[p].append(v)
        mac = float(np.mean([per[f'{k}:{n}']['auc'] for k, n in learn_all]))
        return {'macroAucLearnable': mac, 'macroRegions': float(np.mean([per[f'region:{r}']['auc'] for r in REGIONS])),
                'macroCautions': float(np.mean([per[f'{k}:{n}']['auc'] for k, n in learn_all if k == 'caution'])),
                'perHeldOutProgrammeMacro': {p: (float(np.mean(v)) if v else None) for p, v in per_prog.items()}, 'perLabel': per}

    results = {'m1_v11_nested': evaluate(lambda c, k, n: nested_oof[c][f'{k}:{n}']),
               'm1_v10_hgb_nonnested': evaluate(lambda c, k, n: v10[c][f'{k}:{n}']),
               'pr49_descriptors_baseline': evaluate(baseline)}
    # Bootstrap over chapters (stratified by programme) for the nested-vs-baseline macro difference.
    rng = np.random.default_rng(SEED); diffs = []
    for _ in range(1000):
        idx = np.concatenate([rng.choice(np.where(np.array([ch_pr[c] for c in chapters]) == p)[0], size=sum(ch_pr[c] == p for c in chapters), replace=True) for p in PROGRAMS])
        cs = [chapters[i] for i in idx]; d = []
        for k, n in learn_all:
            y = [yc(k, n, c) for c in cs]
            if len(set(y)) < 2: continue
            d.append(roc_auc_score(y, [nested_oof[c][f'{k}:{n}'] for c in cs]) - roc_auc_score(y, [baseline(c, k, n) for c in cs]))
        diffs.append(np.mean(d))
    results['nested_minus_baseline_macro_ci95'] = [float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))]

    # Final deployable choice: config with best LOPO macro on all four programmes (used only for NEW content).
    final_cfg = max(grid, key=lambda g: flat['/'.join(map(str, g))])
    content = {'schemaVersion': 1, 'id': 'fp-cdm-m1-oof-content-features/v1.1', 'model': 'fp-cdm-m1@1.1.0 (nested LOPO)',
               'note': 'nested leave-one-programme-out predictions: each chapter scored by a model selected and trained without its programme',
               'innerChoicePerHeldOut': chosen, 'chapters': {c: {k: round(v, 5) for k, v in nested_oof[c].items()} for c in chapters}}
    json.dump(content, open(os.path.join(a.out, 'fp-cdm-m1-v11.oof-content-features.json'), 'w', encoding='utf-8'), indent=1)
    report = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'seed': SEED, 'data': {v: {'sha256': data[v][2], 'features': len(data[v][0]['featureNames']), 'windows': len(win_ch)} for v in FEATURE_SETS},
              'protocol': 'outer LOPO (4 held-out programmes) x inner LOPO selection over 3 training programmes; chapter-level AUC on outer OOF', 'configs': [list(c) for c in CONFIGS], 'featureSets': FEATURE_SETS,
              'nonNestedLopoMacro': flat, 'innerChoicePerHeldOut': chosen, 'finalDeployableConfig': '/'.join(map(str, final_cfg)), 'results': results,
              'versions': {'python': sys.version.split()[0], 'sklearn': __import__('sklearn').__version__}, 'seconds': round(time.time() - t0, 1)}
    json.dump(report, open(os.path.join(a.out, 'fp-cdm-m1-v11.report.json'), 'w', encoding='utf-8'), indent=1)
    for k, r in results.items():
        if isinstance(r, dict): print(k.ljust(26), 'macro %.3f regions %.3f cautions %.3f' % (r['macroAucLearnable'], r['macroRegions'], r['macroCautions']), {p: None if v is None else round(v, 3) for p, v in r['perHeldOutProgrammeMacro'].items()})
    print('diff CI', results['nested_minus_baseline_macro_ci95'], 'inner choices', chosen, 'final', report['finalDeployableConfig'], 'secs', report['seconds'])
    print('flat top5', sorted(flat.items(), key=lambda x: -x[1])[:5])


if __name__ == '__main__':
    main()
