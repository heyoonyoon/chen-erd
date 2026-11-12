/**
 * 첫 화면의 그림 카드가 화면에 들어올 때 글리치가 낀 모자이크가 왼쪽 위에서 오른쪽 아래로 풀리며 드러나는 효과.
 * 카드 속 DOM을 계산된 스타일째 복제해 SVG foreignObject 그림으로 한 번 찍고, 그 그림을 반씩 줄여
 * 블록마다 평균 색을 얻는다. 큰 블록(32px)이 16px, 8px로 쪼개지다가 사라지며, 풀리는 경계 가까이의 블록은
 * 옆으로 튀고 붉은 색과 푸른 색이 양옆으로 갈라진다. 경계가 지나간 자리는 깨끗해진다.
 */

/** SVG 도형에는 그림에 필요한 속성만 옮긴다. 크기 속성까지 옮기면 도형의 속성값을 덮어쓸 수 있다 */
const SVG_PROPS = [
  'display', 'visibility', 'opacity', 'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'font-family', 'font-size',
  'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order', 'vector-effect',
  'transform', 'transform-origin', 'transform-box',
];

/** 효과용 canvas처럼 찍지 않을 요소에 붙이는 표시 */
export const SKIP_ATTR = 'data-fx-skip';

function copyStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const style = (dst as HTMLElement).style;
  if (src instanceof SVGElement && !(src instanceof SVGSVGElement)) {
    for (const p of SVG_PROPS) style.setProperty(p, cs.getPropertyValue(p));
  } else {
    let text = '';
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      text += `${p}:${cs.getPropertyValue(p)};`;
    }
    style.cssText = text;
  }
  style.setProperty('animation', 'none');
  style.setProperty('transition', 'none');
  for (let i = 0; i < src.children.length; i++) {
    if (dst.children[i]) copyStyles(src.children[i], dst.children[i]);
  }
}

/** 요소의 안쪽(테두리 안)을 CSS px 크기 그대로 찍는다 */
export async function snapshot(el: HTMLElement): Promise<HTMLCanvasElement | null> {
  const W = el.clientWidth;
  const H = el.clientHeight;
  if (W === 0 || H === 0) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  copyStyles(el, clone);
  clone.querySelectorAll(`[${SKIP_ATTR}]`).forEach((n) => n.remove());
  // 테두리와 둥근 모서리, 그림자, 들어오는 움직임은 빼고 안쪽만 찍는다
  for (const [p, v] of [
    ['margin', '0'], ['border', '0'], ['border-radius', '0'], ['box-shadow', 'none'], ['transform', 'none'], ['opacity', '1'],
    ['width', `${W}px`], ['height', `${H}px`], ['box-sizing', 'border-box'], ['position', 'relative'], ['left', 'auto'], ['top', 'auto'],
  ]) clone.style.setProperty(p, v);
  const html = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${html}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  return out;
}

/** 그림을 반씩 줄인 단계들. levels[n]의 한 픽셀은 원래 그림의 2^n px 블록의 평균 색이다 */
function pyramid(base: HTMLCanvasElement, depth: number): HTMLCanvasElement[] {
  const levels = [base];
  for (let n = 1; n <= depth; n++) {
    const prev = levels[n - 1];
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(prev.width / 2));
    c.height = Math.max(1, Math.ceil(prev.height / 2));
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(prev, 0, 0, c.width, c.height);
    levels.push(c);
  }
  return levels;
}

/** 블록 크기 단계. 2의 거듭제곱이어야 한 블록이 아래 단계의 2×2 블록으로 딱 쪼개진다 */
const SIZES = [32, 16, 8];
const DEPTHS = [5, 4, 3];
/** 마지막 단계의 블록이 사라질 때 흐려지는 시간(ms) */
const FADE = 140;

interface Block {
  x: number;
  y: number;
  at: number;
  kids: Block[];
}

