#!/usr/bin/env node
// Verify the exact candidate through external interfaces before any generation switch.
import { spawn } from 'node:child_process'
import { readFile, realpath, lstat, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRequirements, loadScenario } from '../src/scenario-runner.mjs'
import { validateRequirements, assertReleaseEligible } from '../src/release-requirements.mjs'
import { stopProcess } from '../src/process-lifecycle.mjs'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const [generation, worker] = process.argv.slice(2)
if (!isAbsolute(generation ?? '') || !isAbsolute(worker ?? '')) throw new Error('exact generation and external worker paths required')
for (const path of [generation, worker]) if (await realpath(path) !== path
  || (await lstat(path)).isSymbolicLink()) throw new Error('release acceptance path is not canonical')
const manifestBytes = await readFile(join(generation, 'release-manifest.json'))
const manifest = JSON.parse(manifestBytes)
const executable = join(generation, manifest.executables.hatter.path)
const environment = { ...process.env, HATTER_E2E_HATTER_BIN: executable, HATTER_E2E_WORKER_BIN: worker }
delete environment.HATTER_E2E_RELEASE_CATALOG_DIR
const child = spawn('pnpm', ['test'], { cwd: repository, stdio: 'inherit',
  env: environment })
const timer = setTimeout(() => void stopProcess(child), 240_000)
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve)
  })
  if (code !== 0) throw new Error('hatter-release-acceptance-failed')
} finally { clearTimeout(timer); await stopProcess(child) }
const report = JSON.parse(await readFile(join(repository, '.artifacts/acceptance-report.json')))
if (report.stats.unexpected || report.stats.skipped || report.stats.flaky) throw new Error('hatter-release-acceptance-incomplete')
const cases = report.suites.flatMap(suite => suite.specs)
const product = cases.find(spec => spec.title === 'released multi-HAT acceptance survives Console restart')
if (!product?.ok || product.tests.length !== 1 || product.tests[0].results.length !== 1
  || product.tests[0].results[0].status !== 'passed') throw new Error('product acceptance did not execute exactly once')
const attachment = product.tests[0].results[0].attachments.find(item => item.name === 'acceptance-and-improvement-review')
if (!attachment?.body) throw new Error('acceptance evidence missing')
const evidence = JSON.parse(Buffer.from(attachment.body, 'base64').toString())
const requirements = validateRequirements(await loadRequirements(), await loadScenario())
const evaluated = assertReleaseEligible(requirements, evidence.results)
if (JSON.stringify(evaluated) !== JSON.stringify(evidence.requirements)) throw new Error('acceptance evidence does not match requirements')
const receipt = { schema: 'hatter://acceptance/release/v1', generation,
  manifestDigest: createHash('sha256').update(manifestBytes).digest('hex'),
  verifiedAt: new Date().toISOString(), requirements: evaluated, results: evidence.results,
  scope: evidence.scope, excludes: evidence.excludes }
const receipts = join(repository, '.artifacts/releases')
await mkdir(receipts, { recursive: true })
await writeFile(join(receipts, `${receipt.manifestDigest}.json`), JSON.stringify(receipt, null, 2) + '\n')
process.stdout.write(`Release acceptance: ${evaluated.length} requirements verified against ${generation}\n`)
