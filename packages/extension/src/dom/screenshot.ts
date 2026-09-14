/** 元素截图的几何计算（纯逻辑，happy-dom 可测）。 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ElementRectInfo {
  /** 元素相对当前 viewport 的矩形（CSS 像素） */
  rect: Rect;
  devicePixelRatio: number;
  viewport: ViewportSize;
}

export interface ImageSize {
  width: number;
  height: number;
}

function isFullyInViewport(rect: DOMRect, viewport: ViewportSize): boolean {
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= viewport.height &&
    rect.right <= viewport.width
  );
}

/** 在页面内测量元素矩形；不在 viewport 内则用 instant 滚动后重测（避免截到滚动中间帧）。 */
export function getElementRect(doc: Document, selector: string): ElementRectInfo {
  const el = doc.querySelector(selector);
  if (el === null) {
    throw Object.assign(new Error(`no element matches '${selector}'`), {
      code: 'TARGET_NOT_FOUND',
    });
  }
  const target = el as HTMLElement;
  const viewport: ViewportSize = { width: window.innerWidth, height: window.innerHeight };
  let rect = target.getBoundingClientRect();
  if (!isFullyInViewport(rect, viewport) && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    rect = target.getBoundingClientRect();
  }
  return {
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    devicePixelRatio: window.devicePixelRatio || 1,
    viewport,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 把 CSS 像素的 viewport rect 映射到截图 bitmap 的裁剪区。
 * 优先用 bitmap/viewport 比例（同时覆盖 DPR 与浏览器缩放），image 尺寸未知时退回 dpr。
 * 结果 clamp 到图像边界；元素超出 viewport 时只保留可见部分（不拼接）。
 */
export function computeCropRect(
  rect: Rect,
  dpr: number,
  viewport: ViewportSize,
  image: ImageSize,
): Rect {
  const scaleX = image.width > 0 && viewport.width > 0 ? image.width / viewport.width : dpr || 1;
  const scaleY =
    image.height > 0 && viewport.height > 0 ? image.height / viewport.height : dpr || 1;
  const left = Math.round(rect.x * scaleX);
  const top = Math.round(rect.y * scaleY);
  const right = Math.round((rect.x + rect.width) * scaleX);
  const bottom = Math.round((rect.y + rect.height) * scaleY);
  if (image.width <= 0 || image.height <= 0) {
    // 图像尺寸未知：无法 clamp，按比例返回（调用方保证 rect 在 viewport 内）
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }
  const cx = clamp(left, 0, image.width);
  const cy = clamp(top, 0, image.height);
  const cRight = clamp(right, 0, image.width);
  const cBottom = clamp(bottom, 0, image.height);
  return {
    x: cx,
    y: cy,
    width: Math.max(0, cRight - cx),
    height: Math.max(0, cBottom - cy),
  };
}
