import { test } from '@playwright/test'
import assert from 'node:assert/strict'
import { assertReviewedExamples } from '../src/reviewed-ui-examples.mjs'
test('independent expectations reject consistent but incorrect labels and existing base references', () => {
  const examples = { views: [{ id: 'identity', scene: 'person', baseSymbol: 'Identity',
    labels: { en: 'Identity', ja: '基本情報' }, requiredForm: 'name' }] }
  const dictionary = { language: { terms: [{ reference: 'identity-ref', symbol: 'Identity' },
    { reference: 'time-ref', symbol: 'Time' }] }, views: [{ id: 'identity', scene: 'person',
    baseReference: 'identity-ref', formIds: ['name'], labels: { en: 'Identity', ja: '基本情報' } }] }
  assertReviewedExamples(dictionary, examples)
  for (const mutate of [value => { value.views[0].baseReference = 'time-ref' },
    value => { value.views[0].labels.ja = '日時' }, value => { value.views[0].formIds = [] }]) {
    const wrong = structuredClone(dictionary); mutate(wrong)
    // CLI/API/UI agreement would still succeed if all three returned this object.
    assert.throws(() => assertReviewedExamples(wrong, examples))
  }
})
