import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const ORIGIN = 'https://ihat.space'
const KEY_ID = 'hatter-e2e-catalog-v1'
const FEDERATION_KEY_ID = 'official-hats-federation-v1'
const OFFICIAL_KEY_ID = 'official-hats-marketplace-v2-r3'
const OFFICIAL_PUBLIC_KEY = '53301c3e0b65b41d1bb0f187265eb19987e8b1ca91b6082c885035f1082e5a0d'
const DEFAULT_REPOSITORIES = ['hat-accountant', 'hat-budget-planner']

export async function prepareFixture(root, fixtureUrls) {
  if (process.env.HATTER_E2E_RELEASE_CATALOG_DIR) {
    return prepareReleaseFixture(root, process.env.HATTER_E2E_RELEASE_CATALOG_DIR)
  }
  if (!Array.isArray(fixtureUrls) || fixtureUrls.length !== 2) {
    throw new Error('two exact HAT package fixtures are required')
  }
  const home = join(root, 'hatter-home')
  const catalog = join(root, 'catalog')
  await mkdir(home, { recursive: true, mode: 0o700 })
  await chmod(home, 0o700)
  const packages = []
  for (const fixtureUrl of fixtureUrls) {
    const sourceBytes = await readFile(fixtureUrl)
    const document = JSON.parse(sourceBytes)
    addNovelEntity(document)
    const packageDirectory = join(catalog, 'catalog/v2/packages',
      document.repository_id, document.version)
    await mkdir(packageDirectory, { recursive: true, mode: 0o700 })
    const packagePath = join(packageDirectory, 'hat.package.json')
    await writeFile(packagePath, JSON.stringify(document), { mode: 0o600 })
    const packageBytes = await readFile(packagePath)
    packages.push(packageRecord(document, packagePath, packageBytes))
  }
  packages.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicKeyHex = publicDer.subarray(publicDer.length - 32).toString('hex')
  const catalogIndex = catalogDocument(packages)
  const indexBytes = Buffer.from(JSON.stringify(catalogIndex))
  const signatureHex = sign(null, indexBytes, privateKey).toString('hex')
  await writeFile(join(catalog, 'catalog/v2/index.json'), indexBytes, { mode: 0o600 })
  await writeFile(join(catalog, 'catalog/v2/index.signature.hex'), signatureHex, { mode: 0o600 })
  const federation = await writeFederation(catalog, packages, indexBytes, privateKey, publicKey)
  return { home, catalog, packages, catalogIndex, indexBytes, origin: ORIGIN,
    signingKeyId: KEY_ID, publicKeyHex, ...federation }
}

// A fresh, signed declaration proves that the product cannot pass by knowing fixture names.
// Digests follow the public canonical-JSON wire rules; no product source is imported.
function addNovelEntity(document) {
  const catalog = document.catalog
  const previous = catalog.identity.digest_sha256
  const nonce = randomUUID().replaceAll('-', '')
  const entity = structuredClone(catalog.terms.find(term => term.reference.kind === 'entity-type'))
  entity.reference.term_id = `hathq://vocabulary/entity/fixture-${nonce}/v1`
  const definition = structuredClone(entity)
  definition.reference.definition_digest_sha256 = ''
  clearTermCatalogs(definition)
  entity.reference.definition_digest_sha256 = canonicalDigest(definition)
  catalog.terms.push(entity)
  catalog.lexicalizations.push({ term: structuredClone(entity.reference),
    locale: 'en', preferred: `Novel information ${nonce}`, search_aliases: [] })
  document.information_surfaces = [...document.information_surfaces ?? [], {
    id: `fixture-${nonce}`, canonical_type: `domain.fixture.${nonce}`,
    projection_schema: entity.wire_schema,
    data_domain_term_id: 'hathq://vocabulary/data-domain/finance/v1',
    subject_relation: 'managed', semantic_icon: 'generic'
  }]
  const canonical = structuredClone(catalog)
  canonical.identity.digest_sha256 = ''
  canonical.terms.forEach(clearTermCatalogs)
  canonical.lexicalizations.forEach(value => { value.term.catalog_digest_sha256 = '' })
  canonical.frames.forEach(value => { value.predicate.catalog_digest_sha256 = '' })
  const next = canonicalDigest(canonical)
  function replace(value) {
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
    return value === previous ? next : value
  }
  Object.assign(document, replace(document))
}
function clearTermCatalogs(value) {
  value.reference.catalog_digest_sha256 = ''
  for (const relation of ['dependencies', 'is_a', 'domain', 'range']) {
    for (const term of value[relation]) term.catalog_digest_sha256 = ''
  }
}
function canonicalDigest(value) {
  function sort(value) {
    if (Array.isArray(value)) return value.map(sort)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]))
    return value
  }
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex')
}

