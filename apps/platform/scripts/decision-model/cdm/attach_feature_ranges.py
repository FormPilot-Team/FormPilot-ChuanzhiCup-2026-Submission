"""Attach per-feature training ranges (dev rows only) to an existing fp-cdm-m2 weights file, without retraining.

Run (apps/platform):  python -I -B scripts/decision-model/cdm/attach_feature_ranges.py --weights <in.json> --matrix <m2-matrix.json> --out <out.json>
The ranges feed the runtime's OOD rule (v1.1). Coefficients, calibration and thresholds are copied unchanged.
"""
import argparse, hashlib, json
import numpy as np

ap = argparse.ArgumentParser(); ap.add_argument('--weights', required=True); ap.add_argument('--matrix', required=True); ap.add_argument('--out', required=True)
a = ap.parse_args()
w = json.load(open(a.weights, encoding='utf-8'))
m_bytes = open(a.matrix, 'rb').read(); M = json.loads(m_bytes)
if hashlib.sha256(m_bytes).hexdigest() != w['trainedOn']['matrixSha256']:
    raise SystemExit('matrix sha does not match the weights trainedOn.matrixSha256')
names = M['featureNames']
dev = np.array([r['features'] for r in M['rows'] if r['split'] == 'dev'], float)
cols = [names.index(n) for n in w['featureNames']]
w['featureRange'] = {'min': dev[:, cols].min(axis=0).tolist(), 'max': dev[:, cols].max(axis=0).tolist(), 'source': 'dev split rows of the training matrix'}
json.dump(w, open(a.out, 'w', encoding='utf-8'))
print(json.dumps({'out': a.out, 'features': len(cols), 'devRows': int(dev.shape[0])}))
