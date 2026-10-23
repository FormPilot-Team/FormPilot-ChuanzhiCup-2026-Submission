#!/usr/bin/env node
// Repository hygiene gate (runs in CI on every PR, and locally before pushing):
//   1. no tracked file above 20 MiB (GitHub warns at 50 MiB, rejects at 100 MiB; we keep big assets out of git)
//   2. no file listed in assets-manifest/ is tracked
//   3. no env / key files are tracked
//   4. no obvious credentials in tracked text files
//
//   node scripts/ci/check-repo-hygiene.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIMIT = 20 * 1024 * 1024;
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const problems = [];

for (const file of tracked) {
  const size = statSync(path.join(repoRoot, file), { throwIfNoEntry: false })?.size ?? 0;
  if (size > LIMIT) problems.push(`too large (${(size / 2 ** 20).toFixed(1)} MiB > 20 MiB): ${file}`);
}

const trackedSet = new Set(tracked);
const manifestDir = path.join(repoRoot, 'assets-manifest');
for (const name of readdirSync(manifestDir).filter((f) => f.endsWith('.json'))) {
  const manifest = JSON.parse(readFileSync(path.join(manifestDir, name), 'utf8'));
  for (const entry of manifest.files) {
    const file = `apps/${manifest.app}/${entry.path}`;
    if (trackedSet.has(file)) problems.push(`external asset is tracked (see ${name}): ${file}`);
  }
}

const secretFile = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519))$/i;
for (const file of tracked) {
  if (secretFile.test(file) && !file.endsWith('.env.example')) problems.push(`env/key file is tracked: ${file}`);
}

const patterns = [
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const textExt = /\.(m?[jt]sx?|cjs|json|md|txt|ya?ml|toml|html|css|py|ps1|sh|rs|env|example|cfg|ini)$/i;
for (const file of tracked) {
  if (!textExt.test(file) || /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/.test(file)) continue;
  const full = path.join(repoRoot, file);
  if ((statSync(full, { throwIfNoEntry: false })?.size ?? 0) > 4 * 2 ** 20) continue;
  const text = readFileSync(full, 'utf8');
  for (const [label, rx] of patterns) if (rx.test(text)) problems.push(`possible ${label}: ${file}`);
}

if (problems.length) {
  console.error(`Repository hygiene check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Repository hygiene OK: ${tracked.length} tracked files, none above 20 MiB, no external asset or secret tracked.`);
