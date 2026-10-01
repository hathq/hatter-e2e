import { chromium } from '@playwright/test'

export async function openBrowser(launchUrl, cookie) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const failures = []
  try {
    if (cookie) {
      const [name, value] = cookie.split('=', 2)
      await context.addCookies([{ name, value, url: new URL('/', launchUrl).href,
        httpOnly: true, sameSite: 'Strict' }])
    }
    const page = await context.newPage()
    observe(page, failures)
    const connections = []
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/connection') connections.push(response)
    })
    await page.goto(cookie ? new URL('/', launchUrl).href : launchUrl, { waitUntil: 'domcontentloaded' })
    return { browser, context, page, failures, connections, async close() {
      await context.close(); await browser.close()
    } }
  } catch (error) {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    throw error
  }
}

export async function pageText(browser, launchUrl, path, expected, navigate = true) {
  const destination = new URL(path, launchUrl)
  if (navigate) await browser.page.goto(destination.href, { waitUntil: 'domcontentloaded' })
  try {
    await browser.page.waitForFunction(({ pathname, expectedText }) => {
      const loading = [...document.querySelectorAll('[data-projection-state]')]
        .some(node => node.dataset.projectionState === 'loading')
      const state = document.querySelector('[data-error-status]')?.dataset.errorStatus ?? null
      const text = document.body?.innerText ?? ''
      return location.pathname === pathname && state === null && !loading
        && expectedText.every(value => text.includes(value))
    }, { pathname: destination.pathname, expectedText: expected }, { timeout: 12_000 })
  } catch (error) {
    const value = await browser.page.evaluate(() => ({ path: location.pathname,
      text: document.body?.innerText ?? '',
      state: document.querySelector('[data-error-status]')?.dataset.errorStatus ?? null,
      loading: [...document.querySelectorAll('[data-projection-state]')]
        .some(node => node.dataset.projectionState === 'loading') }))
    throw new Error(`browser-page-mismatch:${path}:${JSON.stringify(value)}`, { cause: error })
  }
  return await browser.page.locator('body').innerText()
}

export async function selectTodo(browser) {
  await browser.page.getByRole('button', { name: /^(時間バーを開く|Open time bar)$/u }).click()
}

export async function pageFlowItemIds(browser, scope = '.console-scene-primary') {
  return await browser.page.locator(`${scope} [data-flow-item-id]`).evaluateAll(nodes =>
    nodes.map(node => node.dataset.flowItemId))
}

export async function sceneLayoutAt(browser, width, height) {
  await browser.page.setViewportSize({ width, height })
  await browser.page.waitForTimeout(150)
  return await browser.page.evaluate(() => {
    const panes = [...document.querySelectorAll('.console-scene-primary,.console-scene-detail')].map(node => {
      const box = node.getBoundingClientRect()
      return { left: Math.round(box.left), top: Math.round(box.top),
        width: Math.round(box.width), right: Math.round(box.right), bottom: Math.round(box.bottom),
        position: getComputedStyle(node).position }
    })
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, panes }
  })
}

export function browserFailures(failures) {
  return [...failures]
}

function observe(page, failures) {
  page.on('pageerror', error => failures.push(`javascript-exception:${bounded(error.message)}`))
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      failures.push(`console-${message.type()}:${bounded(message.text())}`)
    }
  })
  page.on('requestfailed', request => failures.push(
    `network-failed:${new URL(request.url()).pathname}:${bounded(request.failure()?.errorText)}`))
  page.on('response', response => {
    if (response.status() >= 500) {
      failures.push(`http-${response.status()}:${new URL(response.url()).pathname}`)
    }
  })
}

function bounded(value) {
  return String(value ?? 'unknown').replaceAll(/\s+/gu, ' ').slice(0, 256)
}
