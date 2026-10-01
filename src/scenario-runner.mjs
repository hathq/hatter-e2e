import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConsoleClient } from './console-client.mjs'
import { ConsoleProcess } from './console-process.mjs'
import { browserFailures, openBrowser, pageFlowItemIds, pageText,
  sceneLayoutAt, selectTodo } from './browser.mjs'
import {
  prepareFixture, restoreCatalog, restorePackage, tamperCatalog, tamperPackage
} from './fixture.mjs'
import { compileUseCases } from './use-case-compiler.mjs'
import { validateRequirements } from './release-requirements.mjs'
import { assertReviewedExamples } from './reviewed-ui-examples.mjs'
import { assertDefinitionMemory } from './semantic-memory-assertions.mjs'
import { stopProcess } from './process-lifecycle.mjs'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const SUBJECT = 'subject:self'
const SCOPE = 'scope:personal'
const CATALOG_DIGEST = value => createHash('sha256').update(value).digest('hex')
const FITTING = '22'.repeat(32)
const POLICY = '33'.repeat(32)
const SECURITY_HEADERS = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()'
}

export class ScenarioRunner {
  constructor(executable, workerExecutable = process.env.HATTER_E2E_WORKER_BIN) {
    this.executable = executable
    this.hatterCli = executable == null ? null : join(dirname(executable), 'hatter')
    this.workerExecutable = workerExecutable
    this.root = null
    this.fixture = null
    this.process = null
    this.client = null
    this.categoryPath = null
    this.catalogDigest = null
    this.fullPlan = null
    this.fullApprovalJson = null
    this.composition = null
    this.restartSnapshot = null
    this.oldCookie = null
    this.placement = null
    this.worker = null
    this.invocation = null
    this.workerResult = null
    this.children = new Set()
    this.uiEvidence = []
  }

  async execute(action) {
    const operation = this[action]
    if (typeof operation !== 'function') throw new Error(`unknown scenario action: ${action}`)
    process.stdout.write(`Acceptance: ${action}\n`)
    await operation.call(this)
  }

  async prepare_fixture() {
    this.root = await mkdtemp(join(tmpdir(), 'hatter-e2e-'))
    this.fixture = await prepareFixture(this.root, [
      new URL('../fixtures/hat.package.json', import.meta.url),
      new URL('../fixtures/hat-budget-planner.package.json', import.meta.url)
    ])
    assert.deepEqual(this.fixture.packages.map(value => value.repositoryId),
      ['hat-accountant', 'hat-budget-planner'])
    for (const value of this.fixture.packages) {
      assert.match(value.packageDigest, /^[0-9a-f]{64}$/u)
      assert.equal(value.packageDigest, CATALOG_DIGEST(value.packageBytes))
    }
    this.catalogDigest = CATALOG_DIGEST(this.fixture.indexBytes)
  }

  async start_console() { await this.start() }

  async reject_uninitialized_connection() {
    const value = await this.client.getResponse('/api/overview', {
      expected: 401, authenticated: false
    })
    assert.equal(value.body.statusMessage, 'hatter-console-session-rejected')
    assertSecurityHeaders(value.response, true)
  }

  async reject_http_boundary_substitution() {
    const host = await this.client.rawBoundary('/api/overview', {
      host: '127.0.0.1:4213'
    })
    assert.equal(host.status, 307)
    assert.match(host.body, /url=http:\/\/localhost:4213\/api\/overview/u)
    const origin = await this.client.rawBoundary('/api/connection', {
      method: 'POST', origin: 'http://127.0.0.1:4213',
      body: {}
    })
    assert.equal(origin.status, 403)
    assert.equal(origin.body.statusMessage, 'hatter-console-origin-rejected')
  }

  async connect_browser() {
    const startedAt = Date.now()
    const browser = await openBrowser(this.process.launchUrl)
    let session
    try {
      await browser.page.locator('[data-console-session="authenticated"]').waitFor()
      await browser.page.waitForURL(url => url.hash === '')
      assert.equal(browser.connections.length, 1)
      const response = browser.connections[0]
      assert.equal(response.status(), 200)
      session = await response.json()
      this.client.sessionResponse = new Response(null, { headers: await response.allHeaders() })
      this.client.cookie = this.client.sessionResponse.headers.get('set-cookie').split(';', 1)[0]
      this.client.csrf = session.csrf
      await browser.page.reload()
      await browser.page.locator('[data-console-session="authenticated"]').waitFor()
      assert.equal(browser.connections.length, 2, 'reload reuses the internal connection without credentials')
      assert.deepEqual(await browser.connections[1].json(), session)
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
    assertKeys(session, ['csrf', 'expiresAtUnixMs'])
    assert.match(session.csrf, /^[A-Za-z0-9_-]{43}$/u)
    assert.ok(session.expiresAtUnixMs >= startedAt + 8 * 60 * 60 * 1000 - 5_000)
    const cookie = this.client.sessionResponse.headers.get('set-cookie')
    assert.match(cookie, /^hatter_console_session=[A-Za-z0-9_-]{43}; Max-Age=28800; Path=\/; HttpOnly; SameSite=Strict$/u)
    assertSecurityHeaders(this.client.sessionResponse)
    for (const path of ['/api/session/passkey/start', '/api/device-security/passkey/start']) {
      const removed = await this.client.postResponse(path, {}, { expected: 404 })
      assert.equal(removed.response.status, 404)
    }
  }

  async verify_repeatable_connection() {
    const value = await this.client.postResponse('/api/connection', {}, {
      authenticated: false, mutation: false, cookie: null
    })
    assertKeys(value.body, ['csrf', 'expiresAtUnixMs'])
    assert.notEqual(value.body.csrf, this.client.csrf)
    assert.equal(this.process.launchUrl, 'http://localhost:4213/')
    for (const path of ['/api/session', '/api/session/connect', '/api/session/logout']) {
      assert.equal((await this.client.postResponse(path, {}, { expected: 404 })).response.status, 404)
    }
  }

  async verify_dynamic_dictionary() {
    const dictionary = await this.client.get('/api/semantic/views')
    const examples = JSON.parse(await readFile(new URL('../reviewed-ui-examples.json', import.meta.url), 'utf8'))
    assertReviewedExamples(dictionary, examples)
    assert.deepEqual(dictionary, await cliJson(this, ['profile', 'dictionary']))
    const interfaces = await cliJson(this, ['interface', '--json'])
    assert.deepEqual(interfaces.operations.find(operation => operation.id === 'profile.dictionary.read'), {
      id: 'profile.dictionary.read', label: 'Inspect adopted language and view bindings',
      cli: 'hatter profile dictionary', webPath: '/ontology',
      webAction: 'Adopted language and exact view bindings'
    })
    assert.equal(dictionary.language.owner, 'sem-lang')
    assert.match(dictionary.language.digest, /^[0-9a-f]{64}$/u)
    assert(dictionary.language.terms.length > 0)
    assert(dictionary.views.some(view => view.scene === 'person'))
    const references = new Set(dictionary.language.terms.map(term => term.reference))
    assert.equal(references.size, dictionary.language.terms.length)
    assert.equal(dictionary.language.digest, CATALOG_DIGEST(JSON.stringify(dictionary.language.terms.map(
      term => ({ reference: term.reference, symbol: term.symbol, layer: term.layer })))))
    assert(dictionary.views.every(view => references.has(view.baseReference)))
    assert.deepEqual(dictionary.forms, await cliJson(this, ['profile', 'forms']))
    const forms = (await this.client.get('/api/profile/forms')).forms
    assert.deepEqual(forms.map(form => form.formId), dictionary.forms.map(form => form.form_id))
    for (const form of forms) {
      const raw = dictionary.forms.find(value => value.form_id === form.formId)
      assert.deepEqual(form.labels, raw.labels)
      for (const field of form.fields) {
        const declared = raw.fields.find(value => value.path === field.fieldId)
        assert.deepEqual(field.meaning, declared.meaning)
        assert(references.has(field.meaning.baseReference))
        assert.equal(field.meaning.schemaId, form.valueSchema)
        assert.equal(field.meaning.fieldPath, field.fieldId)
        assert.equal(field.meaning.languageDigest, dictionary.language.digest)
      }
    }
    const before = await this.client.get('/api/profile/onboarding')
    assert.deepEqual(before.tasks.map(task => task.id),
      dictionary.forms.filter(form => form.setup).map(form => form.setup.id))
    await verifyDictionaryBrowser(this, dictionary, forms)
    assert.deepEqual(await this.client.get('/api/profile/onboarding'), before,
      'viewing definitions must not invent personal facts or setup tasks')
    assert.deepEqual((await this.client.get('/api/profile/entries')).entries, [])
    this.initialDictionary = dictionary
  }

  async verify_memory_navigation_boundary() {
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await browser.page.locator('.console-scene-shell').waitFor()
      assert.equal(await browser.page.locator('a[href^="/history"]').count(), 0)
      await browser.page.keyboard.press('Control+k')
      await browser.page.getByRole('dialog').waitFor()
      assert.equal(await browser.page.getByRole('dialog').getByRole('button', {
        name: /^History\b/u }).count(), 0)
      await browser.page.keyboard.press('Escape')
      await browser.page.locator('a[href="/memory"]').click()
      await browser.page.locator('[data-memory-state="unavailable"]').waitFor()
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        await browser.page.setViewportSize(viewport)
        const layout = await browser.page.locator('[data-memory-view]').evaluate(node => {
          const rect = node.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: innerWidth,
            documentWidth: document.documentElement.scrollWidth }
        })
        assert(layout.left >= 0 && layout.right <= layout.width + 1
          && layout.documentWidth <= layout.width, JSON.stringify(layout))
      }
      assert.deepEqual(await this.client.get('/api/memory'), { role: 'self', revision: null, shortTerm: null, candidates: [] })
      assert.deepEqual(await this.client.get('/api/memory'), await cliJson(this, ['memory', 'read']))
      const response = await browser.page.request.get(new URL('/history', this.process.launchUrl).href,
        { maxRedirects: 0 })
      assert.equal(response.status(), 404, 'retired history must not be redirected or renamed memory')
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async verify_semantic_memory_projection() {
    const before = await this.client.get('/api/profile/entries')
    const dictionary = await this.client.get('/api/semantic/views')
    assertDefinitionMemory(dictionary)
    assert.deepEqual(dictionary, await cliJson(this, ['profile', 'dictionary']))
    assert.deepEqual(await this.client.get('/api/profile/entries'), before,
      'reading adopted definitions cannot create or promote personal facts')
    assert.deepEqual(await this.client.get('/api/semantic/views'), dictionary,
      'read-only inspection cannot rewrite adopted memory')
  }

