// Assembles dist-public-demo-deploy/: the demo build + the gateway's nine source files + a Dockerfile, ready for a
// container host (e.g. a ModelScope Docker 创空间, port 7860) or `node server/coachAgent/demo/index.ts` on any machine
// with Node 24. Contains no key, no .env, no model and no public/ media. Run after `pnpm demo:build`.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const out = join(root, 'dist-public-demo-deploy')
const built = join(root, 'dist-public-demo')
if (!existsSync(join(built, 'PUBLIC_DEMO_MANIFEST.json'))) throw new Error('run pnpm demo:build first')

const SOURCES = [
  'server/coachAgent/demo/config.ts', 'server/coachAgent/demo/index.ts', 'server/coachAgent/demo/openaiRelay.ts',
  'server/coachAgent/demo/server.ts', 'server/coachAgent/demo/upstreamSmoke.ts',
  'server/coachAgent/agent/config.ts', 'server/coachAgent/agent/server.ts',
  'server/coachAgent/local/config.ts', 'server/coachAgent/local/transport.ts',
  'src/features/coachLlm/protocol.ts',
]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(built, join(out, 'static'), { recursive: true })
for (const file of SOURCES) {
  mkdirSync(dirname(join(out, file)), { recursive: true })
  cpSync(join(root, file), join(out, file))
}
writeFileSync(join(out, 'package.json'), `${JSON.stringify({ name: 'formpilot-public-demo', private: true, type: 'module', engines: { node: '>=24' }, scripts: { start: 'node server/coachAgent/demo/index.ts', 'upstream-smoke': 'node server/coachAgent/demo/upstreamSmoke.ts' } }, null, 2)}\n`)
writeFileSync(join(out, 'Dockerfile'), `# FormPilot public AI Coach demo gateway. No dependencies: Node 24 runs the TypeScript sources directly.
FROM node:24-alpine
WORKDIR /app
COPY . .
# Container defaults. The upstream URL, model, key, public origin and frame parents are RUNTIME variables set on the
# hosting platform (never baked into the image): FP_DEMO_OPENAI_BASE_URL, FP_DEMO_OPENAI_MODEL, FP_DEMO_OPENAI_API_KEY,
# FP_DEMO_PUBLIC_ORIGINS, FP_DEMO_FRAME_ANCESTORS, FP_DEMO_TRUST_PROXY.
ENV FP_DEMO_ENABLED=true FP_DEMO_BIND=0.0.0.0 FP_DEMO_PORT=7860 FP_DEMO_STATIC_DIR=/app/static FP_DEMO_UPSTREAM=openai
USER node
EXPOSE 7860
CMD ["node", "server/coachAgent/demo/index.ts"]
`)
writeFileSync(join(out, '.dockerignore'), '.env*\n*.log\n')
console.log(`deploy folder → ${out}`)
