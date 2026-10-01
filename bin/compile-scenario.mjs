#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { compileUseCases } from '../src/use-case-compiler.mjs'
import { validateRequirements } from '../src/release-requirements.mjs'

const source = JSON.parse(await readFile(new URL('../use-cases.json', import.meta.url), 'utf8'))
const scenario = compileUseCases(source)
validateRequirements(JSON.parse(await readFile(new URL('../release-requirements.json', import.meta.url), 'utf8')), scenario)
await writeFile(new URL('../scenario.json', import.meta.url),
  `${JSON.stringify(scenario, null, 2)}\n`)