  async verify_context_checkpoint_lifecycle() {
    const role = 'e2e-observer'
    const input = { local_time: '', semantic_expression: 'Time(relative=tomorrow)',
      context_holes: [], linguistic_holes: ['reference-date'], memory_class: 'ShortTerm',
      retention: 'KeepAsEvidence', surface_evidence: 'tomorrow' }
    const request = { role, expectedRevision: null, decisionRef: 'e2e:input:1',
      operation: { kind: 'retain', input } }
    const path = join(this.root, 'context-request.json')
    await writeFile(path, JSON.stringify(request))
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await browser.page.goto(new URL(`/memory?role=${role}`, this.process.launchUrl).href)
      await browser.page.locator('[data-memory-state="unavailable"]').waitFor()
      const written = await cliJson(this, ['memory', 'apply', '--request-json', path])
      assert.deepEqual(written.shortTerm, [input])
      assert.match(written.revision, /^[0-9a-f]{64}$/u)
      assert.deepEqual(await this.client.get(`/api/memory?role=${role}`), written)
      assert.deepEqual(await cliJson(this, ['memory', 'read', '--role', role]), written,
        'a new CLI process must restore the exact committed checkpoint')
      assert.equal((await this.client.get('/api/memory')).shortTerm, null,
        'private role input must never appear in the owner context')
      await browser.page.locator('[data-memory-state="available"]').waitFor()
      assert.equal(await browser.page.locator('td code').innerText(), input.semantic_expression)
      assert.equal(await browser.page.locator('[data-memory-role]').innerText(), role)
      await assert.rejects(cliJson(this, ['memory', 'apply', '--request-json', path]), /context revision conflict/u)
      await browser.page.locator('[data-memory-clear]').click()
      await browser.page.locator('[data-memory-clear-confirm]').click()
      await browser.page.locator('[data-memory-state="empty"]').waitFor()
      const cleared = await this.client.get(`/api/memory?role=${role}`)
      assert.deepEqual(cleared.shortTerm, [])
      assert.notEqual(cleared.revision, written.revision)
      assert.deepEqual(await cliJson(this, ['memory', 'read', '--role', role]), cleared)
      const writers = await Promise.all([0, 1].map(async index => {
        const requestPath = join(this.root, `context-writer-${index}.json`)
        await writeFile(requestPath, JSON.stringify({ ...request, expectedRevision: cleared.revision,
          decisionRef: `e2e:writer:${index}`, operation: { kind: 'retain', input: {
            ...input, semantic_expression: `Candidate(${index})` } } }))
        return requestPath
      }))
      const results = await Promise.allSettled(writers.map(requestPath =>
        cliJson(this, ['memory', 'apply', '--request-json', requestPath])))
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1,
        'exactly one independent CLI process may commit against the same revision')
      const winner = results.find(result => result.status === 'fulfilled').value
      assert.deepEqual(await this.client.get(`/api/memory?role=${role}`), winner)
      const stale = await this.client.post('/api/memory', { role,
        expectedRevision: cleared.revision, decisionRef: 'e2e:stale:clear', operation: { kind: 'clear' } }, 409)
      assert.equal(stale.statusMessage, 'hatter-console-memory-state-revision-conflict')
      assert.deepEqual(await cliJson(this, ['memory', 'read', '--role', role]), winner)
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async verify_dynamic_installed_dictionary() {
    const dictionary = await this.client.get('/api/semantic/views')
    assert(dictionary.views.some(view => view.providers.includes('hat-accountant')))
    assert(dictionary.views.length > this.initialDictionary.views.length)
    assert.deepEqual(dictionary, await cliJson(this, ['profile', 'dictionary']))
    const additions = dictionary.views.filter(view => view.providers.length)
    const terms = this.fixture.packages.flatMap(pkg => [
      ...pkg.document.catalog.terms.filter(term => term.reference.kind === 'entity-type').map(term => term.reference.term_id),
      ...(pkg.document.information_surfaces ?? []).map(surface => surface.canonical_type)])
    assert.deepEqual(additions.map(view => view.reference).sort(), [...new Set(terms)].sort())
    if (!process.env.HATTER_E2E_RELEASE_CATALOG_DIR) {
      assert.equal(additions.filter(view => view.reference.includes('/fixture-')).length, this.fixture.packages.length)
    }
    for (const view of additions) {
      const declarations = this.fixture.packages.flatMap(pkg => pkg.document.catalog.terms
        .filter(term => term.reference.term_id === view.reference)
        .map(term => ({ provider: pkg.repositoryId, reference: term.reference })))
      const surfaces = this.fixture.packages.flatMap(pkg => (pkg.document.information_surfaces ?? [])
        .filter(surface => surface.canonical_type === view.reference).map(surface => ({ provider: pkg.repositoryId, surface })))
      assert.deepEqual(view.providers, [...new Set([...declarations, ...surfaces].map(value => value.provider))])
      assert.deepEqual(view.catalogReferences, declarations.map(value => value.reference))
      for (const { provider, surface } of surfaces) {
        const reference = view.surfaceReferences.find(ref => ref.repositoryId === provider && ref.surfaceId === surface.id)
        assert.equal(reference.projectionSchema, surface.projection_schema)
        assert.match(reference.definitionDigest, /^[0-9a-f]{64}$/u)
      }
      assert.deepEqual(view.vocabularyTerms, [view.reference])
      const label = this.fixture.packages.flatMap(pkg => pkg.document.catalog.lexicalizations)
        .find(entry => entry.term.term_id === view.reference && entry.locale === 'en')?.preferred ?? view.reference
      assert.equal(view.labels.en, label)
    }
    await verifyDictionaryBrowser(this, dictionary)
    this.installedDictionary = dictionary
  }

  async verify_dynamic_restarted_dictionary() {
    assert.deepEqual(await this.client.get('/api/semantic/views'), this.installedDictionary)
    assert.deepEqual(await cliJson(this, ['profile', 'dictionary']), this.installedDictionary)
    await verifyDictionaryBrowser(this, this.installedDictionary)
  }

