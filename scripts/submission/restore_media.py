"""Restore explicitly listed, locally held media. No download or publication.

Usage from the repository root:
  python scripts/submission/restore_media.py --source-package <unpacked V1.2.1>
  python scripts/submission/restore_media.py --check
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'assets-manifest/platform.json'

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--source-package', type=Path)
    group.add_argument('--check', action='store_true')
    args = parser.parse_args()
    files = json.loads(MANIFEST.read_text(encoding='utf-8'))['files']
    operations = []
    for item in files:
        destination = (ROOT / 'apps/platform' / item['path']).resolve()
        if not destination.is_relative_to(ROOT):
            raise SystemExit('Refusing a destination outside the repository')
        if destination.exists():
            if not destination.is_file() or digest(destination) != item['sha256']:
                raise SystemExit(f'Existing file differs; refusing overwrite: {item["path"]}')
            continue
        if args.check:
            raise SystemExit(f'Missing local-only media: {item["path"]}')
        source = (args.source_package.resolve() / 'platform' / item['path'].removeprefix('public/')).resolve()
        if not source.is_relative_to(args.source_package.resolve()):
            raise SystemExit('Refusing a source outside the supplied package')
        if not source.is_file() or digest(source) != item['sha256']:
            raise SystemExit(f'Missing or mismatched source media: {item["path"]}')
        operations.append((source, destination))
    # Validate every source and destination before creating files.
    for source, destination in operations:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with source.open('rb') as src, destination.open('xb') as dst:
            shutil.copyfileobj(src, dst)
        if digest(destination) != digest(source):
            raise SystemExit(f'Copy verification failed: {destination.name}')
    print(f'PASS: {len(files)} media files match the manifest; {len(operations)} restored. Local use only; distribution rights unconfirmed.')

if __name__ == '__main__':
    main()
