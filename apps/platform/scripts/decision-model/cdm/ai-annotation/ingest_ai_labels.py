"""Ingest the AI annotation round (single AI annotator) -> export, integrity checks, quality report, circularity audit.

Run (apps/platform):
  python -I -B scripts/decision-model/cdm/ai-annotation/ingest_ai_labels.py --raw-dir <dir/raw> --out <dir>
Raw batches: {scenarioId: [[candidateId, grade|null, flags, reason], ...]}; flags: u=uncertain r=needs review s=safety x=abstain.
These are AI labels: never merged with, or counted as, human annotators (separate schema fp-cdm-ai-labels/v1).
"""
import argparse, glob, hashlib, json, os, time
import numpy as np
from scipy.stats import spearmanr

HERE = os.path.dirname(os.path.abspath(__file__))
CDM = os.path.dirname(HERE)
ANNOTATOR = {'kind': 'ai', 'id': 'AI-claude-opus-5.5', 'model': 'Claude Opus 5.5 (claude-opus-5-5)', 'tool': 'Claude Code (desktop app)',
             'role': 'ai_independent_annotator (not human, not clinical)', 'date': '2026-11-07', 'guidelines': 'fp-cdm GUIDELINES v1.1',
             'conflictOfInterest': 'same agent that designed the PR #49 ranker and the fp-cdm feature set; not independent of the systems being compared',
             'procedure': 'blinded worksheet (no pool provenance, split or system ranks); three conditions of each family processed sequentially'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw-dir', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    raw_scen = open(os.path.join(CDM, 'data', 'scenarios.v1.json'), 'rb').read()
    scen_sha = hashlib.sha256(raw_scen).hexdigest()
    scenarios = {s['id']: s for s in json.loads(raw_scen)['scenarios']}
    batches = sorted(glob.glob(os.path.join(a.raw_dir, 'batch-*.json')))
    merged, problems = {}, []
    for path in batches:
        for sid, items in json.load(open(path, encoding='utf-8')).items():
            if sid in merged:
                problems.append(f'duplicate scenario {sid}')
            merged[sid] = items
    labels = []
    for sid, s in scenarios.items():
        items = merged.get(sid)
        if items is None:
            problems.append(f'missing scenario {sid}'); continue
        ids = [i[0] for i in items]
        if sorted(ids) != sorted(s['candidates']) or len(set(ids)) != len(ids):
            problems.append(f'{sid}: candidate set mismatch')
        for cid, grade, flags, reason in items:
            abstain = 'x' in flags
            if not abstain and grade not in (0, 1, 2, 3):
                problems.append(f'{sid}/{cid}: invalid grade {grade}')
            if not str(reason).strip():
                problems.append(f'{sid}/{cid}: empty reason')
            labels.append({'scenarioId': sid, 'candidateId': cid, 'grade': None if abstain else grade, 'abstain': abstain, 'uncertain': 'u' in flags,
                           'needsReview': 'r' in flags, 'safetyConcern': 's' in flags, 'reason': reason})
    extra = sorted(set(merged) - set(scenarios))
    if extra:
        problems.append(f'unknown scenarios {extra}')
    expected = sum(len(s['candidates']) for s in scenarios.values())
    export = {'schemaVersion': 1, 'id': 'fp-cdm-ai-labels/v1', 'scenarioSetId': 'fp-cdm-scenarios/v1', 'scenarioSha256': scen_sha, 'annotator': ANNOTATOR,
              'rawBatches': {os.path.basename(p): hashlib.sha256(open(p, 'rb').read()).hexdigest() for p in batches},
              'labelOrigin': 'AI annotator judgments on synthetic scenarios; NOT human, NOT expert, NOT clinical', 'complete': len(labels) == expected and not problems, 'labels': labels}
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'fp-cdm-ai-labels-v1.json'), 'w', encoding='utf-8') as f:
        json.dump(export, f, ensure_ascii=False, indent=1)

    # ---------------- quality statistics ----------------
    def lim(sid):
        p = scenarios[sid]['profile']
        return 'limited' if ('reach_difficulty' in p['difficulties'] or 'soreness' in p['difficulties'] or 'rehab_support' in p['goals']) else 'non_limited'
    graded = [l for l in labels if l['grade'] is not None]
    dist = lambda rows: np.bincount([r['grade'] for r in rows], minlength=4).tolist()
    by = lambda key: {k: dist([l for l in graded if key(l) == k]) for k in sorted({key(l) for l in graded})}
    zero_var = [sid for sid in scenarios if len({l['grade'] for l in graded if l['scenarioId'] == sid}) < 2]
    swings = []
    for fam in sorted({s['familyId'] for s in scenarios.values()}):
        for cid in scenarios[f'{fam}-A']['candidates']:
            g = {c: next(l['grade'] for l in labels if l['scenarioId'] == f'{fam}-{c}' and l['candidateId'] == cid) for c in 'ABC'}
            if None not in g.values() and max(g.values()) - min(g.values()) >= 1:
                swings.append({'family': fam, 'candidateId': cid, 'A': g['A'], 'B': g['B'], 'C': g['C']})
    pairs = {}
    for split in ('dev', 'test'):
        n = 0
        for sid, s in scenarios.items():
            if s['split'] != split:
                continue
            gs = [l['grade'] for l in graded if l['scenarioId'] == sid]
            n += sum(1 for x in gs for y in gs if x - y >= 1)
        pairs[split] = n

    # ---------------- circularity audit vs P0 / PR #49 orderings ----------------
    M = json.load(open(os.path.join(CDM, 'data', 'm2-matrix.v1.json'), encoding='utf-8'))
    names = M['featureNames']; f1 = names.index('x_region_f1')
    g_of = {(l['scenarioId'], l['candidateId']): l['grade'] for l in graded}
    rho = {'rules_p0': [], 'pr49': [], 'region_f1_feature': []}
    top_agree = {'rules_p0': 0, 'pr49': 0}
    for sid in scenarios:
        rows = [r for r in M['rows'] if r['scenarioId'] == sid]
        g = np.array([g_of[(sid, r['candidateId'])] for r in rows], float)
        if len(set(g)) < 2:
            continue
        for key, vals in (('rules_p0', [-r['p0Rank'] for r in rows]), ('pr49', [-r['pr49Rank'] for r in rows]), ('region_f1_feature', [r['features'][f1] for r in rows])):
            if len(set(vals)) > 1:
                rho[key].append(float(spearmanr(g, vals).statistic))
        best = g.max()
        top_agree['rules_p0'] += int(g[int(np.argmin([r['p0Rank'] for r in rows]))] == best)
        top_agree['pr49'] += int(g[int(np.argmin([r['pr49Rank'] for r in rows]))] == best)
    circ = {k: {'meanScenarioSpearman': float(np.mean(v)), 'scenarios': len(v)} for k, v in rho.items()}
    circ['top1OfSystemHasAiMaxGrade'] = {k: f'{v}/{len(scenarios)}' for k, v in top_agree.items()}

    quality = {'schemaVersion': 1, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'annotator': ANNOTATOR, 'scenarioSha256': scen_sha, 'integrity': {'expected': expected, 'received': len(labels), 'problems': problems, 'complete': export['complete']},
               'gradeDistribution': {'all': dist(graded), 'byCondition': by(lambda l: scenarios[l['scenarioId']]['condition']), 'byStratum': by(lambda l: lim(l['scenarioId'])), 'bySplit': by(lambda l: scenarios[l['scenarioId']]['split']), 'byKind': by(lambda l: 'game' if l['candidateId'] in ('apple', 'archery', 'boating', 'racing') else 'chapter')},
               'abstain': sum(l['abstain'] for l in labels), 'uncertain': sum(l['uncertain'] for l in labels), 'needsReview': sum(l['needsReview'] for l in labels), 'safetyConcern': sum(l['safetyConcern'] for l in labels),
               'zeroVarianceScenarios': zero_var, 'crossConditionChanges': {'count': len(swings), 'swingsOfTwoOrMore': [s for s in swings if max(s['A'], s['B'], s['C']) - min(s['A'], s['B'], s['C']) >= 2]},
               'trainablePairs': pairs, 'circularityAudit': circ,
               'interAnnotatorAgreement': 'NOT AVAILABLE: single AI annotator. No second annotator was simulated; AI-vs-AI repeat labelling would not be human agreement.'}
    with open(os.path.join(a.out, 'ai-label-quality.json'), 'w', encoding='utf-8') as f:
        json.dump(quality, f, ensure_ascii=False, indent=1)
    print(json.dumps({'complete': export['complete'], 'problems': problems[:5], 'n': len(labels), 'dist': quality['gradeDistribution']['all'], 'byStratum': quality['gradeDistribution']['byStratum'],
                      'byCondition': quality['gradeDistribution']['byCondition'], 'uncertain': quality['uncertain'], 'review': quality['needsReview'], 'abstain': quality['abstain'], 'zeroVar': zero_var,
                      'changes': len(swings), 'swings2': len(quality['crossConditionChanges']['swingsOfTwoOrMore']), 'pairs': pairs, 'circ': circ}, ensure_ascii=False))


if __name__ == '__main__':
    main()
