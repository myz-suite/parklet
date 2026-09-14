import { describe, expect, it } from 'vitest';
import { PROTOCOL_NAME, PROTOCOL_VERSION, protocolName } from './index.js';

describe('protocol package skeleton', () => {
  it('exposes a drafted protocol version (semver with optional prerelease)', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(PROTOCOL_VERSION).toBe('0.1.0-draft');
  });

  it('identifies itself with the parkinglot protocol name', () => {
    expect(protocolName()).toBe('parkinglot');
    expect(PROTOCOL_NAME).toBe('parkinglot');
  });
});
