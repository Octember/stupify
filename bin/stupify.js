#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(root, 'src', 'cli.ts')
const installCommand = 'curl -fsSL https://bun.sh/install | bash'

function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' })
}

function runStupify() {
  return run('bun', [cli, ...process.argv.slice(2)])
}

async function installBun() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('stupify runs on Bun. Install it, then re-run this command:')
    console.error(`  ${installCommand}`)
    process.exit(127)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`stupify runs on Bun. Install Bun now? [Y/n] `)
  rl.close()
  if (/^n(o)?$/i.test(answer.trim())) {
    console.error(`Install Bun later with: ${installCommand}`)
    process.exit(127)
  }

  const dir = mkdtempSync(join(tmpdir(), 'stupify-bun-'))
  const installer = join(dir, 'install.sh')
  try {
    const downloaded = run('curl', ['-fsSL', 'https://bun.sh/install', '-o', installer])
    if (downloaded.error) {
      console.error(downloaded.error.message)
      process.exit(1)
    }
    if (downloaded.status !== 0) process.exit(downloaded.status ?? 1)

    const installed = run('bash', [installer])
    if (installed.error) {
      console.error(installed.error.message)
      process.exit(1)
    }
    if (installed.status !== 0) process.exit(installed.status ?? 1)
    process.env.PATH = `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ''}`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let result = runStupify()
if (result.error?.code === 'ENOENT') {
  await installBun()
  result = runStupify()
}

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
