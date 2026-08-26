import { expect, test } from 'bun:test'

import { codexFinalMessage, codexThreadId, codexTokens, SECOND_PASS_PROMPT } from './codex'

const events = [
  JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
  'not json',
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: ' final ' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 120, output_tokens: 30 } }),
].join('\n')

test('reads the resumed thread contract from codex JSON events', () => {
  expect(codexThreadId(events)).toBe('thread-123')
  expect(codexFinalMessage(events)).toBe('final')
  expect(codexTokens(events)).toBe(150)
})

test('the second turn challenges reinvention and unnecessary complexity', () => {
  expect(SECOND_PASS_PROMPT).toContain('reinvent an existing owner')
  expect(SECOND_PASS_PROMPT).toContain('unchanged code')
  expect(SECOND_PASS_PROMPT).toContain('minimal, elegant')
  expect(SECOND_PASS_PROMPT).toContain("doesn't reinvent something that already exists")
})