async function prepareReleaseFixture(root, source) {
  if (!isAbsolute(source)) throw new Error('release catalog directory must be absolute')
  const [entry, physical] = await Promise.all([lstat(source), realpath(source)])
  if (!entry.isDirectory() || entry.isSymbolicLink() || physical !== source) {
    throw new Error('release catalog directory must be one exact directory')
  }
  const sourceV2 = join(source, 'catalog/v2')
  const indexBytes = await readFile(join(sourceV2, 'index.json'))
  const index = JSON.parse(indexBytes)
  if (index.origin !== 'https://ihat.space' || index.signing_key_id !== OFFICIAL_KEY_ID) {
    throw new Error('release catalog trust identity differs from the pinned iHAT contract')
  }
  const repositories = (process.env.HATTER_E2E_REPOSITORY_IDS ?? DEFAULT_REPOSITORIES.join(','))
    .split(',').filter(Boolean)
  if (repositories.length !== 2) throw new Error('two release repositories are required')
  const home = join(root, 'hatter-home')
  const catalog = join(root, 'catalog')
  const targetV2 = join(catalog, 'catalog/v2')
  await mkdir(home, { recursive: true, mode: 0o700 })
  await chmod(home, 0o700)
  await mkdir(targetV2, { recursive: true, mode: 0o700 })
  await copyFile(join(sourceV2, 'index.json'), join(targetV2, 'index.json'))
  await copyFile(join(sourceV2, 'index.signature.hex'), join(targetV2, 'index.signature.hex'))
  const packages = []
  for (const repositoryId of repositories) {
    const release = index.entries?.find(value => value.repository_id === repositoryId)
    if (!release) throw new Error(`release catalog entry is absent: ${repositoryId}`)
    const sourcePackage = resolve(source, release.artifact_path.slice(1))
    if (relative(source, sourcePackage).startsWith('..')) {
      throw new Error('release package escapes its catalog directory')
    }
    const packagePath = join(catalog, release.artifact_path)
    await mkdir(dirname(packagePath), { recursive: true, mode: 0o700 })
    await copyFile(sourcePackage, packagePath)
    const packageBytes = await readFile(packagePath)
    const document = JSON.parse(packageBytes)
    const record = packageRecord(document, packagePath, packageBytes)
    if (record.packageDigest !== release.package_sha256) {
      throw new Error(`release package digest differs from its catalog: ${repositoryId}`)
    }
    packages.push(record)
  }
  packages.sort((left, right) => left.repositoryId.localeCompare(right.repositoryId))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const federation = await writeFederation(catalog, packages, indexBytes, privateKey, publicKey)
  return { home, catalog, packages, catalogIndex: index, indexBytes, origin: index.origin,
    signingKeyId: OFFICIAL_KEY_ID, publicKeyHex: OFFICIAL_PUBLIC_KEY, ...federation }
}

