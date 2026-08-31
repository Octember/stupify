import { expect, test } from 'bun:test'

import { modelArgs } from './codex-args'

const cfg = { codexEffort: 'high', codexProvider: '', codexModel: '' }

test('first pass is sandboxed exec on stdin', () => {
  expect(modelArgs(cfg, '/repo')).toEqual([
    'exec',
    '--json',
    '--cd',
    '/repo',
    '--sandbox',
    'workspace-write',
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-c',
    'sandbox_workspace_write.writable_roots=["/tmp"]',
    '-c',
    'model_reasoning_effort=high',
    '-',
  ])
})

test('resume is schema + last-message, no sandbox', () => {
  expect(
    modelArgs({ ...cfg, codexProvider: 'openai', codexModel: 'gpt' }, '/repo', {
      schemaPath: '/schema.json',
      outPath: '/out.md',
      threadId: 'thread-1',
    }),
  ).toEqual([
    'exec',
    'resume',
    '--json',
    '--output-schema',
    '/schema.json',
    '--output-last-message',
    '/out.md',
    '-c',
    'model_reasoning_effort=high',
    '-c',
    'model_provider=openai',
    '-c',
    'model=gpt',
    'thread-1',
    '-',
  ])
})