  async verify_declared_profile_write_and_recovery() {
    const dictionary = await this.client.get('/api/semantic/views')
    const form = dictionary.forms.find(form => form.setup?.id === 'identity')
    const view = dictionary.views.find(view => view.formIds.includes(form.form_id))
    const field = form.fields.find(field => field.path === form.setup.requiredFieldIds[0])
    const value = 'Owner ' + randomUUID()
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, `/profile/${view.id}`, [form.labels.en[form.title_key]])
      const card = browser.page.locator(`[data-semantic-form="${form.form_id}"]`)
      await card.locator(`[data-semantic-path="${field.path}"] input`).fill(value)
      const saved = browser.page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/profile/entries' && response.request().method() === 'POST')
      await card.locator('button[type="submit"]').click()
      const response = await saved
      assert.equal(response.status(), 200)
      const stored = (await response.json()).entry
      assert.equal(stored.formId, form.form_id)
      assert.deepEqual(stored.values, { [field.path]: value })
      const rows = (await this.client.get('/api/profile/entries')).entries
      assert.deepEqual(rows, [stored])
      const cli = await cliJson(this, ['profile', 'list'])
      assert.equal(cli.length, 1)
      assert.deepEqual(cli[0].values, stored.values)
      assert.equal(cli[0].form_id, stored.formId)
      assert.equal(cli[0].revision, stored.revision)
      const onboarding = await this.client.get('/api/profile/onboarding')
      assert.equal(onboarding.tasks.find(task => task.id === form.setup.id).complete, true)
      assert.equal(onboarding.completedTaskCount, 1)
      await browser.page.reload()
      await pageText(browser, this.process.launchUrl, `/profile/${view.id}`, ['revision 1'], false)
      assert.equal(await browser.page.locator(`[data-semantic-form="${form.form_id}"] input`).first().inputValue(), value)
      assert.deepEqual(browserFailures(browser.failures), [])
      this.profileWriteSnapshot = rows
      const languageForm = dictionary.forms.find(form => form.setup?.id === 'languages')
      const languageView = dictionary.views.find(view => view.formIds.includes(languageForm.form_id))
      // Select a translated language first, then an untranslated one. Expected text
      // is independently reviewed, not copied from the API being tested.
      await pageText(browser, this.process.launchUrl, `/profile/${languageView.id}`,
        [languageForm.labels.en[languageForm.title_key]])
      const japaneseCard = browser.page.locator(`[data-semantic-form="${languageForm.form_id}"]`)
      const japaneseSelection = japaneseCard.locator('[data-semantic-path="primary_language"]').getByRole('combobox')
      if (await japaneseSelection.evaluate(element => element.tagName) === 'SELECT') await japaneseSelection.selectOption('ja')
      else {
        await japaneseSelection.click()
        await browser.page.getByRole('option', { name: 'Japanese', exact: true }).click()
      }
      const japaneseSaved = browser.page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/profile/entries' && response.request().method() === 'POST')
      await japaneseCard.locator('button[type="submit"]').click()
      assert.equal((await japaneseSaved).status(), 200)
      await pageText(browser, this.process.launchUrl, '/profile', ['基本情報', '場所'])
      assert.equal(await browser.page.locator('html').getAttribute('lang'), 'ja')
      assert.equal(await browser.page.locator('[data-semantic-view="identity"]').innerText(), '基本情報')
      assert.equal((await this.client.get('/api/profile/overview')).informationAreas.find(area => area.projectionId === 'people').label, '人')
      await pageText(browser, this.process.launchUrl, '/world', ['人'])
      await browser.page.locator('[data-semantic-world="people"]').click()
      await pageText(browser, this.process.launchUrl, '/semantic/people', ['人'], false)
      assert.equal((await this.client.get('/api/digital-twin/people')).label, '人')
      await pageText(browser, this.process.launchUrl, `/profile/${languageView.id}`,
        [languageForm.labels.ja[languageForm.title_key]])
      const languageCard = browser.page.locator(`[data-semantic-form="${languageForm.form_id}"]`)
      const selection = languageCard.locator('[data-semantic-path="primary_language"]').getByRole('combobox')
      if (await selection.evaluate(element => element.tagName) === 'SELECT') await selection.selectOption('fr')
      else {
        await selection.click()
        await browser.page.getByRole('option', { name: 'フランス語', exact: true }).click()
      }
      const languageSaved = browser.page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/profile/entries' && response.request().method() === 'POST')
      await languageCard.locator('button[type="submit"]').click()
      assert.equal((await languageSaved).status(), 200)
      await pageText(browser, this.process.launchUrl, `/profile/${view.id}`, [form.labels.en[form.title_key]])
      assert.equal(await browser.page.locator('html').getAttribute('lang'), 'fr')
      await pageText(browser, this.process.launchUrl, '/profile', ['Identity', 'Place'])
      assert.equal(await browser.page.locator('[data-semantic-view="identity"]').innerText(), 'Identity')
      await pageText(browser, this.process.launchUrl, `/profile/${view.id}`, [form.labels.en[form.title_key]])
      assert.equal(await browser.page.locator(`[data-semantic-form="${form.form_id}"] input`).first().inputValue(), value)
      this.profileWriteSnapshot = (await this.client.get('/api/profile/entries')).entries
      assert.equal(this.profileWriteSnapshot.find(entry => entry.formId === languageForm.form_id).values.primary_language, 'fr')
      assert.equal((await this.client.get('/api/profile/onboarding')).completedTaskCount, 2)
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
    await this.restart_console()
    await this.connect_browser()
    assert.deepEqual((await this.client.get('/api/profile/entries')).entries, this.profileWriteSnapshot)
    assert.deepEqual(await this.client.get('/api/semantic/views'), dictionary,
      'saving a fact must not mutate language definitions')
  }

  async verify_retired_translation_absence() {
    const before = await this.client.get('/api/semantic/views')
    for (const text of ['本人性', '必要なら変更して']) {
      await this.client.post('/api/meaning/interpret', {
        expressionId: 'retired-expression', locale: 'ja', text
      }, 404)
    }
    assert.deepEqual(await this.client.get('/api/semantic/views'), before)
  }

  async open_pages() {
    for (const path of ['/', '/hats', '/domains', '/system/hats/structure', '/system/hats/sources',
      '/system/hats/composition', '/system/hats/projection-journal']) {
      const value = await this.client.page(path)
      assert.equal(value.response.headers.get('content-type')?.startsWith('text/html'), true)
      assertSecurityHeaders(value.response)
      assert.match(value.body, /^<!DOCTYPE html>/u)
      assert.doesNotMatch(value.body, /hatter-console-(?:runtime-unavailable|host-rejected)/u)
      assert.match(value.body, /\/_nuxt\//u)
    }
  }

  async read_default_sources() {
    const value = await this.client.get('/api/hats/catalog-sources')
    assertKeys(value, ['revision', 'schema', 'selectedSourceId', 'sources'])
    assert.equal(value.schema, 'hathq://hatter-console/catalog-sources/v1')
    assert.equal(value.revision, 0)
    assert.equal(value.selectedSourceId, 'ihat-official')
    assert.equal(value.sources.length, 1)
    const source = value.sources[0]
    assertKeys(source, ['kind', 'label', 'locationSummary', 'logicalOrigin',
      'publicKeyFingerprint', 'selected', 'signingKeyId', 'sourceId',
      'federationSigningKeyId', 'federationPublicKeyFingerprint', 'placementAvailable'])
    assert.equal(source.sourceId, 'ihat-official')
    assert.equal(source.kind, 'https')
    assert.equal(source.logicalOrigin, 'https://ihat.space')
    assert.equal(source.selected, true)
    assert.equal(source.federationSigningKeyId, null)
    assert.equal(source.federationPublicKeyFingerprint, null)
    assert.equal(source.placementAvailable, false)
    assert.equal(JSON.stringify(value).includes('/home/'), false)
  }

  async read_empty_initial_state() {
    const value = await this.client.get('/api/overview')
    assert.equal(value.overview.installedHatCount, 0)
    assert.equal(Object.hasOwn(value.overview, 'builtInHats'), false)
    assert.equal(value.overview.hatBinding.state, 'available')
    assert.equal(value.overview.hatBinding.activeActionCount, 0)
    assert.equal(value.overview.account.persistence, 'process-ephemeral')
    assert.equal(value.account.state, 'signed-out')
    const providers = await this.client.get('/api/models/providers')
    assert.equal(providers.schema, 'hathq://hatter-console/model-providers/v1')
    assert.equal(providers.providers.filter(provider => provider.active).length, 1)
    const activeProvider = providers.providers.find(provider => provider.active)
    assert(activeProvider)
    const modelCatalog = await this.client.get(
      `/api/models?providerId=${encodeURIComponent(activeProvider.id)}`)
    assertKeys(modelCatalog, ['models', 'usage'])
    assertKeys(modelCatalog.models, ['models', 'provider', 'schema'])
    assert.equal(modelCatalog.models.schema, 'hathq://hatter-console/models/v1')
    assertKeys(modelCatalog.models.provider, ['id', 'name', 'requiresAccount'])
    assert.equal(modelCatalog.models.provider.id, activeProvider.id)
    assert.equal(modelCatalog.models.provider.name, activeProvider.name)
    assert.equal(modelCatalog.models.provider.requiresAccount, activeProvider.requiresAccount)
    assert.equal(value.overview.modelCatalog.count, modelCatalog.models.models.length)
    assert.equal(new Set(modelCatalog.models.models.map(model => model.id)).size,
      modelCatalog.models.models.length)
    assert.equal(modelCatalog.models.models.some(model => model.default), false)
    assert.equal(value.overview.modelCatalog.defaultModel, null)
    const capabilities = await this.client.get('/api/hats/capabilities')
    assert.deepEqual(capabilities.capabilities, [])
    const surfaces = await this.client.get('/api/hats/information-surfaces')
    assert.deepEqual(surfaces.surfaces, [])
    const flow = await this.client.get('/api/action-flow')
    assert.deepEqual(flow.items.filter(item => item.actionable).map(item => item.flowItemId), [
      'setup-profile-identity', 'setup-profile-residence', 'setup-profile-languages',
    ])
    assert(flow.items.slice(0, 3).every(item => item.source.kind === 'hatter'
      && item.target?.to.startsWith('/?task=')))
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/memory', ['Short-term memory is not connected'])
      assert.equal(await browser.page.locator('a[href^="/history"]').count(), 0)
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async verify_empty_world() {
    const ontology = await this.client.get('/api/ontology')
    assert.equal(ontology.catalog.ownerRepositoryId, 'hat-specifications')
    assert.equal(ontology.totals.hat, 0)
    const foundation = ontology.contexts.find(value => value.id === 'foundation')
    const nodes = new Map(foundation.nodes.map(node => [node.id, node]))
    assert.equal(nodes.size, ontology.totals.foundation)
    assert(ontology.relations.length > 0)
    for (const relation of ontology.relations) {
      assert(nodes.has(relation.sourceId) && nodes.has(relation.targetId))
      assert(['depends-on', 'is-a', 'domain', 'range'].includes(relation.kind))
    }
    for (const node of nodes.values()) if (node.parentId) assert(ontology.relations.some(
      relation => relation.kind === 'is-a' && relation.sourceId === node.id
        && relation.targetId === node.parentId))
    const person = ontology.concepts.find(value => value.id === 'world.person')
    assert.equal(person.label, 'Person')
    assert(ontology.relations.some(value => value.kind === 'depends-on'
      && value.sourceId === 'foundation:world.person' && value.targetId === 'foundation:core.entity'))
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/ontology', ['hat-specifications', person.label])
      await browser.page.getByRole('button', { name: person.label, exact: true }).click()
      await browser.page.getByText('depends-on', { exact: true }).first().waitFor()
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
    const value = await this.client.get('/api/now')
    assert.equal(value.schema, 'hathq://hatter-console/now-projection/v2')
    assert.deepEqual(value.timeline, [])
    assert.equal(value.mapFeatures.length, 0)
    assert.equal(value.contributionCount, 0)
    assert.deepEqual(value.attention, [])
    assert.equal(value.graph.nodes.length, 1)
    assert.equal(value.graph.nodes[0].label, 'self')
    assert.deepEqual(value.graph.edges, [])
    for (const obsolete of ['digitalTwin', 'semanticAreas', 'categories', 'situations', 'todos']) {
      assert.equal(Object.hasOwn(value, obsolete), false)
    }
    const wakeup = await this.client.get('/api/tasks/runnable')
    assertKeys(wakeup, ['graphRevision', 'observedAtEpochS', 'schema', 'tasks', 'truncated'])
    assert.equal(wakeup.schema, 'hathq://hatter/operational-wakeup/v1')
    assert.deepEqual(wakeup.tasks, [])
    assert.equal(wakeup.truncated, false)
  }

  async select_local_source() {
    const f = this.fixture
    const body = { sourceId: 'e2e-local', label: 'E2E local signed catalog',
      kind: 'local_directory', location: f.catalog, logicalOrigin: f.origin,
      signingKeyId: f.signingKeyId, publicKeyHex: f.publicKeyHex,
      federationSigningKeyId: f.federationSigningKeyId,
      federationPublicKeyHex: f.federationPublicKeyHex,
      expectedRevision: 0, select: true }
    const rejected = await this.client.postResponse('/api/hats/catalog-sources', body,
      { expected: 403, csrf: 'wrong-csrf', nonce: randomUUID() })
    assert.equal(rejected.body.statusMessage, 'hatter-console-csrf-rejected')
    const invalidNonce = await this.client.postResponse('/api/hats/catalog-sources', body,
      { expected: 403, nonce: 'not-a-uuid' })
    assert.equal(invalidNonce.body.statusMessage, 'hatter-console-request-nonce-invalid')
    const nonce = randomUUID()
    const accepted = await this.client.postResponse('/api/hats/catalog-sources', body, { nonce })
    const value = accepted.body
    assert.equal(value.revision, 1)
    assert.equal(value.selectedSourceId, 'e2e-local')
    assert.equal(value.sources.length, 2)
    const selected = value.sources.find(source => source.selected)
    assert.equal(selected.sourceId, 'e2e-local')
    assert.equal(selected.kind, 'local_directory')
    assert.equal(selected.logicalOrigin, f.origin)
    assert.equal(selected.signingKeyId, f.signingKeyId)
    assert.equal(selected.publicKeyFingerprint, f.publicKeyHex.slice(0, 16))
    assert.equal(selected.federationSigningKeyId, f.federationSigningKeyId)
    assert.equal(selected.federationPublicKeyFingerprint,
      f.federationPublicKeyHex.slice(0, 16))
    assert.equal(selected.placementAvailable, true)
    assert.equal(selected.locationSummary, 'ローカルディレクトリ')
    assert.equal(JSON.stringify(value).includes(f.catalog), false)
    const replayed = await this.client.postResponse('/api/hats/catalog-sources', body,
      { expected: 403, nonce })
    assert.equal(replayed.body.statusMessage, 'hatter-console-request-replayed')
  }

  async reject_stale_source_revision() {
    const before = await this.client.get('/api/hats/catalog-sources')
    const value = await this.client.post('/api/hats/catalog-sources', {
      sourceId: 'e2e-stale', label: 'Stale source', kind: 'local_directory',
      location: this.fixture.catalog, logicalOrigin: this.fixture.origin,
      signingKeyId: this.fixture.signingKeyId,
      publicKeyHex: this.fixture.publicKeyHex,
      federationSigningKeyId: this.fixture.federationSigningKeyId,
      federationPublicKeyHex: this.fixture.federationPublicKeyHex,
      expectedRevision: 0, select: false
    }, 409)
    assert.equal(value.statusMessage, 'hatter-console-hat-state-revision-conflict')
    assert.deepEqual(await this.client.get('/api/hats/catalog-sources'), before)
  }

  async reject_tampered_catalog() {
    await tamperCatalog(this.fixture)
    try {
      const value = await this.client.get('/api/hats/candidates', 503)
      assert.equal(value.statusMessage, 'hatter-console-hat-catalog-verification-failed')
    } finally { await restoreCatalog(this.fixture) }
  }

  async list_catalog() {
    const value = await this.client.get('/api/hats/candidates')
    assert.equal(value.schema, 'hathq://hatter-console/hat-discovery/v1')
    assert.equal(value.status, 'available')
    assert.equal(value.reason, null)
    assert.equal(value.sourceId, 'e2e-local')
    assert.equal(value.sourceKind, 'local_directory')
    assert.equal(value.logicalOrigin, this.fixture.origin)
    assert.equal(value.artifactAcquisitionAvailable, true)
    assert.equal(value.catalogDigestSha256, this.catalogDigest)
    const entries = this.fixture.catalogIndex.entries
    assert.deepEqual(value.candidates.map(item => item.repositoryId),
      entries.map(item => item.repository_id))
    for (const item of entries) {
      const candidate = candidateOf(value, item.repository_id)
      assert.equal(candidate.packageId, item.package_id)
      assert.equal(candidate.version, item.version)
      assert.equal(candidate.packageSha256, item.package_sha256)
      assert.equal(candidate.genreHandle, `category-${item.category_id}-v1`)
      assert.equal(candidate.availability, 'installable')
      assert.equal(candidate.updateState, 'not-installed')
    }
    assert.deepEqual(value.genres, this.fixture.catalogIndex.categories.map(category => ({
      handle: `category-${category.id}-v1`, categoryId: category.id,
      termId: category.term_id, label: category.en.name, summary: category.en.summary,
      installedHatCount: 0,
      availableHatCount: entries.filter(item => item.category_id === category.id).length
    })))
    this.categoryPath = '/domains/category-finance-v1'
  }

  async reject_tampered_package() {
    const target = this.fixture.packages[0]
    await tamperPackage(this.fixture, target.repositoryId)
    try {
      const value = await this.client.post('/api/hats/install-official', {
        repositoryId: target.repositoryId
      }, 400)
      assert.equal(value.statusMessage, 'hatter-console-hat-package-verification-failed')
      const catalog = await this.client.get('/api/hats/candidates')
      assert.equal(candidateOf(catalog, target.repositoryId).availability, 'installable')
      const absent = await this.client.get(
        `/api/hats/package?repositoryId=${target.repositoryId}`, 503)
      assert.equal(absent.statusMessage, 'hatter-console-hat-package-not-installed')
    } finally { await restorePackage(this.fixture, target.repositoryId) }
  }

  async install_packages() {
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/world',
        this.initialDictionary.views.filter(view => view.scene === 'world').map(view => view.labels.en))
      for (const item of this.fixture.packages) {
        const value = await this.client.post('/api/hats/install-official', {
          repositoryId: item.repositoryId
        })
        assertInstallation(value, item)
        const dictionary = await this.client.get('/api/semantic/views')
        const expected = dictionary.views.filter(view => view.scene === 'world').map(view => view.id)
        await browser.page.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('[data-semantic-world]')]
          .map(node => node.dataset.semanticWorld)) === JSON.stringify(ids), expected, { timeout: 12_000 })
        assert.equal(new URL(browser.page.url()).pathname, '/world', 'installation must invalidate the open scene without navigation')
      }
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
    const catalog = await this.client.get('/api/hats/candidates')
    const finance = catalog.genres.find(item => item.categoryId === 'finance')
    assert.equal(finance?.installedHatCount, 2)
    assert.deepEqual(this.fixture.packages.map(item =>
      candidateOf(catalog, item.repositoryId).availability), ['installed', 'installed'])
    assert.equal(catalog.candidates.filter(item => item.availability === 'installed').length, 2)
  }

  async verify_idempotent_install() {
    const item = this.fixture.packages[0]
    const before = await this.client.get(`/api/hats/package?repositoryId=${item.repositoryId}`)
    const replay = await this.client.post('/api/hats/install-official', {
      repositoryId: item.repositoryId
    })
    assertInstallation(replay, item)
    assert.deepEqual(await this.client.get(
      `/api/hats/package?repositoryId=${item.repositoryId}`), before)
  }

  async read_package_descriptors() {
    for (const item of this.fixture.packages) {
      const value = await this.client.get(`/api/hats/package?repositoryId=${item.repositoryId}`)
      assertInstallation(value, item)
      assertDescriptor(value.descriptor, item.document)
    }
  }

  async open_installed_categories() {
    await this.client.page('/domains')
    await this.client.page(this.categoryPath)
    await this.client.page('/system/hats/structure')
  }

  async prepare_full_composition() {
    this.fullPlan = await this.prepareComposition(
      ['hat-budget-planner', 'hat-accountant'], 'proposal-full-1')
    assertProposal(this.fullPlan, this.fixture, null,
      ['hat-accountant', 'hat-budget-planner'])
    for (const member of this.fullPlan.plan.proposal.members) {
      const catalog = this.fixture.packages.find(item => item.repositoryId === member.repositoryId).document.catalog
      const dependencies = catalog.dependencies.filter(item => item.catalog_id !== 'hathq.foundation')
        .map(item => this.fixture.packages.find(candidate => candidate.document.catalog.identity.catalog_id === item.catalog_id)?.repositoryId)
        .sort()
      assert.ok(dependencies.every(Boolean), 'every signed dependency must resolve to an installed package')
      assert.deepEqual(member.dependencyRepositoryIds, dependencies)
    }
  }

  async approve_full_composition() {
    this.fullApprovalJson = approvalJson(this.fullPlan, 'approval-full-1')
    this.composition = await this.client.post('/api/hats/composition', {
      proposalJson: this.fullPlan.plan.proposalJson,
      approvalJson: this.fullApprovalJson
    })
    assertComposition(this.composition, this.fullPlan, 1,
      { 'hat-accountant': [1, true], 'hat-budget-planner': [1, true] })
  }

  async verify_full_composition() {
    const read = await this.readComposition()
    assert.deepEqual(read, this.composition)
    for (const binding of read.composition.bindings) {
      const expectedPartition = partitionId(SUBJECT, SCOPE, binding.repositoryId)
      assert.equal(binding.contextPartitionId, expectedPartition)
      assert.equal(binding.subjectRef, SUBJECT)
      assert.equal(binding.scopeRef, SCOPE)
      assert.equal(binding.catalogDigestSha256, this.fixture.packages.find(
        item => item.repositoryId === binding.repositoryId).document.catalog.identity.digest_sha256)
      assert.equal(binding.fittingDigestSha256, FITTING)
      assert.equal(binding.policyDigestSha256, POLICY)
      const direct = await this.client.get(`/api/hats/binding?${new URLSearchParams({
        contextPartitionId: expectedPartition, repositoryId: binding.repositoryId })}`)
      assert.deepEqual(direct.binding, binding)
    }
  }

  async verify_guided_initial_state() {
    const tutorial = await this.client.get('/api/tutorial')
    assert.equal(tutorial.schema, 'hathq://hatter-console/first-use-tutorial/v2')
    assert.equal(tutorial.complete, false)
    assert.equal(tutorial.completedStepCount, 0)
    assert.equal(tutorial.totalStepCount, 3)
    assert.equal(tutorial.nextStepId, 'identity')
    assert.deepEqual(tutorial.steps.map(item => [item.id, item.complete, item.target]), [
      ['identity', false, '/?task=identity'],
      ['residence', false, '/?task=residence'],
      ['languages', false, '/?task=languages']
    ])
    assert.deepEqual(tutorial.graph.nodes.map(item => [item.id, item.state]), [
      ['owner', 'ready'],
      ['identity', 'pending'],
      ['residence', 'pending'], ['regional-information', 'pending'],
      ['languages', 'pending'], ['interface-language', 'pending']
    ])
    assert.deepEqual(tutorial.graph.relations.map(item =>
      [item.sourceId, item.kind, item.targetId]), [
      ['owner', 'identifies', 'identity'],
      ['owner', 'resides', 'residence'], ['residence', 'matches', 'regional-information'],
      ['owner', 'uses', 'languages'], ['languages', 'displays', 'interface-language']
    ])
    const setup = await this.client.get('/api/hats/setup-tasks')
    assert.deepEqual(setup, { schema: 'hathq://hatter-console/hat-setup-tasks/v2', tasks: [] })
    const flow = await this.client.get('/api/action-flow')
    const accountantBinding = bindingOf(this.composition, 'hat-accountant')
    const placement = flow.items.find(item => item.flowItemId
      === `placement-${accountantBinding.contextPartitionId}-hat-accountant`)
    assert.deepEqual(placement, {
      flowItemId: `placement-${accountantBinding.contextPartitionId}-hat-accountant`,
      recordType: 'action', itemKind: 'task',
      title: 'Select an execution location for hat-accountant', status: 'unresolved',
      actionable: true, time: null, place: null, actors: ['self'], objectLabel: 'hat-accountant',
      target: { kind: 'console-route',
        to: `/system/hats/bindings?contextPartitionId=${accountantBinding.contextPartitionId}&repositoryId=hat-accountant` },
      reason: '1 signed execution location is available.',
      coordination: { layer: 'human', kind: 'operation' }, source: { kind: 'hat',
        repositoryId: 'hat-accountant', digestSha256: accountantBinding.packageSha256,
        revision: 1 } })
    const capabilityProjection = await this.client.get('/api/hats/capabilities')
    assert.equal(capabilityProjection.capabilities.some(item =>
      item.repositoryId === 'hat-digital-twin-coordinator'
      || item.repositoryId === 'hat-github-operator'), false)
    assert.deepEqual(flow.items.filter(item => item.recordType === 'action' && item.actionable
      && item.source.kind === 'hat').map(item => item.source.repositoryId),
    ['hat-accountant'])
    assert.deepEqual(flow.items.filter(item => item.actionable).map(item => item.flowItemId), [
      'setup-profile-identity', 'setup-profile-residence', 'setup-profile-languages',
      `placement-${accountantBinding.contextPartitionId}-hat-accountant`,
    ])
    const catalog = await this.client.get('/api/hats/candidates')
    const installed = new Set(this.fixture.packages.map(item => item.repositoryId))
    assert.deepEqual(catalog.candidates.map(item => [item.repositoryId, item.availability]),
      this.fixture.catalogIndex.entries.map(item => [item.repository_id,
        installed.has(item.repository_id) ? 'installed' : 'installable']))
    assert.deepEqual(this.composition.composition.bindings.map(item =>
      [item.repositoryId, item.active]), [
      ['hat-accountant', true], ['hat-budget-planner', true]
    ])
  }

  async verify_guided_ui() {
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/', [
        'Connect yourself to Hatter', '0 / 3',
        'Add your display name', 'Choose your country and region', 'Choose your languages'
      ])
      const tutorial = await this.client.get('/api/tutorial')
      const steps = browser.page.locator('.console-tutorial-step')
      assert.equal(await steps.count(), tutorial.steps.length)
      assert.deepEqual(await steps.evaluateAll(nodes => nodes.map(node => ({
        to: new URL(node.href).pathname + new URL(node.href).search,
        required: node.dataset.required === 'true'
      }))), tutorial.steps.map(step => ({ to: '/?task=' + step.id, required: !step.complete })))
      assert.equal(await browser.page.locator('.console-breadcrumbs').count(), 1)
      assert.equal(await browser.page.locator('.console-tutorial-node[data-state="pending"]').count(), 1)
      for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
        const layout = await sceneLayoutAt(browser, width, height)
        assert.equal(layout.panes.length, 1, 'one primary view, no retired detail pane')
        assert.ok(layout.panes[0].right <= width, 'primary view fits viewport')
        assert.ok(layout.documentWidth <= width && layout.bodyWidth <= width, 'no horizontal overflow')
        if (width !== 1024) this.uiEvidence.push({
          name: `initial-setup-${width}`, body: await browser.page.screenshot(), contentType: 'image/png'
        })
      }
      await sceneLayoutAt(browser, 1280, 800)
      for (const [task, expected] of [
        ['residence', ['Country and region', 'Regional information']],
        ['languages', ['Languages', 'Display language']]
      ]) {
        await browser.page.locator('.console-tutorial-step[href="/?task=' + task + '"]').click()
        await browser.page.waitForURL(url => url.pathname === '/' && url.searchParams.get('task') === task)
        await pageText(browser, this.process.launchUrl, '/?task=' + task, expected, false)
        assert.equal(await browser.page.locator('.console-tutorial-step[data-active="true"]').count(), 1)
        assert.equal(await browser.page.locator('.console-scene-detail').count(), 0)
      }
      await browser.page.locator('.console-global-status button').click()
      await browser.page.waitForURL(url => url.pathname === '/work')
      assert.equal(await browser.page.locator('.console-scene-detail').count(), 0)
      await pageText(browser, this.process.launchUrl, '/work', [
        'Current work', 'Select an execution location for hat-accountant'
      ], false)
      assert.ok((await pageFlowItemIds(browser)).includes(
        'placement-' + bindingOf(this.composition, 'hat-accountant').contextPartitionId + '-hat-accountant'))
      await selectTodo(browser)
      const flow = await this.client.get('/api/action-flow')
      const actionableIds = flow.items.filter(item => item.actionable).map(item => item.flowItemId)
      const shownIds = await pageFlowItemIds(browser, '.console-temporal-bar[data-open="true"]')
      for (const id of actionableIds) assert.ok(shownIds.includes(id), 'TODO contains exact flow ID ' + id)
      await browser.page.getByRole('button', { name: 'Close time bar' }).click()
      await browser.page.locator('.console-rail-home').click()
      await browser.page.waitForURL(url => url.pathname === '/' && !url.search)
      await pageText(browser, this.process.launchUrl, '/', ['Connect yourself to Hatter'], false)
      await pageText(browser, this.process.launchUrl, '/system', ['Hatter system'])
      const cardPadding = await browser.page.locator('.console-grid > [data-slot="root"]').first()
        .evaluate(card => {
          const values = slot => {
            const style = getComputedStyle(card.querySelector('[data-slot="' + slot + '"]'))
            return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
          }
          return { header: values('header'), body: values('body') }
        })
      assert.deepEqual(cardPadding.header, ['16px', '16px', '16px', '16px'])
      assert.deepEqual(cardPadding.body, ['16px', '16px', '16px', '16px'])
      const hatsText = await pageText(browser, this.process.launchUrl, '/hats', ['Accountant', 'Budget planner'])
      assert.equal(hatsText.includes('デジタルツイン・コーディネーター'), false)
      assert.equal(hatsText.includes('GitHub操作'), false)
      await browser.page.getByRole('button', { name: 'Open details', exact: true }).first().click()
      await pageText(browser, this.process.launchUrl, '/hats', ['classify-financial-record'], false)
      assert.equal(await browser.page.locator('.console-scene-detail').count(), 0)
      await pageText(browser, this.process.launchUrl, '/domains/category-finance-v1', [
        'Finance', 'Accountant', 'Budget planner'
      ])
      await pageText(browser, this.process.launchUrl, '/capabilities?repositoryId=hat-accountant', [
        'Accountant', 'classify-financial-record', '導入済み'
      ])
      const operationPath = '/operations/hat-accountant?' + new URLSearchParams({
        operationId: 'hathq://vocabulary/action/classify-financial-record/v1' })
      await pageText(browser, this.process.launchUrl, operationPath, [
        'classify-financial-record', '操作の現在地', '署名済みHATを確認',
        'financial-recordを用意', '利用する本人・役割・範囲を確認',
        '実行場所を確認', '実行機能との接続を確認', '操作を実行して結果を受け取る'
      ])
      assert.equal(await browser.page.locator('.console-breadcrumbs').count(), 1)
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async verify_composition_replay() {
    const before = await this.readComposition()
    const replay = await this.client.post('/api/hats/composition', {
      proposalJson: this.fullPlan.plan.proposalJson,
      approvalJson: this.fullApprovalJson
    })
    assert.deepEqual(replay, before)
    assert.equal(replay.composition.revision, 1)
  }

  async reject_stale_composition() {
    const stale = JSON.parse(this.fullPlan.plan.proposalJson)
    stale.proposal_id = 'proposal-stale'
    const proposalJson = JSON.stringify(stale)
    const digest = proposalDigest(proposalJson)
    const before = await this.readComposition()
    const value = await this.client.post('/api/hats/composition', { proposalJson,
      approvalJson: JSON.stringify({ schema: 'hathq://hat/composition-approval/v1',
        approval_id: 'approval-stale', proposal_digest_sha256: digest,
        approved_by_subject_ref: SUBJECT, expected_composition_revision: null }) }, 409)
    assert.equal(value.statusMessage, 'hatter-console-hat-state-revision-conflict')
    assert.deepEqual(await this.readComposition(), before)
  }

  async remove_composition_member() {
    const plan = await this.prepareComposition(['hat-accountant'], 'proposal-remove-budget')
    assertProposal(plan, this.fixture, 1, ['hat-accountant'])
    this.composition = await this.client.post('/api/hats/composition', {
      proposalJson: plan.plan.proposalJson,
      approvalJson: approvalJson(plan, 'approval-remove-budget')
    })
    assertComposition(this.composition, plan, 2,
      { 'hat-accountant': [2, true], 'hat-budget-planner': [2, false] })
  }

  async verify_removed_member() {
    const value = await this.readComposition()
    assert.deepEqual(value, this.composition)
    const removed = bindingOf(value, 'hat-budget-planner')
    const direct = await this.client.get(`/api/hats/binding?${new URLSearchParams({
      contextPartitionId: removed.contextPartitionId,
      repositoryId: removed.repositoryId })}`)
    assert.deepEqual(direct.binding, removed)
    assert.equal(direct.binding.active, false)
    assert.equal(direct.binding.revision, 2)
  }

  async restore_composition_member() {
    const plan = await this.prepareComposition(
      ['hat-accountant', 'hat-budget-planner'], 'proposal-restore-budget')
    assertProposal(plan, this.fixture, 2, ['hat-accountant', 'hat-budget-planner'])
    this.composition = await this.client.post('/api/hats/composition', {
      proposalJson: plan.plan.proposalJson,
      approvalJson: approvalJson(plan, 'approval-restore-budget')
    })
    assertComposition(this.composition, plan, 3,
      { 'hat-accountant': [3, true], 'hat-budget-planner': [3, true] })
  }

  async verify_restored_member() {
    const value = await this.readComposition()
    assert.deepEqual(value, this.composition)
    assert.deepEqual(value.composition.bindings.map(binding => [binding.repositoryId,
      binding.revision, binding.active]), [
      ['hat-accountant', 3, true], ['hat-budget-planner', 3, true]
    ])
  }

  async read_exact_capabilities() {
    const value = await this.client.get('/api/hats/capabilities')
    assert.equal(value.schema, 'hathq://hatter-console/hat-capabilities/v2')
    const packages = this.fixture.packages.map(item => ({
      repositoryId: item.repositoryId, packageId: item.packageId,
      packageSha256: item.packageDigest, operations: item.document.operations.map(operation =>
        [operation.id, operation.input_schema, operation.output_schema,
          operation.handler.kind, operation.handler.reference]) }))
    const owners = this.fixture.packages.map(item => ({ ...item,
      partition: partitionId(SUBJECT, SCOPE, item.repositoryId) }))
    const expected = []
    for (const owner of owners) for (const item of packages) {
      for (const [operationId, inputSchema, outputSchema,
        handlerKind, handlerReference] of item.operations) {
        expected.push({ contextPartitionId: owner.partition,
          repositoryId: item.repositoryId, packageId: item.packageId,
          packageSha256: item.packageSha256, operationId, inputSchema, outputSchema,
          handlerKind, handlerReference,
          state: item.repositoryId === owner.repositoryId
            ? 'placement_required' : 'binding_required' })
      }
    }
    assert.equal(value.capabilities.length, 4)
    expected.sort(capabilityOrder)
    const actual = value.capabilities.map(item => ({ contextPartitionId: item.contextPartitionId,
      repositoryId: item.repositoryId, packageId: item.packageId,
      packageSha256: item.packageSha256, operationId: item.operationId,
      inputSchema: item.inputSchema, outputSchema: item.outputSchema,
      handlerKind: item.handlerKind, handlerReference: item.handlerReference, state: item.state }))
    assert.deepEqual(actual, expected)
    this.capabilities = value
  }

  async read_exact_projection_journals() {
    this.projectionJournals = []
    for (const item of this.fixture.packages) {
      const contextPartitionId = partitionId(SUBJECT, SCOPE, item.repositoryId)
      const query = new URLSearchParams({ contextPartitionId, packageId: item.packageId })
      const value = await this.client.get(`/api/hats/projection-journal?${query}`)
      assert.deepEqual(value, { schema: 'hathq://hatter-console/hat-projection-journal/v1',
        projectionJournal: { schema: 'hathq://hat/projection-journal/v1', contextPartitionId,
          packageId: item.packageId, fromRevision: 0, toRevision: 0, events: [] } })
      this.projectionJournals.push(value)
    }
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/system/hats/projection-journal', [
        'HAT projection journal', 'Read projection journal'
      ])
      await browser.page.getByRole('button', {
        name: 'Show information about HAT projection journal' }).click()
      await browser.page.getByText('This is not the digital-twin timeline.', { exact: false }).waitFor()
      await browser.page.getByRole('button', { name: 'Read projection journal' }).click()
      await browser.page.getByText('No completed effect revisions.').waitFor()
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async list_accountant_placement() {
    const binding = bindingOf(this.composition, 'hat-accountant')
    const query = new URLSearchParams({ contextPartitionId: binding.contextPartitionId,
      repositoryId: binding.repositoryId })
    const value = await this.client.get(`/api/hats/placement-candidates?${query}`)
    assert.equal(value.schema, 'hathq://hatter-console/hat-placement-candidates/v1')
    assert.equal(value.locations.length, 1)
    const location = value.locations[0]
    assert.equal(location.sourceId, 'e2e-local')
    assert.equal(location.contextPartitionId, binding.contextPartitionId)
    assert.equal(location.repositoryId, 'hat-accountant')
    assert.equal(location.locationId, 'owner-local-accountant')
    assert.equal(location.executionKind, 'owner-local')
    assert.equal(location.workerServiceId, 'hat-accountant-worker')
    assert.equal(location.identityAuthorityRef, 'ihat/owner-local')
    assert.equal(location.transportProfileRef, 'crowsi/owner-local-process-v1')
    assert.equal(location.routeRef, 'crowsi/owner-local/hat-accountant')
    assert.deepEqual(location.operationIds,
      ['hathq://vocabulary/action/classify-financial-record/v1'])
    assert.deepEqual(location.acceptedClassifications, ['internal-confidential'])
    assert.equal(location.assurance, 'verified')
    for (const digest of [location.directoryDigestSha256, location.locationSetDigestSha256,
      location.locationDigestSha256]) assert.match(digest, /^[0-9a-f]{64}$/u)
    this.placementCandidate = location
  }

  async reject_placement_substitution() {
    const binding = bindingOf(this.composition, 'hat-accountant')
    const before = await this.readPlacement(binding, 503)
    assert.equal(before.statusMessage, 'hatter-console-hat-state-conflict')
    const rejected = await this.client.post('/api/hats/placement', {
      contextPartitionId: binding.contextPartitionId, repositoryId: binding.repositoryId,
      locationId: 'substituted-location', expectedRevision: 0
    }, 400)
    assert.equal(rejected.statusMessage, 'hatter-console-hat-operation-rejected')
    const after = await this.readPlacement(binding, 503)
    assert.equal(after.statusMessage, 'hatter-console-hat-state-conflict')
  }

  async select_accountant_placement() {
    const binding = bindingOf(this.composition, 'hat-accountant')
    const value = await this.client.post('/api/hats/placement', {
      contextPartitionId: binding.contextPartitionId, repositoryId: binding.repositoryId,
      locationId: this.placementCandidate.locationId, expectedRevision: 0
    })
    assert.equal(value.schema, 'hathq://hatter-console/hat-placement/v1')
    const placement = value.placement
    assert.equal(placement.contextPartitionId, binding.contextPartitionId)
    assert.equal(placement.repositoryId, 'hat-accountant')
    assert.equal(placement.bindingRevision, binding.revision)
    assert.equal(placement.locationId, this.placementCandidate.locationId)
    assert.equal(placement.locationDigestSha256, this.placementCandidate.locationDigestSha256)
    assert.equal(placement.federationDirectoryDigestSha256,
      this.placementCandidate.directoryDigestSha256)
    assert.equal(placement.locationSetDigestSha256,
      this.placementCandidate.locationSetDigestSha256)
    assert.equal(placement.selectionRevision, 1)
    assert.match(placement.selectionId, /^[0-9a-f]{64}$/u)
    assert.match(placement.selectionDigestSha256, /^[0-9a-f]{64}$/u)
    assert.deepEqual(await this.readPlacement(binding), value)
    this.placement = placement
  }

  async run_accountant_worker() {
    await validateExecutable(this.workerExecutable, 'HATTER_E2E_WORKER_BIN')
    await validateExecutable(this.hatterCli, 'released Hatter CLI')
    const binding = bindingOf(this.composition, 'hat-accountant')
    const inputDirectory = join(this.root, 'zixcel-input')
    const outputDirectory = join(this.root, 'accountant-output')
    const stateDirectory = join(this.root, 'accountant-worker-state')
    await Promise.all([inputDirectory, outputDirectory, stateDirectory]
      .map(value => mkdir(value, { recursive: true, mode: 0o700 })))
    const input = { schema: 'hathq://hat-accountant/classify-financial-record-input/v1',
      scope_ref: SCOPE, revision: 0,
      subject_refs: ['subject:record-2', 'subject:record-1', 'subject:record-2'] }
    const inputBytes = Buffer.from(JSON.stringify(input))
    const inputDigest = CATALOG_DIGEST(inputBytes)
    await writeFile(join(inputDirectory, `${inputDigest}.json`), inputBytes, { mode: 0o600 })
    const workerId = 'accountant-e2e-worker'
    this.worker = spawn(this.workerExecutable, [
      '--hatter', this.hatterCli, '--hatter-home', this.fixture.home,
      '--context-partition-id', binding.contextPartitionId,
      '--worker-id', workerId, '--worker-identity-ref', 'ihat/owner-local',
      '--placement-digest', this.placement.selectionDigestSha256,
      '--input-store', inputDirectory, '--output-store', outputDirectory,
      '--state-dir', stateDirectory, '--wait-seconds', '20'
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.children.add(this.worker)
    this.workerOutput = collectProcess(this.worker)
    const workerReady = waitFor(async () => this.client.get(
      `/api/hats/worker?${new URLSearchParams({ contextPartitionId: binding.contextPartitionId,
        repositoryId: 'hat-accountant' })}`, 200), 30_000)
    const earlyExit = this.workerOutput.then(value => {
      throw new Error(`accountant-worker-exited-before-registration:${value.code}:${value.stderr}`)
    })
    const worker = await Promise.race([workerReady, earlyExit])
    assert.equal(worker.worker.workerId, workerId)
    assert.equal(worker.worker.workerIdentityRef, 'ihat/owner-local')
    assert.equal(worker.worker.placementSelectionDigestSha256,
      this.placement.selectionDigestSha256)
    const competingState = join(this.root, 'accountant-worker-competing-state')
    await mkdir(competingState, { recursive: true, mode: 0o700 })
    const competing = spawn(this.workerExecutable, [
      '--hatter', this.hatterCli, '--hatter-home', this.fixture.home,
      '--context-partition-id', binding.contextPartitionId,
      '--worker-id', 'accountant-competing-worker',
      '--worker-identity-ref', 'ihat/owner-local',
      '--placement-digest', this.placement.selectionDigestSha256,
      '--input-store', inputDirectory, '--output-store', outputDirectory,
      '--state-dir', competingState, '--wait-seconds', '1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.children.add(competing)
    const competingResult = await collectProcess(competing)
    assert.notEqual(competingResult.code, 0)
    assert.match(competingResult.stderr, /worker-register failed/u)
    const invocationId = 'accountant-e2e-invocation-1'
    const invocation = invocationDocument(binding, this.placement, inputDigest, invocationId)
    const queued = await this.client.post('/api/hats/invocation', {
      repositoryId: 'hat-accountant', operationId: invocation.operation_id,
      invocationJson: JSON.stringify(invocation) })
    assert.equal(queued.invocation.status.phase, 'queued')
    assert.equal(queued.invocation.status.stateRevision, 1)
    assert.equal(queued.invocation.input.digestSha256, inputDigest)
    const completedProcess = await this.workerOutput
    assert.equal(completedProcess.code, 0, completedProcess.stderr)
    this.workerResult = JSON.parse(completedProcess.stdout.trim())
    assert.equal(this.workerResult.processed, true)
    assert.match(this.workerResult.outputDigestSha256, /^[0-9a-f]{64}$/u)
    const outputBytes = await readFile(join(outputDirectory,
      `${this.workerResult.outputDigestSha256}.json`))
    assert.equal(CATALOG_DIGEST(outputBytes), this.workerResult.outputDigestSha256)
    assert.deepEqual(JSON.parse(outputBytes), {
      schema: 'hathq://hat-accountant/classify-financial-record-output/v1',
      scope_ref: SCOPE, revision: 1,
      subject_refs: ['subject:record-1', 'subject:record-2'] })
    this.invocation = { id: invocationId, binding, inputDigest,
      outputDigest: this.workerResult.outputDigestSha256 }
  }

  async verify_accountant_result_and_projection_journal() {
    const { binding, id, outputDigest } = this.invocation
    const query = new URLSearchParams({ contextPartitionId: binding.contextPartitionId,
      repositoryId: 'hat-accountant', invocationId: id })
    const value = await this.client.get(`/api/hats/invocation?${query}`)
    assert.equal(value.invocation.status.phase, 'completed')
    assert.equal(value.invocation.status.stateRevision, 3)
    assert.equal(value.invocation.result.outcome, 'completed')
    assert.equal(value.invocation.result.projectionRevision, 1)
    assert.equal(value.invocation.result.output.ownerId, 'hat-accountant')
    assert.equal(value.invocation.result.output.digestSha256, outputDigest)
    const journal = await this.readAccountantProjectionJournal()
    assert.equal(journal.projectionJournal.fromRevision, 0)
    assert.equal(journal.projectionJournal.toRevision, 1)
    assert.equal(journal.projectionJournal.events.length, 1)
    const event = journal.projectionJournal.events[0]
    assert.equal(event.schema, 'hathq://hat/projection-event/v1')
    assert.equal(event.eventType, 'core.event.action.completed')
    assert.equal(event.invocationId, id)
    assert.equal(event.correlationId, id)
    assert.equal(event.causationId, null)
    assert.equal(event.operationId,
      'hathq://vocabulary/action/classify-financial-record/v1')
    assert.equal(event.previousRevision, 0)
    assert.equal(event.nextRevision, 1)
    assert.ok(event.occurredTime.startEpochMs > 0)
    assert.equal(event.occurredTime.endEpochMs, null)
    assert.ok(event.observedAtEpochMs >= event.occurredTime.startEpochMs)
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/system/hats/projection-journal', [
        'HAT projection journal', 'Read projection journal'
      ])
      await browser.page.getByRole('button', {
        name: 'Show information about HAT projection journal' }).click()
      await browser.page.getByText('This is not the digital-twin timeline.', { exact: false }).waitFor()
      await browser.page.getByRole('button', { name: 'Read projection journal' }).click()
      await browser.page.getByText('core.event.action.completed').waitFor()
      await browser.page.getByText(event.operationId).waitFor()
      await browser.page.getByText('0 → 1', { exact: true }).waitFor()
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
    this.completedInvocation = value
    this.completedProjectionJournal = journal
  }

  async verify_runtime_operation_ingestion() {
    const { binding, id } = this.invocation
    const operationId = 'hathq://vocabulary/action/classify-financial-record/v1'
    const mesh = await this.client.get('/api/service-mesh')
    assert.equal(mesh.schema, 'hathq://hatter-console/service-mesh/v1')
    assert.deepEqual(mesh.hats.map(value => value.repositoryId),
      ['hat-accountant', 'hat-budget-planner'])
    assert.deepEqual(mesh.modelRoutes, [])
    assert.deepEqual(mesh.routeBindings, [])
    assert.deepEqual(mesh.invocations, [{ invocationId: id,
      repositoryId: 'hat-accountant', operationId, requestKind: 'hat-operation',
      routeId: null, stateRevision: 3 }])
    const first = await this.client.get('/api/action-flow')
    const operation = first.items.find(value => value.execution?.invocationId === id)
    assert.ok(operation, 'completed HAT invocation must be in the shared action flow')
    assert.equal(operation.status, 'completed')
    assert.equal(operation.actionable, false)
    assert.equal(operation.source.repositoryId, 'hat-accountant')
    assert.equal(operation.source.digestSha256, binding.packageSha256)
    assert.equal(operation.source.revision, 3)
    assert.equal(operation.execution.operationId, operationId)
    assert.equal(operation.execution.requestKind, 'hat-operation')
    assert.equal(operation.execution.routeId, null)
    const { planned, actual, variance } = operation.execution
    assert.ok(planned.requestedAtUnixMs <= planned.startAtUnixMs)
    assert.ok(planned.startAtUnixMs <= actual.startedAtUnixMs)
    assert.ok(actual.startedAtUnixMs <= actual.completedAtUnixMs)
    assert.equal(actual.outcome, 'completed')
    assert.equal(variance.startDelayMs, actual.startedAtUnixMs - planned.startAtUnixMs)
    assert.equal(variance.durationDeltaMs, null)
    const second = await this.client.get('/api/action-flow')
    assert.deepEqual(second.items.find(value => value.execution?.invocationId === id), operation)
    assert.equal(JSON.stringify(operation).includes(this.workerResult.outputDigestSha256), false)
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await browser.page.goto(new URL('/work', this.process.launchUrl).href)
      await browser.page.locator('.console-work-view [data-projection-state="ready"]').first().waitFor()
      assert.equal(await browser.page.locator('[data-flow-item-id]').evaluateAll(
        (nodes, id) => nodes.some(node => node.getAttribute('data-flow-item-id') === id),
        operation.flowItemId), false, 'a completed operation is not an actionable TODO')
      assert.deepEqual(await this.client.get('/api/memory'), { role: 'self', revision: null, shortTerm: null, candidates: [] },
        'a worker completion cannot fabricate semantic short-term memory')
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async verify_digital_twin_projection() {
    const now = await this.client.get('/api/now')
    assert.equal(now.schema, 'hathq://hatter-console/now-projection/v2')
    assert.equal(now.catalogState, 'available')
    assert.equal(Object.hasOwn(now, 'categories'), false)
    assert.equal(Object.hasOwn(now, 'digitalTwin'), false)
    const catalog = await this.client.get('/api/hats/candidates')
    assert.equal(catalog.genres.length, this.fixture.catalogIndex.categories.length)
    for (const category of this.fixture.catalogIndex.categories) {
      const genre = catalog.genres.find(item => item.categoryId === category.id)
      assert.equal(genre?.handle, `category-${category.id}-v1`)
      assert.equal(genre?.installedHatCount, category.id === 'finance' ? 2 : 0)
      assert.equal(genre?.availableHatCount, this.fixture.catalogIndex.entries
        .filter(item => item.category_id === category.id).length)
    }
    const revisions = new Set()
    const dictionary = await this.client.get('/api/semantic/views')
    for (const { id } of dictionary.views.filter(view => view.scene === 'world')) {
      const value = await this.client.get(`/api/digital-twin/${id}`)
      assert.equal(value.projectionId, id)
      assert.equal(value.itemCount, 0)
      assert.deepEqual(value.items, [])
      assert.equal(value.truncated, false)
      revisions.add(value.graphRevision)
    }
    assert.equal(revisions.size, 1)
    assert.ok([...revisions][0] > 0)
    const rejected = await this.client.get('/api/digital-twin/unknown', 503)
    assert.equal(rejected.statusMessage, 'hatter-console-digital-twin-projection-unknown')
  }

  async read_empty_model_routes() {
    const providers = await this.client.get('/api/models/providers')
    assert.equal(providers.schema, 'hathq://hatter-console/model-providers/v1')
    assert.ok(providers.providers.length > 0)
    assert.equal(providers.providers.filter(value => value.active).length, 1)
    assert.ok(providers.providers.every(value => value.baseUrl == null
      && value.headers == null && value.envKey == null))
    const routes = await this.client.get('/api/models/routes')
    assert.deepEqual(routes, { schema: 'hathq://hatter-console/model-routes/v1',
      revision: 0, routes: [] })
    const mesh = await this.client.get('/api/service-mesh')
    assert.deepEqual(mesh.services, providers.providers.map(value => ({
      serviceId: value.id, kind: 'inference-provider', requiresAccount: value.requiresAccount
    })))
    assert.deepEqual(mesh.accounts, [])
    assert.deepEqual(mesh.models, [])
    assert.deepEqual(mesh.modelRoutes, [])
    assert.deepEqual(mesh.routeBindings, [])
    assert.deepEqual(mesh.invocations, [])
    const hats = this.fixture.packages.map(value => ({ repositoryId: value.repositoryId,
      operationIds: value.document.operations.map(operation => operation.id).sort() }))
    hats.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId))
    assert.deepEqual(mesh.hats, hats)
    this.emptyModelRoutes = routes
  }

  async reject_unavailable_model_route() {
    const operationId = 'hathq://vocabulary/action/classify-financial-record/v1'
    const value = await this.client.post('/api/models/routes', {
      routeId: 'route-accountant-light', providerId: 'chatgpt',
      accountHandle: `account-${'a'.repeat(24)}`, modelId: 'gpt-5.6-sol',
      reasoningEffort: 'low', serviceTier: 'priority', repositoryId: 'hat-accountant',
      operationId, expectedRevision: 0
    }, 400)
    assert.equal(value.statusMessage, 'hatter-console-model-operation-rejected')
    assert.deepEqual(await this.client.get('/api/models/routes'), this.emptyModelRoutes)
    const mesh = await this.client.get('/api/service-mesh')
    assert.deepEqual(mesh.accounts, [])
    assert.deepEqual(mesh.models, [])
    assert.deepEqual(mesh.modelRoutes, [])
    assert.deepEqual(mesh.routeBindings, [])
  }

  async verify_codex_runtime_observability() {
    const value = await this.client.get('/api/runtime/codex-trace')
    assert.deepEqual(value, {
      schema: 'hathq://hatter-console/codex-trace/v1',
      recording: true,
      source: 'owner-local-rollout-trace',
      containsRawContent: false,
      rejectedBundleCount: 0,
      traces: []
    })
    assert.equal(JSON.stringify(value).includes(this.root), false)
    assert.equal(JSON.stringify(value).includes('prompt'), false)
    assert.equal(JSON.stringify(value).includes('responseBody'), false)
    assert.equal(JSON.stringify(value).includes('cost'), false)
  }

  async verify_codex_runtime_ui() {
    const browser = await openBrowser(this.process.launchUrl, this.client.cookie)
    try {
      await pageText(browser, this.process.launchUrl, '/system', [
        'Hatter system', 'Codex processing', 'HATs and roles', 'Meaning and data structure'
      ])
      const text = await pageText(browser, this.process.launchUrl, '/system/codex', [
        'Hatter inference engine', 'INPUT', 'CACHE REUSE', 'OUTPUT', 'TOTAL',
        'No Codex execution has been recorded',
        'Provider charges are unavailable because they are not present in the response.'
      ])
      assert.equal(text.split('No Codex execution has been recorded').length - 1, 1)
      assert.deepEqual(browserFailures(browser.failures), [])
    } finally { await browser.close() }
  }

  async capture_restart_snapshot() {
    this.restartSnapshot = await this.snapshot()
    this.continuitySnapshot = await this.readContinuity()
    assert.equal(this.restartSnapshot.packages.length, 2)
    assert.equal(this.restartSnapshot.composition.composition.revision, 3)
    assert.equal(this.restartSnapshot.capabilities.capabilities.length, 4)
  }

  async restart_console() {
    this.oldCookie = this.client.cookie
    await this.process.stop()
    await this.start()
  }

  async reject_old_session() {
    const value = await this.client.getResponse('/api/overview', {
      expected: 401, cookie: this.oldCookie
    })
    assert.equal(value.body.statusMessage, 'hatter-console-session-rejected')
  }

  async read_restarted_state() {
    await this.connect_browser()
    const restarted = await this.snapshot()
    const continuity = await this.readContinuity()
    assert.deepEqual(restarted, this.restartSnapshot)
    assert.equal(restarted.sources.revision, 1)
    assert.deepEqual(restarted.packages.map(value => value.installation.repositoryId),
      ['hat-accountant', 'hat-budget-planner'])
    assert.deepEqual(restarted.composition.composition.bindings.map(value =>
      [value.repositoryId, value.revision, value.active]), [
      ['hat-accountant', 3, true], ['hat-budget-planner', 3, true]
    ])
    if (this.invocation) {
      const binding = this.invocation.binding
      const query = new URLSearchParams({ contextPartitionId: binding.contextPartitionId,
        repositoryId: 'hat-accountant', invocationId: this.invocation.id })
      assert.deepEqual(await this.client.get(`/api/hats/invocation?${query}`),
        this.completedInvocation)
      assert.deepEqual(await this.readAccountantProjectionJournal(),
        this.completedProjectionJournal)
    }
    const stableKinds = new Set([
      'owner_key', 'owner_recovery_root', 'working_root', 'hat_package'
    ])
    assert.deepEqual(
      continuity.resources.filter(item => stableKinds.has(item.resourceKind)),
      this.continuitySnapshot.resources.filter(item => stableKinds.has(item.resourceKind)))
    assert.deepEqual(
      continuity.resources.filter(item => item.resourceKind === 'hat_package')
        .map(item => [item.repositoryId, item.decision.state, item.decision.action]),
      [['hat-accountant', 'retained', 'none'], ['hat-budget-planner', 'retained', 'none']])
    const workers = new Map(continuity.resources
      .filter(item => item.resourceKind === 'hat_worker')
      .map(item => [item.repositoryId, item.decision]))
    assert.deepEqual(workers.get('hat-budget-planner'), {
      state: 'registration_required', action: 'select_placement',
      reason: 'worker-placement-registration-required'
    })
    assert.deepEqual(workers.get('hat-accountant'), {
      state: 'registration_required', action: 'register',
      reason: 'worker-registration-not-present'
    })
  }

  async close() {
    try {
      await Promise.all([...this.children].map(child => stopProcess(child)))
    } finally {
      try { await this.process?.stop() } finally {
        if (this.root) await rm(this.root, { recursive: true, force: true })
      }
    }
  }

  async start() {
    this.process = new ConsoleProcess(this.executable, this.fixture.home, repository)
    await this.process.start()
    this.client = new ConsoleClient()
  }

  async prepareComposition(repositoryIds, proposalId) {
    const members = repositoryIds.map(repositoryId => ({ repositoryId,
      fittingDigestSha256: FITTING,
      policyDigestSha256: POLICY }))
    return this.client.post('/api/hats/composition-prepare', {
      proposalId, subjectRef: SUBJECT, scopeRef: SCOPE, members })
  }

  async readComposition() {
    return this.client.get(`/api/hats/composition?${new URLSearchParams({
      subjectRef: SUBJECT, scopeRef: SCOPE })}`)
  }

  async readPlacement(binding, expected = 200) {
    return this.client.get(`/api/hats/placement?${new URLSearchParams({
      contextPartitionId: binding.contextPartitionId,
      repositoryId: binding.repositoryId })}`, expected)
  }

  async readAccountantProjectionJournal() {
    const binding = bindingOf(this.composition, 'hat-accountant')
    return this.client.get(`/api/hats/projection-journal?${new URLSearchParams({
      contextPartitionId: binding.contextPartitionId,
      packageId: binding.packageId })}`)
  }

  async readContinuity() {
    const value = await this.client.get('/api/continuity')
    assert.equal(value.schema, 'hathq://hatter-console/resource-continuity/v1')
    const expectedResources = [
      ['working-root', 'working_root', 'hatter'],
      ['hat_package-hat-accountant-installation', 'hat_package', 'hatter'],
      ['hat_package-hat-budget-planner-installation', 'hat_package', 'hatter'],
      [`hat_worker-hat-accountant-${partitionId(SUBJECT, SCOPE, 'hat-accountant')}`,
        'hat_worker', 'external-hat-worker'],
      [`hat_worker-hat-budget-planner-${partitionId(SUBJECT, SCOPE, 'hat-budget-planner')}`,
        'hat_worker', 'external-hat-worker']
    ].sort(([left], [right]) => left.localeCompare(right))
    assert.deepEqual(value.resources.map(item => [item.id, item.resourceKind, item.owner])
      .sort(([left], [right]) => left.localeCompare(right)), expectedResources)
    assert.equal(new Set(value.resources.map(item => item.id)).size, expectedResources.length)
    const serialized = JSON.stringify(value)
    assert.equal(serialized.includes(this.fixture.home), false)
    assert.equal(/privateKey|credentialSecret|accessToken/u.test(serialized), false)
    return value
  }

  async snapshot() {
    const packages = []
    for (const item of this.fixture.packages) packages.push(await this.client.get(
      `/api/hats/package?repositoryId=${item.repositoryId}`))
    const bindings = []
    for (const item of this.fixture.packages) bindings.push(await this.client.get(
      `/api/hats/binding?${new URLSearchParams({
        contextPartitionId: partitionId(SUBJECT, SCOPE, item.repositoryId),
        repositoryId: item.repositoryId })}`))
    const projectionJournals = []
    for (const item of this.fixture.packages) projectionJournals.push(await this.client.get(
      `/api/hats/projection-journal?${new URLSearchParams({
        contextPartitionId: partitionId(SUBJECT, SCOPE, item.repositoryId),
        packageId: item.packageId })}`))
    const now = normalizedNow(await this.client.get('/api/now'))
    return { sources: await this.client.get('/api/hats/catalog-sources'),
      catalog: await this.client.get('/api/hats/candidates'), packages,
      composition: await this.readComposition(),
      capabilities: await this.client.get('/api/hats/capabilities'),
      modelRoutes: await this.client.get('/api/models/routes'),
      serviceMesh: await this.client.get('/api/service-mesh'),
      actionFlow: normalizedActionFlow(await this.client.get('/api/action-flow')),
      bindings, projectionJournals, now }
  }
}

