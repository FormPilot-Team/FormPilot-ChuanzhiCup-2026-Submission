"""M1 Content Perception Model (fp-cdm-m1): pose windows -> chapter region / caution tags.

Run (apps/platform):  python -I -B scripts/decision-model/cdm/train_m1.py --out <dir>
Data: data/m1-windows.v1.json (real reference-pose observations; labels = team-authored catalogue tags).
Evaluation: leave-one-programme-out (each fold tests on a routine never seen in training) at chapter level.
Pre-declared: chapter score = mean of window probabilities for regions, 90th percentile for cautions.
"""
import argparse, hashlib, json, os, sys, time
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
REGIONS = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
CAUTIONS = ['overhead', 'balance', 'twist', 'bending', 'weight_bearing']
LABELS = [('region', r) for r in REGIONS] + [('caution', c) for c in CAUTIONS]
PROGRAMS = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']
SEED = 20261107


def sha256_file(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def make_model(family):
    if family == 'logreg':
        return make_pipeline(SimpleImputer(strategy='median'), StandardScaler(), LogisticRegression(C=0.3, class_weight='balanced', max_iter=4000))
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.08, max_iter=150, min_samples_leaf=20, l2_regularization=1.0, class_weight='balanced', random_state=SEED)


def aggregate(kind, probs):
    return float(np.mean(probs)) if kind == 'region' else float(np.percentile(probs, 90))


