import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { stopProcess } from '../src/process-lifecycle.mjs'
import {
  ScenarioRunner, loadRecordedScenario, loadScenario, loadRequirements
} from '../src/scenario-runner.mjs'
import { validateRequirements, evaluateRequirements, assertReleaseEligible } from '../src/release-requirements.mjs'

test('acceptance harness keeps the scenario, fixtures, and external boundary consistent',
  async () => {
  const scenario = await loadScenario()
  assert.deepEqual(await loadRecordedScenario(), scenario)
  assert.equal(scenario.$schema, 'hathq://hatter-e2e/scenario/v2')
  assert.deepEqual(scenario.coverage, [
    'fixture-boundary', 'session-and-http-security', 'foundation-initial-state',
    'catalog-trust-and-cas', 'package-integrity-and-ui', 'atomic-composition',
    'guided-installed-ui', 'monotonic-composition-recovery',
    'runtime-projections', 'model-route-guard', 'codex-runtime-observability',
    'live-hat-execution',
    'restart-and-session-recovery', 'retired-text-matcher-absence', 'adopted-semantic-memory'
  ])
  assert.equal(scenario.steps.length, 8)
  assert.equal(new Set(scenario.steps.map(step => step.id)).size, scenario.steps.length)
  const actions = scenario.steps.flatMap(step => step.actions)
  assert.equal(actions.length, 55)
  assert.equal(new Set(actions).size, actions.length)
  for (const step of scenario.steps) {
    assert.match(step.id, /^S[0-9]{2}$/u)
    assert.ok(step.title.length > 0 && step.manual.length > 0)
    assert.match(step.scenarioId, /^[a-z][a-z0-9-]+$/u)
    assert.ok(step.covers.length >= 2 && step.evidence.length >= 2
      && step.actions.length >= 2)
    assert.ok(step.checks.length >= 2)
    assert.ok(step.reviewPoints.length >= 1)
    assert.equal(step.checks.every(value => typeof value === 'string' && value.length > 0), true)
  }
  const infrastructure = new Set(['constructor', 'execute', 'close', 'start', 'snapshot',
    'prepareComposition', 'readComposition', 'readAccountantProjectionJournal', 'readContinuity',
    'readPlacement'])
  const executableActions = Object.getOwnPropertyNames(ScenarioRunner.prototype)
    .filter(name => !infrastructure.has(name)).sort()
  assert.deepEqual([...actions].sort(), executableActions)

  const fixtures = await Promise.all([
    '../fixtures/hat.package.json', '../fixtures/hat-budget-planner.package.json'
  ].map(async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))))
  for (const fixture of fixtures) {
    assert.equal(fixture.version, '1.0.1')
    assert.equal(fixture.manifest.version, fixture.version)
    assert.equal(fixture.operations.length, 1)
    assert.equal(fixture.operations[0].reducer.strategy, 'typed-domain-event')
  }

  const paths = [
    '../src/scenario-runner.mjs', '../src/console-process.mjs',
    '../src/console-client.mjs', '../src/use-case-compiler.mjs',
    '../src/fixture.mjs', '../src/browser.mjs', '../bin/compile-scenario.mjs',
    '../bin/showcase.mjs'
  ]
  const sources = await Promise.all(paths.map(path =>
    readFile(new URL(path, import.meta.url), 'utf8')))
  for (const source of sources) {
    assert.doesNotMatch(source, /hatter-console\/(?:server|app)|hatter\/(?:cli|core)/u)
    assert.doesNotMatch(source, /node_modules/u)
  }
  const browser = sources[paths.indexOf('../src/browser.mjs')]
  assert.match(browser, /from '@playwright\/test'/u)
  assert.match(browser, /chromium\.launch/u)
  assert.doesNotMatch(browser,
    /WebSocket|remote-debugging|DevTools listening|HATTER_E2E_CHROME|\.exe/u)
  const runner = sources[paths.indexOf('../src/scenario-runner.mjs')]
  assert.doesNotMatch(runner, /\/api\/hats\/timeline|hat-timeline|hat\/timeline/u)
  assert.match(runner, /\/api\/hats\/projection-journal/u)
  assert.match(runner, /core\.event\.action\.completed/u)
  // Harness-only children: verify both graceful cleanup and the escalation path.
  for (const mode of ['graceful', 'ignores-interrupt']) {
    const child = spawn(process.execPath, ['-e',
      `process.on('SIGINT', () => ${mode === 'graceful' ? 'process.exit(0)' : '{}'});
       setInterval(() => {}, 1000); process.stdout.write('ready');`],
    { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout, 'data')
      await stopProcess(child, 100)
      assert.equal(child.exitCode, mode === 'graceful' ? 0 : null)
      assert.equal(child.signalCode, mode === 'graceful' ? null : 'SIGKILL')
      await stopProcess(child, 100)
    } finally { await stopProcess(child, 100) }
  }
})

test('released multi-HAT acceptance survives Console restart', async ({}, testInfo) => {
  const scenario = await loadScenario()
  const runner = new ScenarioRunner(process.env.HATTER_E2E_HATTER_BIN)
  const requirements = validateRequirements(await loadRequirements(), scenario)
  const results = scenario.steps.map(step => ({
    id: step.id, title: step.title, status: 'not-run',
    passedActions: [], failedAction: null,
    reviewStatus: 'not-evaluated', reviewPoints: step.reviewPoints
  }))
  try {
    for (const [index, step] of scenario.steps.entries()) {
      const result = results[index]
      await test.step(`${step.id} ${step.title}`, async () => {
        for (const action of step.actions) {
          try {
            await runner.execute(action)
            result.passedActions.push(action)
          } catch (error) {
            result.status = 'failed'
            result.failedAction = action
            throw error
          }
        }
        result.status = 'passed'
        result.reviewStatus = 'candidate-for-ux-review'
      })
    }
    assertReleaseEligible(requirements, results)
  } finally {
    try { await runner.close() } finally {
      for (const { name, ...attachment } of runner.uiEvidence) await testInfo.attach(name, attachment)
      await testInfo.attach('acceptance-and-improvement-review', {
        body: JSON.stringify({
          scope: 'released-product-local-signed-fixture',
          excludes: ['Japanese accounting correctness', 'OS Passkey ceremony', 'real model inference'],
          results, requirements: evaluateRequirements(requirements, results)
        }, null, 2),
        contentType: 'application/json'
      })
    }
  }
})