function normalizedActionFlow(value) {
  const copy = structuredClone(value)
  copy.observedAtUnixMs = 0
  return copy
}

async function cliJson(runner, args) {
  const child = spawn(runner.hatterCli, args, { cwd: runner.root,
    env: { ...process.env, HATTER_HOME: runner.fixture.home }, stdio: ['ignore', 'pipe', 'pipe'] })
  runner.children.add(child)
  let output = '', errorOutput = ''
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 2_000_000) child.kill() })
  child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-8192) })
  const timer = setTimeout(() => child.kill(), 15_000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve)
    })
    assert.equal(code, 0, errorOutput)
    return JSON.parse(output)
  } finally { clearTimeout(timer); await stopProcess(child); runner.children.delete(child) }
}

async function verifyDictionaryBrowser(runner, dictionary, forms = null) {
  const browser = await openBrowser(runner.process.launchUrl, runner.client.cookie)
  try {
    const person = dictionary.views.filter(view => view.scene === 'person')
    await pageText(browser, runner.process.launchUrl, '/profile', person.map(view => view.labels.en))
    assert.deepEqual(await browser.page.locator('[data-semantic-view]').evaluateAll(nodes =>
      nodes.map(node => ({ id: node.dataset.semanticView, reference: node.dataset.meaningReference,
        baseReference: node.dataset.baseReference, label: node.innerText.trim() }))),
      person.map(view => ({ id: view.id, reference: view.reference, baseReference: view.baseReference, label: view.labels.en })))
    if (forms) for (const view of person) {
      await browser.page.locator(`[data-semantic-view="${view.id}"] a`).click()
      await pageText(browser, runner.process.launchUrl, `/profile/${view.id}`, [view.labels.en], false)
      assert.deepEqual(await browser.page.locator('[data-semantic-form]').evaluateAll(nodes =>
        nodes.map(node => node.dataset.semanticForm)), view.formIds)
      for (const formId of view.formIds) {
        const form = forms.find(value => value.formId === formId)
        const element = browser.page.locator(`[data-semantic-form="${formId}"]`)
        for (const field of form.fields) {
          const control = element.locator(`[data-semantic-path="${field.fieldId}"]`)
          assert.equal(await control.getAttribute('data-semantic-term'), field.meaning.reference)
          assert.equal(await control.getAttribute('data-semantic-schema'), form.valueSchema)
          assert((await control.innerText()).includes(form.labels.en[field.labelKey]))
        }
      }
      await browser.page.goBack()
      await pageText(browser, runner.process.launchUrl, '/profile', person.map(view => view.labels.en), false)
    }
    if (forms) {
      await pageText(browser, runner.process.launchUrl, '/ontology', [dictionary.language.digest])
      const adopted = browser.page.locator('[data-adopted-language]')
      assert.equal(await adopted.locator('tbody tr').count(), dictionary.language.terms.length)
      assert.deepEqual(await adopted.locator('[data-language-binding]').evaluateAll(nodes =>
        nodes.map(node => node.dataset.languageBinding)), dictionary.views.map(view => `${view.scene}:${view.id}`))
    }
    const world = dictionary.views.filter(view => view.scene === 'world')
    await pageText(browser, runner.process.launchUrl, '/world', world.map(view => view.labels.en))
    assert.deepEqual(await browser.page.locator('[data-semantic-world]').evaluateAll(nodes =>
      nodes.map(node => node.dataset.semanticWorld)), world.map(view => view.id))
    for (const view of world) {
      const projection = await runner.client.get(`/api/digital-twin/${view.id}`)
      await browser.page.locator(`[data-semantic-world="${view.id}"]`).click()
      await pageText(browser, runner.process.launchUrl, `/semantic/${view.id}`, [view.labels.en], false)
      assert.equal(await browser.page.locator('[data-semantic-area]').getAttribute('data-semantic-area'), view.id)
      assert.deepEqual(await browser.page.locator('[data-semantic-record]').evaluateAll(nodes =>
        nodes.map(node => node.dataset.semanticRecord)), projection.items.map(item => item.semanticId))
      await browser.page.locator('[data-semantic-area]').getByRole('link', { name: 'World', exact: true }).click()
      await pageText(browser, runner.process.launchUrl, '/world', world.map(view => view.labels.en), false)
    }
    for (const width of [1280, 390]) {
      await browser.page.setViewportSize({ width, height: 844 })
      assert(await browser.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    }
    assert.deepEqual(browserFailures(browser.failures), [])
  } finally { await browser.close() }
}

export async function loadScenario() {
  const matrix = JSON.parse(await readFile(new URL('../use-cases.json', import.meta.url), 'utf8'))
  const scenario = compileUseCases(matrix)
  validateRequirements(await loadRequirements(), scenario)
  return scenario
}

export async function loadRequirements() {
  return JSON.parse(await readFile(new URL('../release-requirements.json', import.meta.url), 'utf8'))
}

export async function loadRecordedScenario() {
  return JSON.parse(await readFile(new URL('../scenario.json', import.meta.url), 'utf8'))
}

function candidateOf(value, repositoryId) {
  const candidate = value.candidates.find(item => item.repositoryId === repositoryId)
  assert.ok(candidate, `candidate ${repositoryId} must be present`)
  return candidate
}

function assertInstallation(value, fixture) {
  assert.equal(value.schema, value.descriptor == null
    ? 'hathq://hatter-console/hat-installation/v1'
    : 'hathq://hatter-console/hat-package-details/v1')
  assert.equal(value.installation.repositoryId, fixture.repositoryId)
  assert.equal(value.installation.packageId, fixture.packageId)
  assert.equal(value.installation.version, fixture.version)
  assert.equal(value.installation.specificationVersion, '1.0.0')
  assert.equal(value.installation.packageSha256, fixture.packageDigest)
  assert.equal(value.installation.artifactReference,
    `hathq://official-hats/package/${fixture.repositoryId}/${fixture.version}`)
}

function assertDescriptor(value, packageDocument) {
  const manifest = packageDocument.manifest
  assert.equal(value.schema, 'hathq://hatter/hat-package-descriptor/v2')
  assert.equal(value.manifestId, manifest.id)
  assert.equal(value.manifestName, manifest.name)
  assert.deepEqual(value.capabilities, manifest.capabilities)
  assert.deepEqual(value.decisionBoundaries, manifest.decision_boundaries)
  assert.deepEqual(value.inputClassifications, manifest.input_classifications)
  assert.equal(value.outputClassification, manifest.output_classification)
  assert.deepEqual(value.permissions, manifest.permissions.map(permission => ({
    resource: permission.resource, mode: permission.mode, operations: permission.operations })))
  assert.deepEqual(value.operations, packageDocument.operations.map(operation => ({
    id: operation.id, inputSchema: operation.input_schema,
    outputSchema: operation.output_schema, handlerKind: operation.handler.kind,
    effects: camelKeys(operation.effects ?? []),
    procedure: camelKeys(operation.procedure) })))
  assert.deepEqual(value.informationSurfaces,
    camelKeys(packageDocument.information_surfaces ?? []))
  assert.deepEqual(value.serviceRequirements,
    camelKeys(packageDocument.service_requirements ?? []))
  assert.deepEqual(value.setupTemplates, camelKeys(packageDocument.setup_templates ?? []))
  assert.deepEqual(value.catalog, camelKeys(packageDocument.catalog))
  assert.deepEqual(value.contextRequirements, packageDocument.operations.flatMap(operation =>
    operation.context_plan.selectors.map(selector => ({ operationId: operation.id,
      namespace: selector.namespace, projectionSchema: selector.projection_schema,
      required: selector.required,
      unresolvedPolicy: operation.context_plan.unresolved_policy }))))
}

function camelKeys(value) {
  if (Array.isArray(value)) return value.map(camelKeys)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/gu, (_match, letter) => letter.toUpperCase()), camelKeys(item)]))
}

