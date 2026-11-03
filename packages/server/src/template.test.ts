import { describe, expect, it } from 'vitest';
import { interpolateValue } from './template.js';

const vars = { base: 'https://example.com', page: { total: 25 } };

describe('interpolateValue', () => {
  it('substitutes exact and embedded variables', () => {
    expect(interpolateValue('${base}/list', vars)).toBe('https://example.com/list');
    expect(interpolateValue('${page.total}', vars)).toBe(25);
  });

  it('recurses into arrays and objects', () => {
    expect(
      interpolateValue({ url: '${base}', list: ['${page.total}', { n: '${page.total}' }] }, vars),
    ).toEqual({ url: 'https://example.com', list: [25, { n: 25 }] });
  });

  it('supports $${...} as a literal escape', () => {
    expect(interpolateValue('$${base}', vars)).toBe('${base}');
    expect(interpolateValue('x-$${base}-${base}', vars)).toBe('x-${base}-https://example.com');
  });

  it('throws for unknown variables', () => {
    expect(() => interpolateValue('${missing}', vars)).toThrow(/unknown variable/);
  });
});
