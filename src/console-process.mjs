import { spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { createServer } from 'node:net'
import { stopProcess } from './process-lifecycle.mjs'

export class ConsoleProcess {
  constructor(executable, home, cwd) {
    this.executable = executable
    this.home = home
    this.cwd = cwd
    this.child = null
    this.stderr = ''
  }

  async start() {
    await validateExecutable(this.executable)
    await requireFreePort()
    this.stderr = ''
    const child = spawn(this.executable, [], { cwd: this.cwd,
      env: { ...process.env, HATTER_HOME: this.home,
        HATTER_CONSOLE_NODE_EXECUTABLE: process.execPath }, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', value => { this.stderr = (this.stderr + value).slice(-65_536) })
    const url = await launchUrl(child, () => this.stderr)
    this.launchUrl = url
  }

  async stop() {
    const child = this.child
    this.child = null
    await stopProcess(child)
  }
}

async function validateExecutable(value) {
  if (!isAbsolute(value ?? '')) throw new Error('HATTER_E2E_HATTER_BIN must be absolute')
  const [entry, physical] = await Promise.all([lstat(value), realpath(value)])
  if (!entry.isFile() || entry.isSymbolicLink() || physical !== value || (entry.mode & 0o111) === 0) {
    throw new Error('HATTER_E2E_HATTER_BIN must be one exact executable')
  }
}

function requireFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', error => reject(new Error(
      `127.0.0.1:4213 must be free before E2E (${error.code ?? 'listen-failed'})`)))
    server.listen(4213, '127.0.0.1', () => server.close(resolve))
  })
}

function launchUrl(child, stderr) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => fail('Console launch timed out'), 15_000)
    const fail = message => { clearTimeout(timer); reject(new Error(`${message}: ${stderr()}`)) }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', value => {
      output = (output + value).slice(-65_536)
      const match = output.match(/http:\/\/localhost:4213\//u)
      if (match) { clearTimeout(timer); resolve(match[0]) }
    })
    child.once('error', error => fail(error.message))
    child.once('exit', code => fail(`Console exited before readiness (${code})`))
  })
}
