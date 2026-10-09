import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@parklet/protocol';
import { SERVER_NAME, SERVER_VERSION } from './index.js';

describe('server package entry', () => {
  it('identifies as the parklet relay daemon', () => {
    expect(SERVER_NAME).toBe('parklet-server');
    expect(SERVER_VERSION).toBe(PROTOCOL_VERSION);
  });
});
