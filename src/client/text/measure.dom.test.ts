// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STYLE } from '../../shared/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('measureText (DOM 환경)', () => {
  it('jsdom처럼 canvas가 동작하지 않는 환경에서는 근사값을 쓰고 canvas를 건드리지 않는다', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { measureText } = await import('./measure');
    const m = measureText('학생 id');
    expect(m.width).toBeCloseTo(2 * STYLE.fontSize + 3 * STYLE.fontSize * 0.56);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('canvas가 있으면 그 값으로 재고 같은 줄은 다시 재지 않는다', async () => {
    const fonts: string[] = [];
    const ctx = {
      _font: '',
      set font(value: string) {
        this._font = value;
        fonts.push(value);
      },
      get font() {
        return this._font;
      },
      measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    };
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/140' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const { measureText } = await import('./measure');

    const m = measureText('abc\n가나다라');
    expect(m.lineWidths).toEqual([21, 28]);
    expect(m.width).toBe(28);
    expect(fonts[0]).toBe(`${STYLE.fontSize}px ${STYLE.fontFamily}`);
    expect(ctx.measureText).toHaveBeenCalledTimes(2);

    measureText('abc\n가나다라\nabc');
    expect(ctx.measureText).toHaveBeenCalledTimes(2);

    // 글자 크기가 다르면 따로 잰다
    measureText('abc', 20);
    expect(ctx.measureText).toHaveBeenCalledTimes(3);
    expect(fonts.at(-1)).toBe(`20px ${STYLE.fontFamily}`);
  });
});
