#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { loadRequirements } from '../src/scenario-runner.mjs'

const scenario = JSON.parse(await readFile(new URL('../scenario.json', import.meta.url), 'utf8'))
process.stdout.write(`# ${scenario.title}\n\n${scenario.objective}\n\n前提条件:\n`)
for (const item of scenario.prerequisites) process.stdout.write(`- ${item}\n`)
process.stdout.write('\n操作と期待結果:\n')
for (const [index, step] of scenario.steps.entries()) {
  process.stdout.write(`${index + 1}. [${step.id}] ${step.title}\n   ${step.manual}\n`)
  process.stdout.write(`   - 実行契約: ${step.actions.join(' → ')}\n`)
  process.stdout.write(`   - 網羅領域: ${step.covers.join(' / ')}\n`)
  process.stdout.write(`   - 証拠境界: ${step.evidence.join(' / ')}\n`)
  for (const check of step.checks) process.stdout.write(`   - 照合: ${check}\n`)
  for (const point of step.reviewPoints) process.stdout.write(`   - 合格後の改善確認（合否とは別）: ${point}\n`)
}
process.stdout.write('\n実行: HATTER_E2E_HATTER_BIN=/absolute/path/to/hatter '
  + 'HATTER_E2E_WORKER_BIN=/absolute/path/to/hat-accountant-worker pnpm test\n')
process.stdout.write('\n必須受入要件（未実行を合格に含めない）:\n')
for (const requirement of (await loadRequirements()).requirements) {
  process.stdout.write(`- ${requirement.id}: ${requirement.expectation}\n  検証: ${requirement.actions.join(' / ')}\n`)
  if (requirement.implementationGap) process.stdout.write(`  未実装・リリース不可: ${requirement.implementationGap}\n`)
}
