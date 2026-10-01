const MATRIX_SCHEMA = 'hathq://hatter-e2e/use-case-matrix/v2'
const SCENARIO_SCHEMA = 'hathq://hatter-e2e/scenario/v2'
const TOKEN = /^[a-z][a-z0-9-]{1,63}$/u
const ACTION = /^[a-z][a-z0-9_]{1,63}$/u
const EVIDENCE = new Set(['artifact', 'browser', 'cryptographic', 'http', 'process', 'state'])

export function compileUseCases(value) {
  if (value?.$schema !== MATRIX_SCHEMA || !TOKEN.test(value?.id)
    || !Array.isArray(value?.coverage) || !value.coverage.length
    || !Array.isArray(value?.scenarios) || !value.scenarios.length
    || !Array.isArray(value?.prerequisites)
    || typeof value?.title !== 'string' || !value.title
    || typeof value?.objective !== 'string' || !value.objective) invalid()
  const declaredCoverage = new Set(value.coverage)
  if (declaredCoverage.size !== value.coverage.length
    || value.coverage.some(item => !TOKEN.test(item))) invalid()
  const actions = new Set(); const covered = new Set(); const scenarioIds = new Set()
  const steps = []
  for (const item of value.scenarios) {
    if (!TOKEN.test(item?.id) || scenarioIds.has(item.id)
      || !Array.isArray(item?.covers) || item.covers.length < 2
      || new Set(item.covers).size !== item.covers.length
      || item.covers.some(entry => !declaredCoverage.has(entry))
      || !Array.isArray(item?.evidence) || item.evidence.length < 2
      || new Set(item.evidence).size !== item.evidence.length
      || item.evidence.some(entry => !EVIDENCE.has(entry))
      || !Array.isArray(item?.actions) || item.actions.length < 2
      || item.actions.length > 12 || item.actions.some(action => !ACTION.test(action))
      || typeof item?.title !== 'string' || !item.title
      || typeof item?.manual !== 'string' || !item.manual
      || !Array.isArray(item?.checks) || item.checks.length < 2
      || item.checks.length > 16
      || !Array.isArray(item?.reviewPoints) || !item.reviewPoints.length
      || item.reviewPoints.some(point => typeof point !== 'string' || !point)
      || item.checks.some(check => typeof check !== 'string' || !check)) invalid()
    scenarioIds.add(item.id)
    for (const action of item.actions) {
      if (actions.has(action)) invalid()
      actions.add(action)
    }
    for (const entry of item.covers) covered.add(entry)
    steps.push({ id: `S${String(steps.length + 1).padStart(2, '0')}`,
      scenarioId: item.id, covers: item.covers, evidence: item.evidence,
      actions: item.actions,
      title: item.title, manual: item.manual, checks: item.checks,
      reviewPoints: item.reviewPoints })
  }
  if (covered.size !== declaredCoverage.size
    || value.coverage.some(item => !covered.has(item))) invalid()
  return { $schema: SCENARIO_SCHEMA, id: value.id, title: value.title,
    objective: value.objective, prerequisites: value.prerequisites,
    coverage: value.coverage, steps }
}

function invalid() { throw new Error('hatter-e2e-use-case-matrix-invalid') }