function assertProposal(value, fixture, expectedRevision, repositories) {
  assert.equal(value.schema, 'hathq://hatter-console/hat-composition-preview/v1')
  const proposal = value.plan.proposal
  assert.equal(proposal.schema, 'hathq://hat/composition-proposal/v1')
  assert.equal(proposal.subjectRef, SUBJECT)
  assert.equal(proposal.scopeRef, SCOPE)
  assert.equal(proposal.expectedCompositionRevision, expectedRevision)
  assert.deepEqual(proposal.members.map(member => member.repositoryId), repositories)
  for (const member of proposal.members) {
    const packageValue = fixture.packages.find(item => item.repositoryId === member.repositoryId)
    assert.equal(member.packageId, packageValue.packageId)
    assert.equal(member.packageDigestSha256, packageValue.packageDigest)
    assert.equal(member.catalogDigestSha256, packageValue.document.catalog.identity.digest_sha256)
    assert.equal(member.fittingDigestSha256, FITTING)
    assert.equal(member.policyDigestSha256, POLICY)
    assert.deepEqual(member.operationIds,
      packageValue.document.operations.map(operation => operation.id).sort())
    assert.deepEqual(member.incompatibleRepositoryIds, [])
  }
  assert.equal(value.plan.proposalDigestSha256, proposalDigest(value.plan.proposalJson))
  assert.equal(JSON.parse(value.plan.proposalJson).proposal_id, proposal.proposalId)
}

