export interface PreToolUseContext {
  cwd: string;
  repoRoot: string;
  shardDir: string;
  toolName: string;
  targetPath: string | null;
}

export interface PreToolUseDecision {
  deny: boolean;
  reason?: string;
}

export function decidePreToolUse(ctx: PreToolUseContext): PreToolUseDecision;

export interface DetectedShard {
  repoRoot: string;
  shardDir: string;
  shard: string;
}

export function detectShard(cwd: string): DetectedShard | null;
