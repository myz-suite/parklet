import { describe, expect, it } from 'vitest';
import { EXTENSION_NAME, extensionName } from './index.js';

describe('extension package skeleton', () => {
  it('identifies as the parkinglot extension', () => {
    expect(extensionName()).toBe('parkinglot-extension');
    expect(EXTENSION_NAME).toBe('parkinglot-extension');
  });
});