async function writeFederation(catalog, packages, catalogBytes, privateKey, publicKey) {
  const accountant = packages.find(value => value.repositoryId === 'hat-accountant')
  if (!accountant) throw new Error('accountant package is required for federation E2E')
  const now = Math.floor(Date.now() / 1000)
  const location = { schema: 'hathq://hat/execution-location/v1',
    location_id: 'owner-local-accountant', package_id: accountant.packageId,
    package_digest_sha256: accountant.packageDigest, publisher_id: 'hathq',
    execution_kind: 'owner-local', worker_service_id: 'hat-accountant-worker',
    identity_authority_ref: 'ihat/owner-local',
    transport_profile_ref: 'crowsi/owner-local-process-v1',
    route_ref: 'crowsi/owner-local/hat-accountant', region: 'local',
    jurisdictions: ['local'], data_residencies: ['local'],
    operation_ids: ['hathq://vocabulary/action/classify-financial-record/v1'],
    accepted_classifications: ['internal-confidential'],
    capability_ids: ['financial-classification'], assurance: 'verified',
    issued_at_epoch_s: now, expires_at_epoch_s: now + 86_400, revocation_epoch: 0 }
  const locationSet = Buffer.from(JSON.stringify({
    schema: 'hathq://hat/execution-location-set/v1', package_id: accountant.packageId,
    package_digest_sha256: accountant.packageDigest, revision: 1,
    issued_at_epoch_s: now, expires_at_epoch_s: now + 86_400, locations: [location]
  }))
  const locationPath = '/federation/v1/locations/hat-accountant.json'
  const directory = Buffer.from(JSON.stringify({
    schema: 'hathq://official-hats/federation-directory/v1', directory_id: 'official-hats',
    signing_key_id: FEDERATION_KEY_ID, origin: ORIGIN,
    catalog_digest_sha256: createHash('sha256').update(catalogBytes).digest('hex'), revision: 1,
    issued_at_epoch_s: now, expires_at_epoch_s: now + 86_400, maximum_child_depth: 1,
    children: [], location_sets: [{ package_id: accountant.packageId,
      package_digest_sha256: accountant.packageDigest, document_path: locationPath,
      document_digest_sha256: createHash('sha256').update(locationSet).digest('hex'),
      location_count: 1 }]
  }))
  await mkdir(join(catalog, 'federation/v1/locations'), { recursive: true, mode: 0o700 })
  await writeFile(join(catalog, locationPath), locationSet, { mode: 0o600 })
  await writeFile(join(catalog, 'federation/v1/directory.json'), directory, { mode: 0o600 })
  await writeFile(join(catalog, 'federation/v1/directory.signature.hex'),
    sign(null, directory, privateKey).toString('hex'), { mode: 0o600 })
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  return { federationSigningKeyId: FEDERATION_KEY_ID,
    federationPublicKeyHex: publicDer.subarray(publicDer.length - 32).toString('hex') }
}

function packageRecord(document, packagePath, packageBytes) {
  return { repositoryId: document.repository_id, packageId: document.package_id,
    version: document.version, packagePath, packageBytes,
    packageDigest: createHash('sha256').update(packageBytes).digest('hex'), document }
}

export async function tamperCatalog(fixture) {
  const signature = join(fixture.catalog, 'catalog/v2/index.signature.hex')
  fixture.signatureBytes = await readFile(signature)
  await writeFile(signature, Buffer.from('00'.repeat(64)), { mode: 0o600 })
}

export async function restoreCatalog(fixture) {
  await writeFile(join(fixture.catalog, 'catalog/v2/index.signature.hex'),
    fixture.signatureBytes, { mode: 0o600 })
}

export async function tamperPackage(fixture, repositoryId) {
  const value = packageOf(fixture, repositoryId)
  await writeFile(value.packagePath, Buffer.concat([value.packageBytes, Buffer.from(' ')]),
    { mode: 0o600 })
}

export async function restorePackage(fixture, repositoryId) {
  const value = packageOf(fixture, repositoryId)
  await writeFile(value.packagePath, value.packageBytes, { mode: 0o600 })
}

function packageOf(fixture, repositoryId) {
  const value = fixture.packages.find(item => item.repositoryId === repositoryId)
  if (!value) throw new Error(`unknown fixture package: ${repositoryId}`)
  return value
}

function catalogDocument(packages) {
  const japaneseName = value => ({ 'hat-accountant': '会計担当',
    'hat-budget-planner': '予算プランナー' })[value.repositoryId]
  return {
    schema: 'hathq://official-hats/catalog/v2',
    specification_schema: 'hathq://hat/package/v2', signing_key_id: KEY_ID, origin: ORIGIN,
    categories: [{ id: 'finance', term_id: 'hathq://vocabulary/data-domain/finance/v1',
      ja: { name: 'お金・会計', summary: 'E2Eで複数の会計HAT構成を確認します。' },
      en: { name: 'Finance', summary: 'Exercises an exact multi-HAT finance composition.' } }],
    entries: packages.map(value => ({ repository_id: value.repositoryId,
      package_id: value.packageId, version: value.version, specification_version: '1.0.0',
      artifact_ref: `hathq://official-hats/package/${value.repositoryId}/${value.version}`,
      artifact_path: `/catalog/v2/packages/${value.repositoryId}/${value.version}/hat.package.json`,
      package_sha256: value.packageDigest, category_id: 'finance', assurance: 'official',
      ja: { name: japaneseName(value),
        summary: `${japaneseName(value)}の署名済みE2E候補です。` },
      en: { name: value.document.manifest.name,
        summary: `A signed ${value.document.manifest.name} E2E candidate.` } }))
  }
}
