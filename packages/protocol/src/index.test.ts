import { describe, expect, it } from 'vitest';
import { PROTOCOL_NAME, PROTOCOL_VERSION, protocolName } from './index.js';

describe('protocol package skeleton', () => {
  it('exposes a semver protocol version', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('identifies itself with the parkinglot protocol name', () => {
    expect(protocolName()).toBe('parkinglot');
    expect(PROTOCOL_NAME).toBe('parkinglot');
  });
});
