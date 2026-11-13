"""Minimum human check on the 6 frozen test families (run once human labels exist).

Run (apps/platform):
  python -I -B scripts/decision-model/cdm/ingest_labels.py --labels-dir <dir> --subset test
  python -I -B scripts/decision-model/cdm/evaluate_human_test.py --labels-dir <dir> --out <dir>
Reports: human-human agreement (from ingest), AI-annotator vs each human (QWK, scenario Spearman), and E1 re-scored
on HUMAN labels for rules P0, PR #49 and the AI-label-trained fp-cdm model. Nothing is retrained or tuned here.
"""
import argparse, hashlib, json, os, sys, time
import numpy as np
from scipy.stats import spearmanr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ingest_labels import qwk  # noqa: E402
from train_m2 import scenario_metrics, summarise  # noqa: E402

SEED = 20261107


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels-dir', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--ai-labels', default=os.path.join(HERE, 'labels-ai', 'fp-cdm-ai-labels-v1.json'))
    ap.add_argument('--weights', default=os.path.join(HERE, 'artifacts', 'm2-ai-experiment', 'fp-cdm-m2.ai-experiment.weights.json'))
    ap.add_argument('--matrix', default=os.path.join(HERE, 'data', 'm2-matrix.v1.json'))
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    H = json.load(open(os.path.join(a.labels_dir, 'final-labels.v1.json'), encoding='utf-8'))
    AI = json.load(open(a.ai_labels, encoding='utf-8'))
    W = json.load(open(a.weights, encoding='utf-8'))
    m_bytes = open(a.matrix, 'rb').read(); M = json.loads(m_bytes)
    if not (H['scenarioSha256'] == AI['scenarioSha256'] == M['scenarioSha256']):
        raise SystemExit('scenario sha mismatch between human labels, AI labels and matrix')
    if hashlib.sha256(m_bytes).hexdigest() != W['trainedOn']['matrixSha256']:
        raise SystemExit('matrix does not match the weights')
    hl = {(l['scenarioId'], l['candidateId']): l for l in H['labels']}
    al = {(l['scenarioId'], l['candidateId']): l['grade'] for l in AI['labels']}
    annot = list(H['annotatorFiles'])
    rows = [r for r in M['rows'] if r['split'] == 'test' and (r['scenarioId'], r['candidateId']) in hl]
    keys = [(r['scenarioId'], r['candidateId']) for r in rows]
    expected = sum(1 for r in M['rows'] if r['split'] == 'test')
    if len(rows) != expected:
        raise SystemExit(f'human labels cover {len(rows)}/{expected} test items')

    # AI annotator vs humans (AI is NOT a human annotator; this measures AI-label validity on the test families)
    agree = {}
    for who in annot + ['final_mean']:
        h = [hl[k][who] if who != 'final_mean' else hl[k]['grade'] for k in keys]
        ai = [al[k] for k in keys]
        rho = []
        for s in sorted({k[0] for k in keys}):
            idx = [i for i, k in enumerate(keys) if k[0] == s]
            x, y = [ai[i] for i in idx], [h[i] for i in idx]
            if len(set(x)) > 1 and len(set(y)) > 1: rho.append(spearmanr(x, y).statistic)
        agree[f'ai_vs_{who}'] = {'qwk': qwk([int(v) for v in ai], [int(round(v)) for v in h]) if who != 'final_mean' else None,
                                  'exact': float(np.mean([round(x) == round(y) for x, y in zip(ai, h)])), 'meanScenarioSpearman': float(np.mean(rho)) if rho else None}

    # E1 re-scored on human final labels (fp-cdm scores from the frozen AI-label weights; linear model)
    names = M['featureNames']; idx = [names.index(n) for n in W['featureNames']]
    X = np.array([[r['features'][i] for i in idx] for r in rows], float)
    score = ((X - np.array(W['mean'])) / np.where(np.array(W['scale']) == 0, 1, np.array(W['scale']))) @ np.array(W['coef'])
    y = np.array([hl[k]['grade'] for k in keys], float)
    scen = np.array([k[0] for k in keys]); fam = np.array([r['familyId'] for r in rows])
    systems = {'rules_p0': -np.array([r['p0Rank'] for r in rows], float), 'pr49_manual_ranker': -np.array([r['pr49Rank'] for r in rows], float), 'fp_cdm_ai_trained': score}
    def per(sc, mask=None):
        out = []
        for s in np.unique(scen):
            k = np.where(scen == s)[0]
            order = sorted(range(len(k)), key=lambda i: (-sc[k[i]], i))
            m = scenario_metrics(list(y[k]), order); m['family'] = fam[k[0]]; out.append(m)
        return out
    rng = np.random.default_rng(SEED)
    def boot(pa, key='ndcg@5', n=2000):
        fs = sorted({m['family'] for m in pa}); vals = []
        for _ in range(n):
            smp = rng.choice(fs, size=len(fs), replace=True)
            vals.append(np.mean([m[key] for f in smp for m in pa if m['family'] == f and m[key] is not None]))
        return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
    e1 = {name: {**summarise(per(sc)), 'ndcg@5_ci95': boot(per(sc))} for name, sc in systems.items()}
    report = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'resultKind': 'HUMAN_TEST_FAMILY_CHECK',
              'labels': {'file_sha256': hashlib.sha256(open(os.path.join(a.labels_dir, 'final-labels.v1.json'), 'rb').read()).hexdigest(), 'annotators': H['annotatorFiles'], 'unresolvedAdjudications': H['unresolvedAdjudications']},
              'humanAgreement': json.load(open(os.path.join(a.labels_dir, 'agreement.v1.json'), encoding='utf-8')) if os.path.exists(os.path.join(a.labels_dir, 'agreement.v1.json')) else None,
              'aiVsHuman': agree, 'e1OnHumanLabels': e1, 'testScenarios': int(len(np.unique(scen))), 'note': 'model trained on single-AI-annotator labels (dev families) and evaluated on human labels of the frozen test families'}
    json.dump(report, open(os.path.join(a.out, 'human-test-check.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({'aiVsHuman': agree, 'e1': {k: {'ndcg@5': round(v['ndcg@5'], 3), 'pair': round(v['pairwise_acc'], 3), 'ci': [round(x, 3) for x in v['ndcg@5_ci95']]} for k, v in e1.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
