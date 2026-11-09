import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldsFromOpts, parseFieldsSpec, readFieldsFile } from './fields.js';

describe('parseFieldsSpec', () => {
  it('parses text, attr, alternatives and escapes', () => {
    expect(
      parseFieldsSpec(
        'author=[data-testid="User-Name"] span,datetime=time@datetime,text=[data-testid="tweetText"]|.fallback',
      ),
    ).toEqual([
      { name: 'author', selector: '[data-testid="User-Name"] span' },
      { name: 'datetime', selector: 'time', attr: 'datetime' },
      {
        name: 'text',
        selector: '[data-testid="tweetText"]',
        alternatives: ['.fallback'],
      },
    ]);
    expect(parseFieldsSpec('x=a\\,b')).toEqual([{ name: 'x', selector: 'a,b' }]);
  });

  it('unescapes only the active separator and preserves CSS escapes', () => {
    expect(parseFieldsSpec('x=a\\|b')).toEqual([{ name: 'x', selector: 'a|b' }]);
    expect(parseFieldsSpec('x=.md\\:flex')).toEqual([{ name: 'x', selector: '.md\\:flex' }]);
  });

  it('treats @text as text', () => {
    expect(parseFieldsSpec('text=span@text')).toEqual([{ name: 'text', selector: 'span' }]);
  });

  it('rejects malformed items', () => {
    expect(() => parseFieldsSpec('missing-equals')).toThrow(/name=selector/);
    expect(() => parseFieldsSpec('=a')).toThrow(/empty name/);
    expect(() => parseFieldsSpec('x=')).toThrow(/empty name or selector/);
  });
});

describe('readFieldsFile', () => {
  it('reads and validates a JSON array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plt-fields-'));
    const file = join(dir, 'fields.json');
    try {
      writeFileSync(
        file,
        JSON.stringify([
          { name: 'datetime', selector: 'time', attr: 'datetime' },
          { name: 'text', selector: '.text', alternatives: ['.alt'] },
        ]),
      );
      expect(readFieldsFile(file)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fieldsFromOpts', () => {
  it('rejects using both --fields and --fields-file', () => {
    expect(() => fieldsFromOpts({ fields: 'x=a', fieldsFile: 'f.json' })).toThrow(/only one/);
  });

  it('returns undefined when neither is provided', () => {
    expect(fieldsFromOpts({})).toBeUndefined();
  });
});
