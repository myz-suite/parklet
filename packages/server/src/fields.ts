import { readFileSync } from 'node:fs';
import type { FieldSpec } from '@parklet/protocol';

/** `extract --fields` 的 CLI 侧解析：不进入 wire，wire 只接收规范化后的 FieldSpec[]。 */

/** 拆分逗号/竖线，支持 `\,` / `\|` 转义。 */
function splitUnescaped(value: string, separator: string): string[] {
  const out: string[] = [];
  let current = '';
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === separator) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (escaped) current += '\\';
  out.push(current);
  return out;
}

/** 解析 `name=selector[@attr][|fallback...],...`。 */
export function parseFieldsSpec(raw: string): FieldSpec[] {
  const parts = splitUnescaped(raw, ',');
  return parts.map((part, index) => {
    const eq = part.indexOf('=');
    if (eq < 0) {
      throw new Error(`--fields item #${index + 1} must be name=selector[@attr]`);
    }
    if (eq === 0) {
      throw new Error(`--fields item #${index + 1} has an empty name`);
    }
    const name = part.slice(0, eq).trim();
    let expression = part.slice(eq + 1).trim();
    let attr: string | undefined;
    const at = expression.lastIndexOf('@');
    if (at > 0) {
      const suffix = expression.slice(at + 1);
      if (/^[A-Za-z_][\w:-]*$/.test(suffix)) {
        attr = suffix === 'text' ? undefined : suffix;
        expression = expression.slice(0, at);
      }
    }
    const selectors = splitUnescaped(expression, '|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (name.length === 0 || selectors.length === 0) {
      throw new Error(`--fields item #${index + 1} has an empty name or selector`);
    }
    return {
      name,
      selector: selectors[0]!,
      ...(selectors.length > 1 ? { alternatives: selectors.slice(1) } : {}),
      ...(attr !== undefined ? { attr } : {}),
    };
  });
}

/** 读取 JSON 文件形式的字段定义（复杂选择器/含逗号选择器用）。 */
export function readFieldsFile(path: string): FieldSpec[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`fields file '${path}' must contain a JSON array`);
  return parsed.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`fields file entry #${index + 1} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new Error(`fields file entry #${index + 1} is missing 'name'`);
    }
    if (typeof item.selector !== 'string' || item.selector.length === 0) {
      throw new Error(`fields file entry #${index + 1} is missing 'selector'`);
    }
    if (item.alternatives !== undefined && !Array.isArray(item.alternatives)) {
      throw new Error(`fields file entry #${index + 1} has invalid 'alternatives'`);
    }
    if (item.attr !== undefined && typeof item.attr !== 'string') {
      throw new Error(`fields file entry #${index + 1} has invalid 'attr'`);
    }
    return item as unknown as FieldSpec;
  });
}

/** 从 commander 的 opts 里解析 fields / fieldsFile（二选一）。 */
export function fieldsFromOpts(opts: Record<string, unknown>): FieldSpec[] | undefined {
  if (opts.fields !== undefined && opts.fieldsFile !== undefined) {
    throw new Error('use only one of --fields and --fields-file');
  }
  if (opts.fields !== undefined) return parseFieldsSpec(String(opts.fields));
  if (opts.fieldsFile !== undefined) return readFieldsFile(String(opts.fieldsFile));
  return undefined;
}
