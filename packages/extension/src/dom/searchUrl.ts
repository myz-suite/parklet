/** 构造搜索引擎结果页 URL。默认引擎 google（每页 10）；duckduckgo html 每页 30。 */
export function buildSearchUrl(query: string, engine: string | undefined, page = 1): string {
  const q = encodeURIComponent(query);
  const p = Math.max(1, Math.floor(page));
  if (engine === 'duckduckgo') {
    return p <= 1
      ? `https://html.duckduckgo.com/html/?q=${q}`
      : `https://html.duckduckgo.com/html/?q=${q}&s=${(p - 1) * 30}`;
  }
  // 默认 google：分页用 start 偏移（每页 10）
  return p <= 1
    ? `https://www.google.com/search?q=${q}`
    : `https://www.google.com/search?q=${q}&start=${(p - 1) * 10}`;
}
