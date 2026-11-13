"""Build the FormPilot Web V1.1 competition package (Windows, offline, no Node needed to run it).

Usage (from apps/platform, after `pnpm install` here and in apps/motion-games-lab/app):
    python -I -B scripts/competition-package/build_package.py --out <folder> [--version 1.1.0]

Steps
1. `vite build --mode competition` (AI Coach ACTIVE, owner-approved experimental model) straight into
   <out>/FormPilot-Web-V<version>/platform, with VITE_MOTION_GAMES_URL=http://localhost:5181/ so the game center finds the
   packaged games.
2. `pnpm build` of apps/motion-games-lab/app, copied to .../games.
3. Launcher (start-formpilot.cmd / .ps1) and the package documents from scripts/competition-package/docs.
4. SHA256SUMS.txt for every file, then a ZIP and its own .sha256.

The routine / demo MP4s are git-ignored; they must exist in public/assets (the script fails if a referenced video is
missing). Nothing from the user's browser (training records, logs) is ever read or packaged.
"""
from __future__ import annotations

import argparse
import json
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parent.parent
GAMES = PLATFORM.parent / 'motion-games-lab' / 'app'
REQUIRED_MEDIA = [
    'assets/routines/baduanjin-standard.mp4', 'assets/routines/taijiquan-standard.mp4',
    'assets/routines/wuqinxi-standard.mp4', 'assets/routines/yijinjing-standard.mp4',
    'web-v1/assets/coach-orb-loop.webm', 'web-v1/assets/coach-orb-poster.png',
]
LOCAL_AI_SOURCES = [
    'server/coachAgent/agent/config.ts', 'server/coachAgent/agent/index.ts', 'server/coachAgent/agent/server.ts',
    'server/coachAgent/local/config.ts', 'server/coachAgent/local/transport.ts', 'src/features/coachLlm/protocol.ts',
]
FORBIDDEN_SUFFIXES = ('.gguf', '.safetensors')
FORBIDDEN_NAMES = ('.env', '.env.local', 'members.local.json', 'id_rsa', '.npmrc')


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    print('$', ' '.join(command), f'(in {cwd})', flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True, shell=os.name == 'nt')


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--version', default='1.2.1')
    args = parser.parse_args()

    for media in REQUIRED_MEDIA:
        if not (PLATFORM / 'public' / media).is_file():
            print(f'missing git-ignored media: public/{media}', file=sys.stderr)
            return 2

    out = Path(args.out).resolve()
    name = f'FormPilot-Web-V{args.version}'
    package = out / name
    if package.exists():
        print(f'{package} already exists; choose a new --out', file=sys.stderr)
        return 2
    package.mkdir(parents=True)

    env = dict(os.environ, VITE_MOTION_GAMES_URL='http://localhost:5181/')
    run(['pnpm', 'exec', 'tsc', '-b'], PLATFORM)
    run(['pnpm', 'exec', 'vite', 'build', '--mode', 'competition', '--outDir', str(package / 'platform'), '--emptyOutDir'], PLATFORM, env)
    run(['pnpm', 'build'], GAMES)
    shutil.copytree(GAMES / 'dist', package / 'games')
    for launcher in ('start-formpilot.cmd', 'start-formpilot.ps1'):
        shutil.copy2(HERE / launcher, package / launcher)
    for doc in sorted((HERE / 'docs').glob('*.md')):
        shutil.copy2(doc, package / doc.name)
    shutil.copy2(PLATFORM / 'public' / 'web-v1' / 'ASSET_SOURCES.md', package / '素材来源.md')
    # Optional V1.2 local AI coach: the agent bridge sources (Node runs them as-is) + a launcher that only checks for and
    # starts against an already-installed local Ollama. No model, no Ollama, no key in the package.
    local_ai = package / 'ai-coach-local'
    for source in LOCAL_AI_SOURCES:
        (local_ai / source).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PLATFORM / source, local_ai / source)
    for launcher in ('start-ai-coach-local.cmd', 'start-ai-coach-local.ps1'):
        shutil.copy2(HERE / 'ai-coach-local' / launcher, local_ai / launcher)
    (local_ai / 'package.json').write_text(json.dumps({'name': 'formpilot-ai-coach-local', 'private': True, 'type': 'module'}, indent=2) + chr(10), encoding='utf-8')

    files = sorted(p for p in package.rglob('*') if p.is_file())
    leaked = [p for p in files if p.name in FORBIDDEN_NAMES or p.suffix.lower() in FORBIDDEN_SUFFIXES or p.name.lower().startswith('ollama')]
    if leaked:
        print('refusing to package sensitive files:', leaked, file=sys.stderr)
        return 3
    sums = [f'{sha256(p)}  {p.relative_to(package).as_posix()}' for p in files]
    # Bytes with LF line endings: `sha256sum -c` and Get-FileHash both work on Windows.
    (package / 'SHA256SUMS.txt').write_bytes(('\n'.join(sums) + '\n').encode('utf-8'))

    archive = out / f'{name}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(p for p in package.rglob('*') if p.is_file()):
            zf.write(path, f'{name}/{path.relative_to(package).as_posix()}')
    (out / f'{name}.zip.sha256').write_bytes(f'{sha256(archive)}  {archive.name}\n'.encode('utf-8'))
    total = sum(p.stat().st_size for p in files)
    print(f'package: {package} ({len(files)} files, {total / 1e6:.1f} MB)')
    print(f'zip:     {archive} ({archive.stat().st_size / 1e6:.1f} MB) sha256 {sha256(archive)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
