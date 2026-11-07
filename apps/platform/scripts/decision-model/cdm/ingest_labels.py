"""Two-annotator label ingestion for fp-cdm (agreement, adjudication queue, final labels).

Run (apps/platform):  python -I -B scripts/decision-model/cdm/ingest_labels.py --labels-dir <dir> [--adjudication <file.json>]
Inputs: exported files fp-cdm-labels-v1-<ID>.json from the annotation tool (complete=true required).
Adjudication file (optional): {"decisions": [{"scenarioId", "candidateId", "grade", "reason", "adjudicator"}]}
Output: <labels-dir>/final-labels.v1.json, <labels-dir>/agreement.v1.json, <labels-dir>/adjudication-queue.v1.json
Exit code 3 = AWAITING_LABELS (fewer than two complete independent annotators).
"""
import argparse, glob, hashlib, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def qwk(a, b, k=4):
    a, b = np.asarray(a, int), np.asarray(b, int)
    O = np.zeros((k, k))
    for x, y in zip(a, b):
        O[x, y] += 1
    W = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    return float(1 - (W * O).sum() / (W * E).sum()) if (W * E).sum() else None


def spearman(x, y):
    from scipy.stats import spearmanr
    if len(set(x)) < 2 or len(set(y)) < 2:
        return None
    return float(spearmanr(x, y).statistic)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels-dir', required=True)
    ap.add_argument('--adjudication')
    args = ap.parse_args()
    with open(os.path.join(HERE, 'data', 'scenarios.v1.json'), 'rb') as f:
        raw = f.read()
    scen_sha = hashlib.sha256(raw).hexdigest()
    scenarios = json.loads(raw)['scenarios']
    expected = {(s['id'], c) for s in scenarios for c in s['candidates']}
    files = sorted(glob.glob(os.path.join(args.labels_dir, 'fp-cdm-labels-v1-*.json')))
    annot = {}
    problems = []
    for path in files:
        with open(path, encoding='utf-8') as f:
            j = json.load(f)
        aid = j['annotator']['id']
        # AI annotations (fp-cdm-ai-labels/*) are never counted as a human annotator.
        if j.get('kitId') != 'fp-cdm-annotation/v1' or str(j['annotator'].get('kind', '')).lower() == 'ai' or str(j['annotator'].get('role', '')).lower().startswith('ai'):
            problems.append(f'{os.path.basename(path)}: not a human annotation export (rejected)')
            continue
        if j.get('scenarioSha256') != scen_sha:
            problems.append(f'{os.path.basename(path)}: scenario sha mismatch')
            continue
        labels = {(l['scenarioId'], l['candidateId']): l for l in j['labels'] if l['grade'] in (0, 1, 2, 3)}
        if set(labels) != expected:
            problems.append(f'{aid}: incomplete ({len(labels)}/{len(expected)})')
            continue
        if aid in annot:
            problems.append(f'{aid}: duplicate annotator id')
            continue
        annot[aid] = {'meta': j['annotator'], 'labels': labels, 'file': os.path.basename(path), 'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest()}
    status = {'files': [os.path.basename(p) for p in files], 'problems': problems, 'completeAnnotators': sorted(annot)}
    if len(annot) < 2:
        print(json.dumps({'status': 'AWAITING_LABELS', **status}, ensure_ascii=False))
        sys.exit(3)
    a_id, b_id = sorted(annot)[:2]
    A, B = annot[a_id]['labels'], annot[b_id]['labels']
    keys = sorted(expected)
    ga, gb = [A[k]['grade'] for k in keys], [B[k]['grade'] for k in keys]
    per_scen = []
    for s in scenarios:
        x = [A[(s['id'], c)]['grade'] for c in s['candidates']]
        y = [B[(s['id'], c)]['grade'] for c in s['candidates']]
        per_scen.append(spearman(x, y))
    valid = [v for v in per_scen if v is not None]
    agreement = {'annotators': [annot[a_id]['meta'], annot[b_id]['meta']], 'n': len(keys), 'quadraticWeightedKappa': qwk(ga, gb),
                 'exactAgreement': float(np.mean(np.equal(ga, gb))), 'withinOne': float(np.mean(np.abs(np.subtract(ga, gb)) <= 1)),
                 'meanScenarioSpearman': float(np.mean(valid)) if valid else None, 'scenariosWithSpearman': len(valid),
                 'gradeDistribution': {a_id: np.bincount(ga, minlength=4).tolist(), b_id: np.bincount(gb, minlength=4).tolist()},
                 'safetyFlags': {a_id: sum(A[k]['safetyConcern'] for k in keys), b_id: sum(B[k]['safetyConcern'] for k in keys)}}
    agreement['qualityGate'] = 'PASS' if (agreement['quadraticWeightedKappa'] or 0) >= 0.4 else 'FAIL_REVISE_GUIDELINES'
    queue = [{'scenarioId': k[0], 'candidateId': k[1], a_id: A[k]['grade'], b_id: B[k]['grade'], 'safety': [A[k]['safetyConcern'], B[k]['safetyConcern']],
              'notes': [A[k].get('note', ''), B[k].get('note', '')]} for k in keys if abs(A[k]['grade'] - B[k]['grade']) >= 2 or A[k]['safetyConcern'] or B[k]['safetyConcern']]
    decisions = {}
    if args.adjudication:
        with open(args.adjudication, encoding='utf-8') as f:
            for d in json.load(f)['decisions']:
                decisions[(d['scenarioId'], d['candidateId'])] = d
    final, unresolved = [], 0
    for k in keys:
        needs = abs(A[k]['grade'] - B[k]['grade']) >= 2 or A[k]['safetyConcern'] or B[k]['safetyConcern']
        if needs and k in decisions:
            grade, source = float(decisions[k]['grade']), 'adjudicated'
        elif needs:
            grade, source = (A[k]['grade'] + B[k]['grade']) / 2, 'mean_pending_adjudication'
            unresolved += 1
        else:
            grade, source = (A[k]['grade'] + B[k]['grade']) / 2, 'mean_of_two'
        final.append({'scenarioId': k[0], 'candidateId': k[1], 'grade': grade, 'source': source, a_id: A[k]['grade'], b_id: B[k]['grade'],
                      'safetyConcern': bool(A[k]['safetyConcern'] or B[k]['safetyConcern'])})
    out = {'schemaVersion': 1, 'id': 'fp-cdm-labels/v1', 'scenarioSha256': scen_sha, 'annotatorFiles': {a: {'file': annot[a]['file'], 'sha256': annot[a]['sha256'], 'meta': annot[a]['meta']} for a in (a_id, b_id)},
           'labelOrigin': 'human graded judgments on synthetic scenarios (two independent annotators); qualification as declared in meta.role',
           'unresolvedAdjudications': unresolved, 'labels': final}
    for name, obj in (('final-labels.v1.json', out), ('agreement.v1.json', agreement), ('adjudication-queue.v1.json', {'items': queue})):
        with open(os.path.join(args.labels_dir, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
    print(json.dumps({'status': 'READY', **status, 'qwk': agreement['quadraticWeightedKappa'], 'gate': agreement['qualityGate'], 'adjudicationQueue': len(queue), 'unresolved': unresolved}, ensure_ascii=False))


if __name__ == '__main__':
    main()