function approvalJson(plan, approvalId) {
  return JSON.stringify({ schema: 'hathq://hat/composition-approval/v1', approval_id: approvalId,
    proposal_digest_sha256: plan.plan.proposalDigestSha256,
    approved_by_subject_ref: SUBJECT,
    expected_composition_revision: plan.plan.proposal.expectedCompositionRevision })
}

function assertComposition(value, plan, revision, bindings) {
  assert.equal(value.schema, 'hathq://hatter-console/hat-composition/v1')
  const record = value.composition
  assert.equal(record.schema, 'hatter://hat/composition-record/v1')
  assert.equal(record.revision, revision)
  assert.equal(record.proposalDigestSha256, plan.plan.proposalDigestSha256)
  assert.deepEqual(record.proposal, plan.plan.proposal)
  assert.equal(record.approval.proposalDigestSha256, plan.plan.proposalDigestSha256)
  assert.equal(record.approval.approvedBySubjectRef, SUBJECT)
  assert.equal(record.approval.expectedCompositionRevision,
    plan.plan.proposal.expectedCompositionRevision)
  assert.deepEqual(record.bindings.map(binding => binding.repositoryId),
    Object.keys(bindings).sort())
  for (const [repositoryId, [expectedRevision, active]] of Object.entries(bindings)) {
    const binding = bindingOf(value, repositoryId)
    assert.equal(binding.revision, expectedRevision)
    assert.equal(binding.active, active)
  }
}

