import { describe, expect, it } from 'vitest';
import { METHOD_META, METHODS } from './methods.js';
import type { Method, WriteAccess } from './methods.js';

describe('method metadata', () => {
  it('covers every declared method exactly once', () => {
    const metaKeys = Object.keys(METHOD_META).sort();
    const methodList = [...METHODS].sort();
    expect(metaKeys).toEqual(methodList);
  });

  it('classifies write access for each method', () => {
    const byAccess = (access: WriteAccess) =>
      METHODS.filter((m) => METHOD_META[m].writeAccess === access).sort();

    // 写操作
    expect(byAccess('always')).toEqual([
      'activate-tab',
      'back',
      'click',
      'click-text',
      'close-tab',
      'create-tab',
      'eval',
      'fill',
      'forward',
      'goto',
      'hover',
      'press',
      'reload',
      'scroll',
      'scroll-to',
      'select',
      'selection',
      'type',
    ]);

    // 只读操作（永不挂起）
    expect(byAccess('never')).toEqual([
      'dom-query',
      'extract',
      'get-page-info',
      'get-status',
      'list-tabs',
      'ping',
      'screenshot',
      'search',
      'wait',
    ]);

    // 条件性写（fetch：视 HTTP method 而定）
    expect(byAccess('conditional')).toEqual(['fetch']);
  });

  it('provides a summary for every method', () => {
    for (const m of METHODS) {
      expect(METHOD_META[m].summary.length).toBeGreaterThan(0);
    }
  });
});

// 编译期完整性：ParamsMap 必须覆盖 METHODS 全量
type _AssertParamsMapCoversMethods = Record<Method, unknown> extends object ? true : never;
const _typeCheck: _AssertParamsMapCoversMethods = true;
void _typeCheck;
