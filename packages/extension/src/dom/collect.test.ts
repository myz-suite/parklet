// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { collectForms, collectLinks, MAX_ITEMS } from './collect.js';

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      toJSON: () => ({}),
    }) as DOMRect;
});

describe('collectLinks', () => {
  it('groups by href, collects texts, and counts occurrences', () => {
    document.body.innerHTML = `
      <a href="https://ex.com/a">One</a>
      <a href="https://ex.com/a">Two</a>
      <a href="https://ex.com/b">Bee</a>`;
    const res = collectLinks(document, {});
    expect(res.total).toBe(2);
    expect(res.links[0]).toMatchObject({
      href: 'https://ex.com/a',
      texts: ['One', 'Two'],
      count: 2,
    });
  });

  it('drops javascript:, pure # anchors, and empty hrefs', () => {
    document.body.innerHTML = `
      <a href="javascript:void(0)">js</a>
      <a href="#section">frag</a>
      <a href="">empty</a>
      <a href="https://ex.com/keep">keep</a>`;
    const res = collectLinks(document, {});
    expect(res.links.map((l) => l.href)).toEqual(['https://ex.com/keep']);
  });

  it('filters invisible links by default and can include them with visibleOnly=false', () => {
    document.body.innerHTML = `
      <a href="https://ex.com/visible">v</a>
      <a href="https://ex.com/hidden" hidden>h</a>`;
    expect(collectLinks(document, {}).total).toBe(1);
    expect(collectLinks(document, { visibleOnly: false }).total).toBe(2);
  });

  it('paginates by group and echoes offset/limit', () => {
    document.body.innerHTML = `
      <a href="https://ex.com/1">1</a>
      <a href="https://ex.com/2">2</a>
      <a href="https://ex.com/3">3</a>`;
    const res = collectLinks(document, { offset: 1, limit: 1 });
    expect(res.total).toBe(3);
    expect(res.offset).toBe(1);
    expect(res.limit).toBe(1);
    expect(res.links).toHaveLength(1);
    expect(res.links[0]!.href).toBe('https://ex.com/2');
  });

  it('scopes collection to a selector', () => {
    document.body.innerHTML = `
      <div id="scope"><a href="https://ex.com/in">in</a></div>
      <a href="https://ex.com/out">out</a>`;
    const res = collectLinks(document, { selector: '#scope' });
    expect(res.links.map((l) => l.href)).toEqual(['https://ex.com/in']);
  });

  it('marks truncated when the collection limit is reached', () => {
    const links = Array.from(
      { length: MAX_ITEMS + 5 },
      (_, i) => `<a href="https://ex.com/${i}">${i}</a>`,
    ).join('');
    document.body.innerHTML = links;
    const res = collectLinks(document, {});
    expect(res.truncated).toBe(true);
    expect(res.total).toBe(MAX_ITEMS);
  });
});

describe('collectForms', () => {
  it('groups fields by form action/method/target', () => {
    document.body.innerHTML = `
      <form action="/save" method="post" target="_blank">
        <input name="a" />
      </form>
      <input name="orphan" />`;
    const res = collectForms(document, {});
    expect(res.total).toBe(2);
    const withForm = res.forms.find((f) => f.action === '/save');
    expect(withForm).toMatchObject({ method: 'POST', target: '_blank' });
    expect(withForm?.fields[0]).toMatchObject({ tag: 'input', type: 'text', name: 'a' });
    const orphan = res.forms.find((f) => f.action === undefined);
    expect(orphan?.fields[0]).toMatchObject({ name: 'orphan' });
  });

  it('resolves labels with the documented priority and dedupes', () => {
    document.body.innerHTML = `
      <label for="n">Name</label>
      <label>Wrapped <input id="n" name="n" aria-label="Aria" placeholder="PH" /></label>`;
    const res = collectForms(document, {});
    const field = res.forms[0]!.fields[0]!;
    expect(field.labels[0]).toBe('Name');
    expect(field.labels).toContain('Aria');
    expect(field.labels).toContain('PH');
  });

  it('masks password values and reports checkbox/select state', () => {
    document.body.innerHTML = `
      <form action="/x">
        <input type="password" name="pw" value="secret" />
        <input type="checkbox" name="c" checked />
        <select name="s"><option value="a">A</option><option value="b" selected>B</option></select>
        <button type="submit">Go</button>
      </form>`;
    const fields = collectForms(document, {}).forms[0]!.fields;
    expect(fields.find((f) => f.name === 'pw')?.value).toBe('********');
    expect(fields.find((f) => f.name === 'c')?.checked).toBe(true);
    expect(fields.find((f) => f.name === 's')?.selected).toContain('b');
    expect(fields.find((f) => f.tag === 'button')?.type).toBe('submit');
  });

  it('paginates fields across groups', () => {
    document.body.innerHTML = `
      <form action="/1"><input name="a" /></form>
      <form action="/2"><input name="b" /><input name="c" /></form>`;
    const res = collectForms(document, { offset: 1, limit: 1 });
    expect(res.total).toBe(3);
    expect(res.offset).toBe(1);
    expect(res.limit).toBe(1);
    expect(res.forms).toHaveLength(1);
    expect(res.forms[0]!.fields).toHaveLength(1);
    expect(res.forms[0]!.fields[0]!.name).toBe('b');
  });
});