function bindingOf(value, repositoryId) {
  const binding = value.composition.bindings.find(item => item.repositoryId === repositoryId)
  assert.ok(binding, `binding ${repositoryId} must be present`)
  return binding
}

function proposalDigest(proposalJson) {
  return createHash('sha256').update('hathq:hat-composition-proposal:v1\0')
    .update(proposalJson).digest('hex')
}

function partitionId(subjectRef, scopeRef, repositoryId) {
  return `partition-${createHash('sha256').update('hatter-context-partition-v1\0')
    .update(subjectRef).update('\0').update(scopeRef).update('\0')
    .update(repositoryId).digest('hex')}`
}

function invocationDocument(binding, placement, inputDigest, invocationId) {
  return { schema: 'hathq://hat/invocation/v4', invocation_id: invocationId,
    binding: { schema: 'hathq://hat/binding/v2', package_id: binding.packageId,
      package_digest_sha256: binding.packageSha256,
      catalog_digest_sha256: binding.catalogDigestSha256,
      fitting_digest_sha256: binding.fittingDigestSha256,
      subject_ref: binding.subjectRef, scope_ref: binding.scopeRef },
    context_partition: { context_partition_id: binding.contextPartitionId,
      revision: binding.revision, policy_digest_sha256: binding.policyDigestSha256 },
    operation_id: 'hathq://vocabulary/action/classify-financial-record/v1',
    expected_projection_revision: 0, idempotency_key: 'accountant-e2e-idempotency-1',
    input: { owner_id: 'zixcel-graph', reference: inputDigest,
      schema_id: 'hathq://hat-accountant/classify-financial-record-input/v1',
      digest_sha256: inputDigest },
    effective_grant: { owner_id: 'hatter', reference: binding.subjectRef,
      schema_id: 'hathq://hat/effective-grant/v1',
      digest_sha256: binding.policyDigestSha256 },
    placement: { owner_id: 'hatter', reference: placement.selectionId,
      schema_id: 'hathq://hat/placement-selection/v2',
      digest_sha256: placement.selectionDigestSha256 } }
}

