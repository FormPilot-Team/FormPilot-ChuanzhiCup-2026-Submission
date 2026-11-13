"""Verify unmodified exported source bytes without requiring the private development repository."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AMENDMENTS = {
    'apps/platform/README.md': 'Portable submission run guide',
    'apps/motion-games-lab/app/README.md': 'Portable relative install path',
    'apps/platform/scripts/decision-model/cdm/README.md': 'Portable training runner guide',
    'apps/platform/tests/visual-web-v1/competition-active.spec.ts': 'Ignore only same-origin favicon requests in the no-business-network assertion',
    'apps/platform/tests/e2e/web-v1.spec.ts': 'Use the configured games URL consistently for request interception, health probe and popup assertion',
}
manifest = json.loads((ROOT/'docs/submission/source-files.json').read_text(encoding='utf-8'))
failures = []
checked = 0
for entry in manifest['files']:
    if entry['path'] in AMENDMENTS:
        continue
    path = (ROOT/entry['path']).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        failures.append(entry['path'])
        continue
    data = path.read_bytes()
    oid = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    checked += 1
    if oid != entry['blob']:
        failures.append(entry['path'])
print(json.dumps({'baseline':manifest['baseline'],'verified_source_files':checked,
    'document_and_test_amendments':AMENDMENTS,'mismatches':failures},ensure_ascii=False,indent=2))
raise SystemExit(bool(failures))
