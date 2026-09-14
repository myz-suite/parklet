// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { computeCropRect, getElementRect } from './screenshot.js';

describe('computeCropRect', () => {
  it('maps CSS pixels to bitmap pixels using the bitmap/viewport ratio', () => {
    const crop = computeCropRect(
      { x: 10, y: 20, width: 100, height: 50 },
      2,
      { width: 400, height: 300 },
      { width: 800, height: 600 },
    );
    expect(crop).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });

  it('falls back to dpr when the image size is unknown', () => {
    const crop = computeCropRect(
      { x: 5, y: 5, width: 10, height: 10 },
      2,
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    );
    expect(crop).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('clamps a rect that extends beyond the image to the visible part', () => {
    const crop = computeCropRect(
      { x: -20, y: -10, width: 100, height: 100 },
      1,
      { width: 200, height: 200 },
      { width: 200, height: 200 },
    );
    expect(crop).toEqual({ x: 0, y: 0, width: 80, height: 90 });
  });

  it('returns a zero-size crop for a fully offscreen element', () => {
    const crop = computeCropRect(
      { x: 500, y: 500, width: 10, height: 10 },
      1,
      { width: 200, height: 200 },
      { width: 200, height: 200 },
    );
    expect(crop.width).toBe(0);
    expect(crop.height).toBe(0);
  });
});

describe('getElementRect', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  });

  it('throws TARGET_NOT_FOUND for a missing selector', () => {
    document.body.innerHTML = '<div id="a"></div>';
    try {
      getElementRect(document, '#missing');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('TARGET_NOT_FOUND');
    }
  });

  it('returns the rect and dpr without scrolling when fully visible', () => {
    document.body.innerHTML = '<div id="a"></div>';
    const el = document.getElementById('a')!;
    el.getBoundingClientRect = () =>
      ({ top: 10, left: 20, right: 120, bottom: 60, width: 100, height: 50 }) as DOMRect;
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy;
    const info = getElementRect(document, '#a');
    expect(info.rect).toEqual({ x: 20, y: 10, width: 100, height: 50 });
    expect(info.devicePixelRatio).toBe(2);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('scrolls (instant) then re-measures when the element is offscreen', () => {
    document.body.innerHTML = '<div id="a"></div>';
    const el = document.getElementById('a')!;
    let scrolled = false;
    el.scrollIntoView = vi.fn(() => {
      scrolled = true;
    });
    el.getBoundingClientRect = () =>
      (scrolled
        ? { top: 100, left: 100, right: 200, bottom: 150, width: 100, height: 50 }
        : { top: 5000, left: 20, right: 120, bottom: 5050, width: 100, height: 50 }) as DOMRect;
    const info = getElementRect(document, '#a');
    expect(el.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'center',
      inline: 'center',
    });
    expect(info.rect).toEqual({ x: 100, y: 100, width: 100, height: 50 });
  });
});
