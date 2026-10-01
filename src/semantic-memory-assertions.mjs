// External product assertions: a symbol list is not adopted definition memory.
import assert from 'node:assert/strict'

export function assertDefinitionMemory(dictionary) {
  const projection = dictionary?.definitionMemory
  assert(projection && typeof projection === 'object',
    'semantic-memory-path-incomplete: product exposes no adopted definition memory')
  assert.equal(projection.memory?.schema, 'sem-lang://memory/definitions/v1')
  assert.match(projection.revision, /^definitions-[0-9a-f]{64}$/u)
  assert.equal(typeof projection.memory.decision_ref, 'string')
  assert(projection.memory.decision_ref.trim().length > 0)
  assert.equal(typeof projection.memory.namespace, 'string')
  assert(projection.memory.namespace.length > 0)
  assert(Array.isArray(projection.memory.modules))
  const terms = new Map()
  for (const module of projection.memory.modules) {
    assert(Array.isArray(module.terms))
    for (const term of module.terms) {
      assert.match(term.id, /^[0-9a-f]{32}$/u)
      assert(term.semantic_definition && typeof term.semantic_definition === 'object',
        'semantic-memory-path-incomplete: term has only a label')
      const reference = `sem-lang://concept/${term.id}`
      assert(!terms.has(reference), 'duplicate adopted meaning reference')
      terms.set(reference, term)
    }
  }
  assert(Array.isArray(dictionary.forms))
  for (const form of dictionary.forms) for (const field of form.fields) {
    assert.equal(field.meaning?.definitionRevision, projection.revision,
      'field must refer to the exact adopted memory revision')
    const definition = terms.get(field.meaning.reference)
    assert(definition, 'field meaning is absent from adopted memory')
    assert.equal(field.meaning.schemaId, form.value_schema)
    assert.equal(field.meaning.fieldPath, field.path)
  }
  return projection
}
