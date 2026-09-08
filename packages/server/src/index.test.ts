import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@parkinglot/protocol';
import { SERVER_NAME, SERVER_VERSION } from './index.js';

describe('server package entry', () => {
  it('identifies as the parkinglot relay daemon', () => {
    expect(SERVER_NAME).toBe('parkinglot-server');
    expect(SERVER_VERSION).toBe(PROTOCOL_VERSION);
  });
});
