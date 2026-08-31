import { type Config } from './config'

const SANDBOX = [
  '--sandbox',
  'workspace-write',
  '-c',
  'sandbox_workspace_write.network_access=false',
  '-c',
  'sandbox_workspace_write.writable_roots=["/tmp"]',
] as const

export interface ModelOpts {
  schemaPath?: string
  outPath?: string
  threadId?: string
}

type ModelCfg = Pick<Config, 'codexEffort' | 'codexProvider' | 'codexModel'>

function outputFlags(opts: ModelOpts): string[] {
  const schema = opts.schemaPath === undefined ? [] : ['--output-schema', opts.schemaPath]
  const lastMessage = opts.outPath === undefined ? [] : ['--output-last-message', opts.outPath]
  return [...schema, ...lastMessage]
}

function modelFlags(cfg: ModelCfg): string[] {
  const effort = ['-c', `model_reasoning_effort=${cfg.codexEffort}`]
  const provider = cfg.codexProvider ? ['-c', `model_provider=${cfg.codexProvider}`] : []
  const model = cfg.codexModel ? ['-c', `model=${cfg.codexModel}`] : []
  return [...effort, ...provider, ...model]
}

export function modelArgs(cfg: ModelCfg, cwd: string, opts: ModelOpts = {}): string[] {
  if (opts.threadId !== undefined) {
    return ['exec', 'resume', '--json', ...outputFlags(opts), ...modelFlags(cfg), opts.threadId, '-']
  }
  return ['exec', '--json', ...outputFlags(opts), '--cd', cwd, ...SANDBOX, ...modelFlags(cfg), '-']
}