/** 색 갈라짐용 사본: 바탕색과 다른(그림이 있는) 픽셀만 그 색으로 남기고 나머지는 투명하게 둔다 */
function tinted(src: HTMLCanvasElement, tint: [number, number, number], bg: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  const img = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const diff = Math.max(Math.abs(d[k] - bg[0]), Math.abs(d[k + 1] - bg[1]), Math.abs(d[k + 2] - bg[2])) / 255;
    d[k] = tint[0];
    d[k + 1] = tint[1];
    d[k + 2] = tint[2];
    d[k + 3] = Math.round(255 * Math.min(1, diff * 4) * (d[k + 3] / 255));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function rgbOf(css: string): [number, number, number] {
  const m = css.match(/\d+(\.\d+)?/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
}

function bgColor(el: HTMLElement): string {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#fff';
}

export interface MosaicOptions {
  /** 화면에 들어온 뒤 풀리기 시작할 때까지 기다리는 시간(ms) */
  delay?: number;
  /** 다 풀리는 데 걸리는 시간(ms) */
  duration?: number;
  /** 찍을 그림을 따로 줄 때. host와 같은 CSS px 크기의 canvas를 돌려준다. 없으면 host의 DOM을 찍는다(영상 프레임은 찍히지 않는다) */
  source?: () => Promise<HTMLCanvasElement | null>;
  /** true면 화면에 들어오기를 기다리지 않고 바로 푼다 */
  immediate?: boolean;
  /** true면 오른쪽 아래에서 왼쪽 위로 푼다(기본은 왼쪽 위에서 오른쪽 아래) */
  reverse?: boolean;
  /**
   * 바꾸기 전 화면(host와 같은 CSS px 크기). 주면 모자이크 경계가 아직 닿지 않은 곳은 이 그림을 선명하게 그대로 보여 주고,
   * 경계가 지나가는 곳만 모자이크, 지나간 곳은 새 화면이 된다(쓸어 넘기듯 바뀐다)
   */
  under?: HTMLCanvasElement | null;
  onDone: () => void;
}

/**
 * host(카드)의 안쪽을 덮은 canvas에 모자이크를 그리고, host가 화면에 들어오면 푼다.
 * 찍기에 실패하면 덮개를 걷고 원래 모습을 보여 준다. 돌려주는 함수를 부르면 그 자리에서 멈춘다.
 */
export function runMosaic(host: HTMLElement, canvas: HTMLCanvasElement, { delay = 0, duration = 1200, source, immediate = false, reverse = false, under = null, onDone }: MosaicOptions): () => void {
  let stopped = false;
  let frame = 0;
  let timer = 0;
  let observer: IntersectionObserver | null = null;
  const cleanup = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    observer?.disconnect();
    window.removeEventListener('resize', finish);
  };
  function finish() {
    if (stopped) return;
    cleanup();
    onDone();
  }
  const ctx = canvas.getContext('2d');
  const W = host.clientWidth;
  const H = host.clientHeight;
  if (!ctx || W === 0 || H === 0) {
    queueMicrotask(finish);
    return cleanup;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // 찍는 동안은 카드 바탕색으로 덮어 둔다
  if (under) ctx.drawImage(under, 0, 0, canvas.width, canvas.height);
  else {
    ctx.fillStyle = bgColor(host);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', finish);

  let levels: HTMLCanvasElement[] | null = null;
  let reds: HTMLCanvasElement[] | null = null;
  let blues: HTMLCanvasElement[] | null = null;
  let inView = immediate;
  let roots: Block[] = [];

  /** 블록이 풀리는 시각. 왼쪽 위에서 오른쪽 아래로 대각선 경계가 쓸고 가되 블록마다 조금씩 어긋난다 */
  const timeOf = (cx: number, cy: number, depth: number, parentAt: number) => {
    const x = reverse ? W - cx : cx;
    const y = reverse ? H - cy : cy;
    const d = (x + y * 1.2) / (W + H * 1.2);
    const at = duration * (0.02 + 0.66 * d + 0.07 * depth + 0.1 * Math.random());
    return Math.min(duration - FADE, Math.max(at, parentAt + duration * 0.04));
  };
  const build = (x: number, y: number, depth: number, parentAt: number): Block | null => {
    const size = SIZES[depth];
    if (x >= W || y >= H) return null;
    const at = timeOf(x + size / 2, y + size / 2, depth, parentAt);
    const kids: Block[] = [];
    if (depth + 1 < SIZES.length) {
      const half = SIZES[depth + 1];
      for (const [dx, dy] of [[0, 0], [half, 0], [0, half], [half, half]]) {
        const kid = build(x + dx, y + dy, depth + 1, at);
        if (kid) kids.push(kid);
      }
    }
    return { x, y, at, kids };
  };

  /** 풀리는 경계에 가까울수록 1. 경계에서 이만큼(ms) 떨어지면 잠잠하다 */
  const NEAR = duration * 0.28;

  const paint = (t: number) => {
    if (!levels || !reds || !blues) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    const live = t >= 0;
    const lead = duration * 0.2;
    const block = (b: Block, depth: number) => {
      const size = SIZES[depth];
      if (under && depth === 0 && t < b.at - lead) {
        // 경계가 아직 닿지 않은 곳: 바꾸기 전 화면을 선명하게 그대로 둔다
        const x0 = Math.round(b.x * dpr);
        const y0 = Math.round(b.y * dpr);
        const cw = Math.min(W, b.x + size) - b.x;
        const ch = Math.min(H, b.y + size) - b.y;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(under, b.x, b.y, cw, ch, x0, y0, Math.round((b.x + cw) * dpr) - x0, Math.round((b.y + ch) * dpr) - y0);
        ctx.imageSmoothingEnabled = false;
        return;
      }
      const fading = depth === SIZES.length - 1 && t >= b.at;
      // 막 풀린 블록이 가끔 한 프레임 되살아난다
      const stutter = live && t >= b.at && t < b.at + 80 && Math.random() < 0.3;
      if (t < b.at || stutter || (fading && t < b.at + FADE)) {
        const near = live ? Math.max(0, 1 - Math.abs(b.at - t) / NEAR) : 0;
        const lv = DEPTHS[depth];
        const sx = b.x / size;
        const sy = b.y / size;
        let x0 = Math.round(b.x * dpr);
        const y0 = Math.round(b.y * dpr);
        const w = Math.round(Math.min(W, b.x + size) * dpr) - x0;
        const h = Math.round(Math.min(H, b.y + size) * dpr) - y0;
        // 경계 가까이의 블록은 옆으로 튄다
        if (near > 0 && Math.random() < 0.55 * near) x0 += Math.round((Math.random() - 0.5) * 2 * size * 0.6 * near * dpr);
        ctx.globalAlpha = fading && !stutter ? 1 - (t - b.at) / FADE : 1;
        ctx.drawImage(levels![lv], sx, sy, 1, 1, x0, y0, w, h);
        if (near > 0) {
          // 색 갈라짐: 그림이 있는 블록만 붉은 색은 왼쪽, 푸른 색은 오른쪽으로 어긋난다
          const split = Math.round((2 + 7 * near) * dpr);
          ctx.globalAlpha = 0.6 * near;
          ctx.drawImage(reds![depth], sx, sy, 1, 1, x0 - split, y0, w, h);
          ctx.drawImage(blues![depth], sx, sy, 1, 1, x0 + split, y0, w, h);
        }
        ctx.globalAlpha = 1;
        return;
      }
      if (fading) return;
      for (const k of b.kids) block(k, depth + 1);
    };
    for (const b of roots) block(b, 0);
    ctx.globalAlpha = 1;
  };

  const start = () => {
    if (stopped || !levels || !inView) return;
    observer?.disconnect();
    timer = window.setTimeout(() => {
      const began = performance.now();
      const tick = (now: number) => {
        if (stopped) return;
        const t = now - began;
        if (t >= duration) return finish();
        paint(t);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
  };

  if (!immediate) observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        inView = true;
        start();
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.2 },
  );
  observer?.observe(host);

  const ready = document.fonts?.ready ?? Promise.resolve();
  ready
    .then(() => (stopped ? null : source ? source() : snapshot(host)))
    .then((shot) => {
      if (stopped) return;
      if (!shot) return finish();
      levels = pyramid(shot, DEPTHS[0]);
      const bg = rgbOf(bgColor(host));
      reds = DEPTHS.map((d) => tinted(levels![d], [110, 168, 254], bg));
      blues = DEPTHS.map((d) => tinted(levels![d], [13, 110, 253], bg));
      roots = [];
      for (let y = 0; y < H; y += SIZES[0]) for (let x = 0; x < W; x += SIZES[0]) roots.push(build(x, y, 0, -Infinity)!);
      paint(-1);
      start();
    })
    .catch(finish);

  return cleanup;
}
