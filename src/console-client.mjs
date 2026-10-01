import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'

const ORIGIN = 'http://localhost:4213'

export class ConsoleClient {
  constructor() {
    this.cookie = null
    this.csrf = null
  }

  async connect() {
    const result = await this.request('/api/connection', {
      method: 'POST', authenticated: false
    })
    const setCookie = result.response.headers.get('set-cookie')
    if (!setCookie?.startsWith('hatter_console_session=')) throw new Error('session cookie absent')
    this.cookie = setCookie.split(';', 1)[0]
    this.csrf = result.body.csrf
    this.sessionResponse = result.response
    return result.body
  }

  async get(path, expected = 200, authenticated = true) {
    return (await this.request(path, { expected, authenticated })).body
  }

  async post(path, body, expected = 200) {
    return (await this.request(path, { method: 'POST', body, expected, mutation: true })).body
  }

  async getResponse(path, options = {}) {
    return this.request(path, options)
  }

  async postResponse(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body,
      mutation: options.mutation ?? true })
  }

  async page(path) {
    return this.request(path, { expected: 200, authenticated: false, json: false })
  }

  rawBoundary(path, { method = 'GET', host = 'localhost:4213',
    origin = ORIGIN, body } = {}) {
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body))
      const request = httpRequest({ hostname: '127.0.0.1', port: 4213, path, method,
        headers: { Host: host, Origin: origin, 'Sec-Fetch-Site': 'same-origin',
          Accept: 'application/json', ...(bytes == null ? {} : {
            'Content-Type': 'application/json', 'Content-Length': bytes.length }) } }, response => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', value => { text += value })
        response.on('end', () => {
          let parsed
          try { parsed = JSON.parse(text) } catch { parsed = text }
          resolve({ status: response.statusCode, body: parsed })
        })
      })
      request.once('error', reject)
      request.end(bytes)
    })
  }

  async request(path, options = {}) {
    const method = options.method ?? 'GET'
    const headers = { Host: options.host ?? 'localhost:4213', Origin: options.origin ?? ORIGIN,
      'Sec-Fetch-Site': options.fetchSite ?? 'same-origin',
      Accept: options.json === false ? 'text/html' : 'application/json' }
    const cookie = options.cookie === undefined ? this.cookie : options.cookie
    if (options.authenticated !== false && cookie) headers.Cookie = cookie
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.mutation) {
      headers['X-Hatter-CSRF'] = options.csrf ?? this.csrf
      headers['X-Hatter-Request-Nonce'] = options.nonce ?? randomUUID()
    }
    const response = await fetch(`${ORIGIN}${path}`, {
      method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)
    })
    const text = await response.text()
    let body = text
    if (options.json !== false) {
      try { body = JSON.parse(text) } catch { throw new Error(`non-JSON response ${response.status}`) }
    }
    const expected = options.expected ?? 200
    if (response.status !== expected) {
      throw new Error(`HTTP ${response.status}, expected ${expected}: ${text.slice(0, 300)}`)
    }
    return { response, body }
  }
}
