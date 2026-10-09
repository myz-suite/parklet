import { describe, expect, it } from 'vitest';
import { EXTENSION_NAME, extensionName } from './index.js';

describe('extension package skeleton', () => {
  it('identifies as the parklet extension', () => {
    expect(extensionName()).toBe('parklet-extension');
    expect(EXTENSION_NAME).toBe('parklet-extension');
  });
});
