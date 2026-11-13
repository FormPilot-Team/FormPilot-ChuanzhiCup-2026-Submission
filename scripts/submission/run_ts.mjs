// Portable access to the vite-node version installed by the platform's frozen lockfile.
// Usage from the repository root:
//   node scripts/submission/run_ts.mjs scripts/decision-model/cdm/evaluate-cdm.ts --out <folder>
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/platform');
const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error('Supply a TypeScript script relative to apps/platform.');
const target = resolve(platform, script);
const rel = relative(platform, target);
if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('The script must be inside apps/platform.');
const platformRequire = createRequire(resolve(platform, 'package.json'));
const vitestRequire = createRequire(platformRequire.resolve('vitest/package.json'));
const viteNode = resolve(dirname(vitestRequire.resolve('vite-node/package.json')), 'vite-node.mjs');
const result = spawnSync(process.execPath, [viteNode, target, ...args], { cwd: platform, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
