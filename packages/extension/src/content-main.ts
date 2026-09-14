/**
 * MAIN world 注入：内容脚本在 isolated world 合成的 KeyboardEvent 无法跨 world 携带
 * 自定义的 keyCode/which/charCode（页面监听器读到的都是 0），而不少站点（含 Google
 * 搜索建议）依赖 keyCode。这里在主世界补全这些旧属性的 getter：
 * - 原生（可信）事件有非 0 值 → 原样返回
 * - 合成事件（值为 0）→ 依据 `key` 推导
 * 由于 manifest 声明为 `world: "MAIN"`，此脚本不受页面 CSP 限制。
 */

const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ' ': 32,
  Control: 17,
  Shift: 16,
  Alt: 18,
  Meta: 91,
};

function codeForKey(key: string): number {
  if (key in KEY_CODES) return KEY_CODES[key]!;
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  const fn = /^F(\d{1,2})$/i.exec(key);
  if (fn) return 111 + Number(fn[1]);
  return 0;
}

function patch(prop: 'keyCode' | 'which' | 'charCode', fromChar: boolean): void {
  const proto = KeyboardEvent.prototype;
  const nativeGet = Object.getOwnPropertyDescriptor(proto, prop)?.get;
  Object.defineProperty(proto, prop, {
    configurable: true,
    get(this: KeyboardEvent) {
      const native = nativeGet ? nativeGet.call(this) : 0;
      if (native) return native;
      const key = this.key ?? '';
      if (fromChar) return key.length === 1 ? key.charCodeAt(0) : 0;
      return codeForKey(key);
    },
  });
}

try {
  patch('keyCode', false);
  patch('which', false);
  patch('charCode', true);
} catch {
  // 主世界补丁失败不应影响页面
}
