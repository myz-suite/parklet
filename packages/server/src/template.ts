/** `plt run` 的变量替换：`${name}` / `${as.path}`；`$${name}` 输出字面量。 */

/** Resolve a dotted variable path (`as.data.field`) from the run variable map. */
export function lookupVar(vars: Record<string, unknown>, path: string): unknown {
  let current: unknown = vars;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Recursively replace `${name}` / `${as.path}`; `$${name}` stays literal. */
export function interpolateValue(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exact = /^\$\{([^}]+)\}$/.exec(value);
    if (exact !== null) {
      const resolved = lookupVar(vars, exact[1]!);
      if (resolved === undefined) throw new Error(`unknown variable '${exact[1]}'`);
      return resolved;
    }
    return value.replace(/(\$?)\$\{([^}]+)\}/g, (match, esc: string, path: string) => {
      if (esc === '$') return match.slice(1);
      const resolved = lookupVar(vars, path);
      if (resolved === undefined) throw new Error(`unknown variable '${path}'`);
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, vars));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateValue(item, vars);
    }
    return out;
  }
  return value;
}