async function validateExecutable(value, name) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new Error(`${name} must be one absolute executable path`)
  }
  const [entry, physical] = await Promise.all([lstat(value), realpath(value)])
  if (!entry.isFile() || entry.isSymbolicLink() || physical !== value
    || (entry.mode & 0o111) === 0) throw new Error(`${name} must be one exact executable`)
}

function collectProcess(child) {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', value => { stdout += value })
  child.stderr.on('data', value => { stderr += value })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}

async function waitFor(operation, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try { return await operation() } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw lastError ?? new Error('operation did not become ready')
}

function capabilityOrder(left, right) {
  return `${left.contextPartitionId}\0${left.repositoryId}\0${left.operationId}`
    .localeCompare(`${right.contextPartitionId}\0${right.repositoryId}\0${right.operationId}`)
}

function normalizedNow(value) {
  const copy = structuredClone(value)
  copy.observedAtUnixMs = 0
  for (const item of copy.timeline) item.time.startAtUnixMs = 0
  return copy
}

function assertSecurityHeaders(response, errorResponse = false) {
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), expected)
  }
  const csp = response.headers.get('content-security-policy')
  if (errorResponse) {
    assert.equal(csp, "script-src 'none'; frame-ancestors 'none';")
    assert.equal(response.headers.has('access-control-allow-origin'), false)
    return
  }
  for (const directive of ["default-src 'self'", "base-uri 'none'", "object-src 'none'",
    "frame-ancestors 'none'", "connect-src 'self'"]) {
    assert.ok(csp?.includes(directive), `${directive} absent from ${csp}`)
  }
  assert.equal(response.headers.has('access-control-allow-origin'), false)
}

function assertKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort())
}
