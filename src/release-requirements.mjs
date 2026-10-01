// Requirements are not coverage labels: every mapped assertion must have actually passed.
export function validateRequirements(document, scenario) {
  const actions = new Set(scenario.steps.flatMap(step => step.actions))
  const ids = new Set()
  if (document?.schema !== 'hatter://acceptance/requirements/v1'
    || !Array.isArray(document.requirements) || !document.requirements.length) invalid()
  for (const requirement of document.requirements) {
    if (!/^[a-z][a-z-]+$/u.test(requirement.id) || ids.has(requirement.id)
      || typeof requirement.expectation !== 'string' || !requirement.expectation
      || !Array.isArray(requirement.actions)
      || (requirement.implementationGap !== undefined &&
        (typeof requirement.implementationGap !== 'string' || !requirement.implementationGap.trim()))
      || (!requirement.actions.length && !requirement.implementationGap)
      || new Set(requirement.actions).size !== requirement.actions.length
      || requirement.actions.some(action => !actions.has(action))) invalid()
    ids.add(requirement.id)
  }
  return document.requirements
}
export function evaluateRequirements(requirements, results) {
  const passed = new Set(results.flatMap(result => result.passedActions))
  const failed = new Set(results.flatMap(result => result.failedAction ? [result.failedAction] : []))
  return requirements.map(requirement => ({ ...requirement,
    status: requirement.implementationGap ? 'unimplemented'
      : requirement.actions.some(action => failed.has(action)) ? 'failed'
      : requirement.actions.every(action => passed.has(action)) ? 'passed' : 'not-run' }))
}
export function assertReleaseEligible(requirements, results) {
  const evaluated = evaluateRequirements(requirements, results)
  if (evaluated.some(requirement => requirement.status !== 'passed')
    || results.some(result => result.status !== 'passed')) {
    throw new Error('hatter-e2e-release-requirements-incomplete')
  }
  return evaluated
}
function invalid() { throw new Error('hatter-e2e-release-requirements-invalid') }
