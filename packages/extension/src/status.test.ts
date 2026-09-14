import { describe, expect, it } from 'vitest';
import {
  badgeFor,
  GREEN,
  guidanceFor,
  ORANGE,
  RED,
  statusLabel,
  type ConnState,
} from './status.js';

describe('badgeFor', () => {
  it('maps states to colors', () => {
    expect(badgeFor('connected')).toEqual({ text: '●', color: GREEN });
    expect(badgeFor('disconnected')).toEqual({ text: '●', color: RED });
    expect(badgeFor('unconfigured')).toEqual({ text: '●', color: ORANGE });
    expect(badgeFor('auth_failed')).toEqual({ text: '●', color: ORANGE });
  });

  it('returns null while connecting (keep previous badge)', () => {
    expect(badgeFor('connecting')).toBeNull();
  });
});

describe('statusLabel', () => {
  it('labels every state', () => {
    const states: ConnState[] = [
      'unconfigured',
      'connecting',
      'connected',
      'auth_failed',
      'disconnected',
    ];
    for (const s of states) expect(statusLabel(s).length).toBeGreaterThan(0);
    expect(statusLabel('connected')).toBe('connected');
    expect(statusLabel('auth_failed')).toBe('token rejected');
  });
});

describe('guidanceFor', () => {
  it('guides configuration when unconfigured', () => {
    expect(guidanceFor('unconfigured', { serverUrl: '' })).toContain('plt serve');
  });
  it('guides re-pairing on token rejection', () => {
    expect(guidanceFor('auth_failed', { serverUrl: 'http://x' })).toContain('token');
  });
  it('mentions server start for disconnection, and graceful stop when server shut down', () => {
    expect(guidanceFor('disconnected', { serverUrl: 'http://x' })).toContain('plt serve');
    expect(
      guidanceFor('disconnected', { serverUrl: 'http://x', lastError: 'server shutting down' }),
    ).toContain('服务端已停止');
  });
});
