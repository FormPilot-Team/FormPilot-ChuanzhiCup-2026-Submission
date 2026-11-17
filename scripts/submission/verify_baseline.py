"""Verify unmodified exported source bytes without requiring the private development repository."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AMENDMENTS = {
    'apps/motion-games-lab/PRODUCT.md': 'Factual human-play validation limitation',
    'apps/platform/docs/ai-coach-agent/PUBLIC_DEMO.md': 'Optional gateway deployment facts without personal handoff instructions',
    'apps/platform/docs/coach-trusted-input-offline.md': 'Portable historical trusted-input safety specification; research statistics retained',
    'apps/platform/docs/ai-coach-agent/WEB_V12_LLM_AGENT.md': 'Current Agent technical status and portable Ollama startup; historical evaluation retained',
    'apps/platform/README.md': 'Portable submission run guide',
    'apps/motion-games-lab/app/README.md': 'Portable relative install path',
    'apps/platform/scripts/decision-model/cdm/README.md': 'Portable training runner guide',
    'apps/platform/tests/visual-web-v1/competition-active.spec.ts': 'Ignore only same-origin favicon requests in the no-business-network assertion',
    'apps/platform/tests/e2e/web-v1.spec.ts': 'Use the configured games URL consistently for request interception, health probe and popup assertion',
    'apps/platform/docs/ai-coach-agent/decision-model/MODEL_REPORT.md': 'Editorial removal of agent execution and merge instructions; research results retained',
    'apps/platform/docs/ai-coach-agent/decision-model/README.md': 'Editorial removal of agent execution/local machine paths; baseline research retained',
    'apps/platform/docs/ai-coach-agent/decision-model/WEB_INTEGRATION_READY.md': 'Current product call sites replace obsolete PR/Codex handoff instructions',
    'apps/platform/docs/ai-coach-agent/decision-model/WEB_INTEGRATION.md': 'Historical API context replaces obsolete ownership instructions',
    'apps/platform/docs/ai-coach-agent/decision-model/CDM_TRAINED_MODEL.md': 'Historical research context replaces branch coordination',
    'apps/platform/docs/ANALYZER_AUDIT.md': 'Reference measurements and self-check results retained; approval and document-production notes removed',
    'apps/platform/scripts/decision-model/cdm/annotation-kit/packages/HANDOFF_PACKAGES.md': 'Portable annotation protocol without machine paths or agent messaging instructions',
    'apps/platform/public/web-v1/ASSET_SOURCES.md': 'Concise asset provenance and permitted use retained',
    'apps/platform/docs/web-v1/README.md': 'Current page architecture and runtime guide replace obsolete integration closeout narrative',
}
REMOVED_DOCUMENTS = {
    'apps/platform/docs/ai-coach-agent/decision-model/CODEX_WIRING_BRIEF.md',
    'apps/platform/docs/ai-coach-agent/decision-model/WEB_INTEGRATION_CDM.md',
    'apps/platform/docs/web-v1/V1_1_UI_INTEGRATION.md',
}
manifest = json.loads((ROOT/'docs/submission/source-files.json').read_text(encoding='utf-8'))
publication = json.loads((ROOT/'docs/submission/publication-files.json').read_text(encoding='utf-8'))
publication_files = {entry['path']: entry for entry in publication['files']}
publication_removed = {entry['path']: entry for entry in publication['removed']}
publication_checked = 0
failures = []
checked = 0
for entry in manifest['files']:
    if entry['path'] in publication_removed:
        change = publication_removed[entry['path']]
        if entry['blob'] != change['previous_blob'] or (ROOT/entry['path']).exists():
            failures.append(entry['path'])
        continue
    if entry['path'] in publication_files:
        change = publication_files[entry['path']]
        path = ROOT/entry['path']
        if entry['blob'] != change['previous_blob'] or not path.is_file():
            failures.append(entry['path'])
            continue
        data = path.read_bytes()
        oid = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if oid != change['blob'] or hashlib.sha256(data).hexdigest() != change['sha256']:
            failures.append(entry['path'])
        publication_checked += 1
        continue
    if entry['path'] in REMOVED_DOCUMENTS:
        if (ROOT/entry['path']).exists():
            failures.append(entry['path'])
        continue
    if entry['path'] in AMENDMENTS:
        if not (ROOT/entry['path']).is_file():
            failures.append(entry['path'])
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
    'document_and_test_amendments':AMENDMENTS,'removed_internal_documents':sorted(REMOVED_DOCUMENTS), 'publication_files_verified':publication_checked, 'publication_removals':sorted(publication_removed), 'mismatches':failures},ensure_ascii=False,indent=2))
raise SystemExit(bool(failures))
