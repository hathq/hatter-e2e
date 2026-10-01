// Hatter acceptance: independently reviewed minimum examples, not an exhaustive ontology.
import assert from 'node:assert/strict'
export function assertReviewedExamples(dictionary, examples) {
  assert(Array.isArray(examples.views) && examples.views.length, 'reviewed examples missing')
  for (const example of examples.views) {
    const view = dictionary.views.find(view => view.id === example.id && view.scene === example.scene)
    assert(view, `reviewed example ${example.scene}:${example.id} missing`)
    assert(view.labels, `reviewed example ${example.id} has no declared locale map`)
    assert.equal(dictionary.language.terms.find(term => term.reference === view.baseReference)?.symbol, example.baseSymbol)
    for (const [locale, label] of Object.entries(example.labels)) assert.equal(view.labels[locale], label)
    if (example.requiredForm) assert(view.formIds.includes(example.requiredForm))
  }
}