def safe_auc(y, s):
    return float(roc_auc_score(y, s)) if len(set(y)) == 2 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    data_path = os.path.join(HERE, 'data', 'm1-windows.v1.json')
    with open(data_path, encoding='utf-8') as f:
        data = json.load(f)
    names = data['featureNames']
    rows = data['rows']
    X = np.array([[np.nan if r['features'][n] is None else r['features'][n] for n in names] for r in rows], dtype=float)
    win_chapter = np.array([r['chapterId'] for r in rows])
    win_program = np.array([r['programId'] for r in rows])
    tags = {c['chapterId']: c for c in data['chapters']}
    chapters = sorted(set(win_chapter.tolist()), key=lambda c: (tags[c]['programId'], c))
    ch_program = {c: tags[c]['programId'] for c in chapters}

    def y_of(kind, name, chapter):
        t = tags[chapter]
        return int(name in (t['regions'] if kind == 'region' else t['caution']))

    with open(os.path.join(HERE, '..', '..', '..', 'src', 'features', 'coachAgent', 'decisionModel', 'motionDescriptors.json'), encoding='utf-8') as f:
        desc = {c['chapterId']: c for c in json.load(f)['chapters']}
    flag_of = {'overhead': 'overhead', 'balance': 'balance', 'twist': 'twist', 'bending': 'bending', 'weight_bearing': 'weightBearing'}

    results, oof = {}, {fam: {c: {} for c in chapters} for fam in ('logreg', 'hgb')}
    t0 = time.time()
    for fam in ('logreg', 'hgb'):
        for kind, name in LABELS:
            yw = np.array([y_of(kind, name, c) for c in win_chapter])
            for held in PROGRAMS:
                tr, te = win_program != held, win_program == held
                test_chapters = [c for c in chapters if ch_program[c] == held]
                if len(set(yw[tr])) < 2:
                    prior = float(yw[tr].mean())
                    for c in test_chapters:
                        oof[fam][c][f'{kind}:{name}'] = prior
                    continue
                model = make_model(fam).fit(X[tr], yw[tr])
                p = model.predict_proba(X[te])[:, 1]
                for c in test_chapters:
                    oof[fam][c][f'{kind}:{name}'] = aggregate(kind, p[win_chapter[te] == c])
    train_seconds = time.time() - t0

    def evaluate(score_of):
        per = {}
        for kind, name in LABELS:
            key = f'{kind}:{name}'
            y = [y_of(kind, name, c) for c in chapters]
            s = [score_of(c, kind, name) for c in chapters]
            folds = {}
            for held in PROGRAMS:
                idx = [i for i, c in enumerate(chapters) if ch_program[c] == held]
                folds[held] = safe_auc([y[i] for i in idx], [s[i] for i in idx])
            per[key] = {
                'positives': int(sum(y)), 'n': len(y), 'auc': safe_auc(y, s),
                'ap': float(average_precision_score(y, s)) if sum(y) else None,
                'f1_at_0_5': float(f1_score(y, [int(v >= 0.5) for v in s])) if sum(y) else None,
                'perHeldOutProgramAuc': folds,
            }
        # Labels whose positives sit in fewer than 2 programmes cannot be learned leave-one-programme-out.
        learnable = [k for k in per if len({ch_program[c] for c in chapters if y_of(*k.split(':'), c)}) >= 2]
        for k in per:
            per[k]['learnableLopo'] = k in learnable
        mac = lambda keys: float(np.mean([per[k]['auc'] for k in keys if per[k]['auc'] is not None]))
        return {'perLabel': per, 'learnableLabels': learnable, 'macroAuc': mac(learnable),
                'macroAucRegions': mac([k for k in learnable if k.startswith('region')]), 'macroAucCautions': mac([k for k in learnable if k.startswith('caution')])}

    results['logreg'] = evaluate(lambda c, k, n: oof['logreg'][c][f'{k}:{n}'])
    results['hgb'] = evaluate(lambda c, k, n: oof['hgb'][c][f'{k}:{n}'])

    def baseline(c, kind, name):
        d = desc[c]
        if not d['reliable']:
            return 0.0
        if kind == 'region':
            v = d['involvement'][name]
            return 0.0 if v is None else float(v)
        return float(d['flags'][flag_of[name]]['sustainedSeconds'])
    results['pr49_descriptors_baseline'] = evaluate(baseline)

    chosen = max(('logreg', 'hgb'), key=lambda fam: results[fam]['macroAuc'])
    # Final artefact: chosen family fitted on all four programmes (for new content); OOF scores feed the ranker.
    final = {}
    for kind, name in LABELS:
        yw = np.array([y_of(kind, name, c) for c in win_chapter])
        final[f'{kind}:{name}'] = make_model(chosen).fit(X, yw)
    artefact = {'schemaVersion': 1, 'id': 'fp-cdm-m1', 'version': '1.0.0', 'family': chosen, 'featureNames': names, 'labels': [f'{k}:{n}' for k, n in LABELS],
                'aggregation': {'region': 'mean', 'caution': 'p90'}, 'trainedOn': data['id'], 'trainingData': {'windows': int(len(rows)), 'chapters': len(chapters)}}
    if chosen == 'logreg':
        artefact['models'] = {}
        for key, pipe in final.items():
            imp, sc, lr = pipe.steps[0][1], pipe.steps[1][1], pipe.steps[2][1]
            artefact['models'][key] = {'median': imp.statistics_.tolist(), 'mean': sc.mean_.tolist(), 'scale': sc.scale_.tolist(), 'coef': lr.coef_[0].tolist(), 'intercept': float(lr.intercept_[0])}
    else:
        import pickle
        with open(os.path.join(args.out, 'fp-cdm-m1-hgb.pkl'), 'wb') as f:
            pickle.dump(final, f)
        artefact['models'] = 'fp-cdm-m1-hgb.pkl (sklearn HistGradientBoosting; offline only; load only this own artefact)'
    with open(os.path.join(args.out, 'fp-cdm-m1.model.json'), 'w', encoding='utf-8') as f:
        json.dump(artefact, f)
    content = {'schemaVersion': 1, 'id': 'fp-cdm-m1-oof-content-features/v1', 'model': f'fp-cdm-m1@1.0.0/{chosen}',
               'note': 'leave-one-programme-out predictions: each chapter scored by a model that never saw its programme',
               'chapters': {c: {k: round(v, 5) for k, v in oof[chosen][c].items()} for c in chapters}}
    with open(os.path.join(args.out, 'fp-cdm-m1.oof-content-features.json'), 'w', encoding='utf-8') as f:
        json.dump(content, f, indent=1)
    metrics = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'python': sys.version.split()[0],
               'sklearn': __import__('sklearn').__version__, 'numpy': np.__version__, 'data': {'path': 'scripts/decision-model/cdm/data/m1-windows.v1.json', 'sha256': sha256_file(data_path), 'windows': len(rows), 'chapters': len(chapters), 'features': len(names)},
               'protocol': 'leave-one-programme-out; chapter-level metrics over out-of-fold predictions; no test programme ever in training', 'trainSecondsBothFamilies': round(train_seconds, 2),
               'chosenFamily': chosen, 'selectionNote': 'family chosen by LOPO macro-AUC, so the chosen family number is mildly optimistic; both are reported', 'results': results}
    with open(os.path.join(args.out, 'fp-cdm-m1.metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=1)
    for fam in ('logreg', 'hgb', 'pr49_descriptors_baseline'):
        r = results[fam]
        print(fam, 'macroAUC %.3f regions %.3f cautions %.3f' % (r['macroAuc'], r['macroAucRegions'], r['macroAucCautions']),
              ' '.join('%s=%s' % (k.split(':')[1][:5], 'na' if v['auc'] is None else '%.2f' % v['auc']) for k, v in r['perLabel'].items()))
    print('chosen', chosen, 'train_s', round(train_seconds, 1))


if __name__ == '__main__':
    main()
