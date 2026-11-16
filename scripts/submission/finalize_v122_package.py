"""Finalize an already built Windows package: versioned docs, licenses, inventory, ZIP.

python scripts/submission/finalize_v122_package.py --source-root . --package PATH
Only the explicitly supplied package directory, sibling ZIP and checksum are written.
Does not download resources, change source files, or grant third-party media rights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--version', default='1.2.2')
    parser.add_argument('--mediapipe-license', type=Path, help='Optional audited upstream LICENSE when the formal source tree lacks third-party/mediapipe/LICENSE')
    parser.add_argument('--scrollbar-license', type=Path, help='Audited project MIT license for react-remove-scroll-bar (npm package omits its text)')
    parser.add_argument('--scrollbar-provenance', type=Path, help='Provenance and association limitations for that upstream license')
    args = parser.parse_args()
    source = args.source_root.resolve(strict=True)
    package = args.package.resolve(strict=True)
    name = 'FormPilot-Web-V' + args.version
    if package.name != name or not (package / 'VERSION.txt').is_file():
        raise SystemExit('Refusing unexpected package path/name or missing VERSION.txt')
    version_text = (package / 'VERSION.txt').read_text(encoding='utf-8')
    if 'FormPilot Web V' + args.version not in version_text:
        raise SystemExit('VERSION.txt does not match --version; build the actual version first')
    version_text = version_text.replace('not included: model weights,', 'not included: Qwen LLM weights,')
    (package / 'VERSION.txt').write_text(version_text, encoding='utf-8', newline='\n')
    for doc in package.glob('*.md'):
        text = doc.read_text(encoding='utf-8')
        text = re.sub(r'(?<=V)1\.2\.1\b', args.version, text)
        doc.write_text(text, encoding='utf-8', newline='\n')

    # Preserve license/NOTICE/COPYING files from every installed dependency,
    # including toolchain packages; this deliberately errs toward over-inclusion.
    licenses = package / 'third-party'
    licenses.mkdir(exist_ok=True)
    records = []
    seen = set()
    for app in ('platform', 'motion-games-lab/app'):
        store = source / 'apps' / app / 'node_modules' / '.pnpm'
        if not store.is_dir():
            raise SystemExit('Install locked dependencies first: ' + str(store))
        for metadata in sorted(store.glob('*/node_modules/*/package.json')) + sorted(store.glob('*/node_modules/@*/*/package.json')):
            info = json.loads(metadata.read_text(encoding='utf-8'))
            identity = str(info.get('name')) + '@' + str(info.get('version'))
            if identity in seen:
                continue
            seen.add(identity)
            target = licenses / re.sub(r'[^A-Za-z0-9._@+-]', '_', identity)
            files = []
            for original in sorted(metadata.parent.iterdir()):
                if not original.is_file() or not re.match(r'^(licen[sc]e|notice|copying|copyright)(\.|$|-)', original.name, re.I):
                    continue
                target.mkdir(exist_ok=True)
                copy = target / original.name
                shutil.copy2(original, copy)
                files.append({'file': copy.relative_to(package).as_posix(), 'sha256': digest(copy)})
            records.append({'package': identity, 'declaredLicense': info.get('license'), 'notices': files})
    mediapipe = args.mediapipe_license.resolve(strict=True) if args.mediapipe_license else source / 'third-party' / 'mediapipe' / 'LICENSE'
    if not mediapipe.is_file():
        candidates = sorted((source / 'apps/platform/node_modules/.pnpm').glob('@mediapipe+tasks-vision@*/node_modules/@mediapipe/tasks-vision/LICENSE'))
        if candidates:
            mediapipe = candidates[0]
    if not mediapipe.is_file():
        raise SystemExit('MediaPipe LICENSE could not be found')
    (licenses / 'mediapipe').mkdir(exist_ok=True)
    shutil.copy2(mediapipe, licenses / 'mediapipe/LICENSE')
    scrollbar = args.scrollbar_license.resolve(strict=True) if args.scrollbar_license else source / 'third-party/react-remove-scroll-bar/LICENSE'
    provenance = args.scrollbar_provenance.resolve(strict=True) if args.scrollbar_provenance else source / 'third-party/react-remove-scroll-bar/provenance.json'
    if not scrollbar.is_file() or not provenance.is_file():
        raise SystemExit('Missing audited react-remove-scroll-bar MIT text/provenance; supply --scrollbar-license and --scrollbar-provenance')
    scrollbar_target = licenses / 'react-remove-scroll-bar@2.3.8'
    scrollbar_target.mkdir(exist_ok=True)
    shutil.copy2(scrollbar, scrollbar_target / 'LICENSE')
    shutil.copy2(provenance, scrollbar_target / 'provenance.json')
    for record in records:
        if record['package'] == 'react-remove-scroll-bar@2.3.8':
            record['notices'] = [{'file': (scrollbar_target / 'LICENSE').relative_to(package).as_posix(), 'sha256': digest(scrollbar_target / 'LICENSE')}]
            record['licenseAssociation'] = 'npm package declares MIT but omits text; fixed upstream project LICENSE supplied, exact npm gitHead unavailable; see provenance.json'
    (licenses / 'dependency-license-inventory.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (package / 'THIRD_PARTY_NOTICES.md').write_text(
        '# Third-party notices / 第三方许可\n\n'
        '本包保留锁定依赖附带的 LICENSE、NOTICE、COPYING 等全文，见 `third-party/`。\n'
        '`third-party/dependency-license-inventory.json` 记录依赖名称、版本、声明许可和通知文件哈希；其中也包含构建与测试工具。\n'
        'MediaPipe 模型和 WASM 按 Apache-2.0 保留许可，见 `third-party/mediapipe/LICENSE`。\n'
        '`react-remove-scroll-bar@2.3.8` 的 npm 包声明 MIT 但缺许可全文；补充固定上游项目 MIT 文本与 `provenance.json`，其中说明不能验证该 npm gitHead 的关联限制。\n'
        'Qwen 权重和 Ollama 不在本包中。安装这些可选组件时须分别遵循其上游许可。\n\n'
        '视频、海报、教练形象和生成素材的来源与适用范围见 `素材来源.md` 及比赛仓库的 `docs/submission/ASSETS_AND_LICENSES.md`。\n'
        '本包只用于负责人授权的 Private 内部验收；第三方媒体的公开分发权和评审访问范围仍待负责人确认。\n'
        '未为团队原创源码擅自授予 MIT、Apache 或其他开源许可。依赖许可证不能替代原创源码及媒体的授权。\n',
        encoding='utf-8')
    (package / ('00-V' + args.version + '-版本记录.md')).write_text(
        '# FormPilot Web V' + args.version + '\n\n'
        '从正式 main 的实际提交重新构建，精确提交与构建时间见 `VERSION.txt`。\n'
        '本版包含 PR #60 的动作工坊姿态图标与开始/恢复手势修复；识别仍使用 full 模型，等待开始/恢复时使用 lite 手势模型。\n'
        '保留 V1.2.1 功能；没有新增产品功能，也没有包含 Qwen 权重、Ollama、API Key 或个人训练记录。\n'
        '包内 V1.2.2 说明、第三方许可、文件清单与校验由 `finalize_v122_package.py` 补齐。\n'
        '`FILE_MANIFEST.json` 列出 payload（不含自身和 SHA256SUMS.txt）；`SHA256SUMS.txt` 进一步包含 manifest。\n'
        '自动化与摄像头视频重放不能替代真人现场训练验收。实际测试及仍待人工验收项以本次交付的测试结果为准。\n',
        encoding='utf-8')

    forbidden_names = {'.env', '.env.local', '.npmrc', 'id_rsa', 'members.local.json'}
    files = sorted(p for p in package.rglob('*') if p.is_file() and p.name not in {'SHA256SUMS.txt', 'FILE_MANIFEST.json'})
    for path in files:
        if path.name in forbidden_names or path.suffix.lower() in {'.gguf', '.safetensors'} or path.name.lower().startswith('ollama'):
            raise SystemExit('Refusing sensitive/runtime/model file: ' + str(path))
    manifest = [{'path': p.relative_to(package).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in files]
    (package / 'FILE_MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    files = sorted(p for p in package.rglob('*') if p.is_file() and p.name != 'SHA256SUMS.txt')
    (package / 'SHA256SUMS.txt').write_bytes(('\n'.join(digest(p) + '  ' + p.relative_to(package).as_posix() for p in files) + '\n').encode('utf-8'))
    archive = package.parent / (name + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in sorted(p for p in package.rglob('*') if p.is_file()):
            zf.write(p, name + '/' + p.relative_to(package).as_posix())
    sha = digest(archive)
    archive.with_suffix('.zip.sha256').write_bytes((sha + '  ' + archive.name + '\n').encode('utf-8'))
    result = {'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha, 'files': len(files) + 1, 'dependencyLicenses': len(records), 'sourceVersion': version_text}
    (archive.parent / 'package-finalization.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
