import assert from 'node:assert/strict'
import { test } from '@playwright/test'
import { loadScenario, loadRequirements } from '../src/scenario-runner.mjs'
import { validateRequirements, evaluateRequirements, assertReleaseEligible } from '../src/release-requirements.mjs'
import { assertDefinitionMemory } from '../src/semantic-memory-assertions.mjs'

test('release gate rejects missing, failed, skipped and unmapped acceptance evidence', async () => {
  // Harness-only synthetic data tests the oracle, never product acceptance.
  const reference = `sem-lang://concept/${'ab'.repeat(16)}`
  const revision = `definitions-${'cd'.repeat(32)}`
  const projection = {
    definitionMemory: { revision, memory: { schema: 'sem-lang://memory/definitions/v1',
      namespace: 'example', decision_ref: 'decision:example', modules: [{ terms: [{
        id: 'ab'.repeat(16), semantic_definition: { Primitive: 'Value' }
      }] }] } },
    forms: [{ value_schema: 'example:value', fields: [{ path: 'value', meaning: {
      reference, definitionRevision: revision, schemaId: 'example:value', fieldPath: 'value'
    } }] }]
  }
  assert.doesNotThrow(() => assertDefinitionMemory(projection))
  for (const mutate of [value => delete value.definitionMemory,
    value => { value.definitionMemory.memory.modules[0].terms[0].semantic_definition = null },
    value => { value.forms[0].fields[0].meaning.definitionRevision = 'stale' },
    value => { value.forms[0].fields[0].meaning.reference = 'type-is-not-meaning' },
    value => { value.forms[0].fields[0].meaning.fieldPath = 'other' },
    value => { value.definitionMemory.memory.decision_ref = ' ' }]) {
    const broken = structuredClone(projection)
    mutate(broken)
    assert.throws(() => assertDefinitionMemory(broken))
  }
  const scenario = await loadScenario()
  const document = await loadRequirements()
  const requirements = validateRequirements(document, scenario)
  // Package/fixture success cannot silently erase the product feedback gates.
  for (const suffix of ['audit-independence','convergence','decisions','concurrent-decisions',
    'producer-restoration','binding-grant','lifecycle-independence','producer-removal',
    'presentation-resolution','registry-restart','authority-replacement','role-memory',
    'hat-lifecycle','language-outcomes','physical-deletion']) {
    assert(requirements.some(item => item.id === `feedback-${suffix}`), `missing feedback gate: ${suffix}`)
  }
  const complete = scenario.steps.map(step => ({ status: 'passed', passedActions: step.actions, failedAction: null }))
  // Passing today's implemented scenarios must not certify missing product paths.
  assert.throws(() => assertReleaseEligible(requirements, complete), /requirements-incomplete/u)
  const pending = requirements.filter(requirement => requirement.implementationGap)
  assert(pending.length > 0)
  for (const gap of pending) assert.equal(evaluateRequirements(requirements, complete)
    .find(requirement => requirement.id === gap.id).status, 'unimplemented')
  const executable = requirements.filter(requirement => !requirement.implementationGap)
  // This subset is synthetic oracle verification, never a product release gate.
  assert.equal(assertReleaseEligible(executable, complete).every(value => value.status === 'passed'), true)
  for (const requirement of executable) {
    const missing = structuredClone(complete)
    for (const result of missing) result.passedActions = result.passedActions.filter(action => action !== requirement.actions[0])
    assert.throws(() => assertReleaseEligible(requirements, missing), /requirements-incomplete/u)
    assert.equal(evaluateRequirements(requirements, missing).find(item => item.id === requirement.id).status, 'not-run')
    missing[0].failedAction = requirement.actions[0]
    assert.throws(() => assertReleaseEligible(requirements, missing), /requirements-incomplete/u)
    const unmapped = structuredClone(scenario)
    for (const step of unmapped.steps) step.actions = step.actions.filter(action => action !== requirement.actions[0])
    assert.throws(() => validateRequirements(document, unmapped), /requirements-invalid/u)
  }
  const missingMapping = structuredClone(document)
  delete missingMapping.requirements.find(requirement => requirement.implementationGap).implementationGap
  assert.throws(() => validateRequirements(missingMapping, scenario), /requirements-invalid/u)
  assert.throws(() => validateRequirements({ ...document, requirements: [] }, scenario), /requirements-invalid/u)
})
