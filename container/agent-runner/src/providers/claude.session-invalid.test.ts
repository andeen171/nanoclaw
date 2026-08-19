import { describe, it, expect } from 'bun:test';

import { ClaudeProvider } from './claude.js';

// isSessionInvalid is the seam the poll-loop uses to decide whether a stored
// continuation is worth resuming. A context-overflow transcript belongs in the
// same bucket as a missing one: every resume of it fails identically, so
// keeping it wedges the cell until someone restarts the group by hand (seen
// 2026-08-18 — the dev cell answered eight consecutive ticks with "Prompt is
// too long" over 2h20m).

const provider = new ClaudeProvider() as unknown as { isSessionInvalid(err: unknown): boolean };

describe('ClaudeProvider.isSessionInvalid', () => {
  it('treats context overflow as an unusable session', () => {
    expect(provider.isSessionInvalid(new Error('Prompt is too long'))).toBe(true);
    expect(
      provider.isSessionInvalid(new Error('Prompt is too long: 214331 tokens > 200000 maximum')),
    ).toBe(true);
    expect(provider.isSessionInvalid('context window exceeded')).toBe(true);
  });

  it('still catches the missing-transcript cases it was written for', () => {
    expect(provider.isSessionInvalid(new Error('No conversation found with session ID abc'))).toBe(true);
    expect(provider.isSessionInvalid(new Error('ENOENT: no such file /x/y.jsonl'))).toBe(true);
  });

  it('leaves ordinary failures alone — clearing on those would drop good history', () => {
    expect(provider.isSessionInvalid(new Error('503 Service temporarily unavailable'))).toBe(false);
    expect(provider.isSessionInvalid(new Error('429 rate limit'))).toBe(false);
    expect(provider.isSessionInvalid(new Error('tool execution failed'))).toBe(false);
  });
});
