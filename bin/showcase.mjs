#!/usr/bin/env node
import { ScenarioRunner } from '../src/scenario-runner.mjs'

const executable = process.env.HATTER_E2E_HATTER_BIN
if (!executable) throw new Error('HATTER_E2E_HATTER_BIN is required')
const runner = new ScenarioRunner(executable, process.env.HATTER_E2E_WORKER_BIN)
let closing = false
async function close(code) {
  if (closing) return
  closing = true
  await runner.close()
  process.exitCode = code
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close(0))

try {
  for (const action of ['prepare_fixture', 'start_console', 'authenticate',
    'select_local_source', 'list_catalog', 'install_packages',
    'prepare_full_composition', 'approve_full_composition', 'verify_guided_initial_state']) {
    await runner.execute(action)
  }
  await runner.restart_console()
  process.stdout.write(`${runner.process.launchUrl}\n`)
  process.stdout.write('隔離された確認用状態です。Ctrl+Cで終了・破棄します。\n')
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  await close(0)
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`)
  await close(1)
}
