"""Verify unmodified exported source bytes without requiring the private development repository."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AMENDED_DOCS = {
    'apps/platform/README.md',
    'apps/motion-games-lab/app/README.md',
    'apps/platform/scripts/decision-model/cdm/README.md',
}
manifest = json.loads((ROOT/'docs/submission/source-files.json').read_text(encoding='utf-8'))
failures = []
checked = 0
for entry in manifest['files']:
    if entry['path'] in AMENDED_DOCS:
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
    'document_only_amendments':sorted(AMENDED_DOCS),'mismatches':failures},ensure_ascii=False,indent=2))
raise SystemExit(bool(failures))
