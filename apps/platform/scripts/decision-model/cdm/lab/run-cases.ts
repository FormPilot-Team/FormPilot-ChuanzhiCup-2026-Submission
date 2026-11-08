/** Helper for check-lab.mjs: runs [before, after] input pairs through the public engine (ACTIVE + approval, as in the Lab). */
import { readFileSync, writeFileSync } from 'node:fs'
import { recommendCoachDecision } from '../../../../src/features/coachAgent/decisionModel/engine'

const [inFile, outFile] = process.argv.slice(2)
const pairs = JSON.parse(readFileSync(inFile, 'utf8')) as Array<[unknown, unknown]>
const options = { mode: 'active' as const, allowExperimentalModel: true }
writeFileSync(outFile, JSON.stringify(pairs.map(([a, b]) => [recommendCoachDecision(a, options), recommendCoachDecision(b, options)])))
