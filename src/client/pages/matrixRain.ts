/**
 * 첫 화면 AI 구역의 터미널 카드에 쓰는 글자 비(매트릭스 디지털 레인).
 * 실제 글은 DOM에 그대로 두고(글자 색만 투명하게 가린다) 위에 얹은 canvas에 비와 글자를 그린다.
 * 비가 지나간 자리의 글자는 무작위 글리프를 몇 번 거쳐 제 글자로 확정되고, 다 끝나면 canvas를 걷어 원래 DOM 글자가 보인다.
 * 글자 자리는 Range로 잰 실제 위치라 한글처럼 폭이 다른 글자가 섞여도 줄이 흔들리지 않는다.
 */

const RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z:=*+<>';
const NARROW_GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ{}()<>=+*:;#$ｱｶｻﾀﾅﾊﾏﾔﾗﾜ';
const WIDE_GLYPHS = '가각간갈감강개거건걸검게고공관구국군그근기나남너노누다대도동라로리마만모무미바반버보부비사산서성소수시아안어여오우으이자장저정조주지차처초카타파하학';

/** 비 기둥 머리와 꼬리, 확정 직전 글리프의 색. 무채색 카드에 초록을 살짝만 얹는다 */
const HEAD = [226, 252, 236] as const;
const TRAIL = [74, 222, 128] as const;
const SCRAMBLE = [167, 243, 208] as const;

interface Column {
  x: number;
  start: number;
  speed: number;
  length: number;
  glyphs: string[];
}

interface Glyph {
  ch: string;
  x: number;
  baseline: number;
  w: number;
  font: string;
  color: [number, number, number];
  wide: boolean;
  hit: number;
  settle: number;
  cur: string;
  swapAt: number;
}

const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function parseColor(value: string): [number, number, number] {
  const m = value.match(/\d+(\.\d+)?/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [229, 229, 229];
}

/** 글 상자 안의 글자마다 자리와 글꼴, 색을 잰다. 공백은 건너뛴다 */
function measureGlyphs(body: HTMLElement, origin: DOMRect, ctx: CanvasRenderingContext2D): Glyph[] {
  const out: Glyph[] = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const metrics = new Map<string, { asc: number; desc: number }>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('canvas')) continue;
    const cs = getComputedStyle(parent);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const color = parseColor(cs.color);
    let m = metrics.get(font);
    if (!m) {
      ctx.font = font;
      const tm = ctx.measureText('Mg');
      m = { asc: tm.fontBoundingBoxAscent, desc: tm.fontBoundingBoxDescent };
      metrics.set(font, m);
    }
    const text = node.textContent ?? '';
    let i = 0;
    for (const ch of text) {
      const len = ch.length;
      if (ch.trim()) {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const rect = [...range.getClientRects()].find((r) => r.width > 0);
        if (rect) {
          const top = rect.top - origin.top + (rect.height - (m.asc + m.desc)) / 2;
          out.push({
            ch,
            x: rect.left - origin.left,
            baseline: top + m.asc,
            w: rect.width,
            font,
            color,
            wide: ch.charCodeAt(0) > 0x2e80,
            hit: Infinity,
            settle: Infinity,
            cur: '',
            swapAt: 0,
          });
        }
      }
      i += len;
    }
  }
  return out;
}

/**
 * body 위에 놓인 canvas에 비를 내리고 글자를 드러낸다. 다 끝나면 onDone을 부른다.
 * 돌려주는 함수를 부르면 그 자리에서 멈춘다(onDone은 부르지 않는다).
 */
export function runMatrixRain(body: HTMLElement, canvas: HTMLCanvasElement, onDone: () => void): () => void {
  let stopped = false;
  let frame = 0;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', finish);
    onDone();
  };
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    queueMicrotask(finish);
    return () => {
      stopped = true;
    };
  }
  window.addEventListener('resize', finish);

  const begin = () => {
    if (stopped) return;
    const origin = body.getBoundingClientRect();
    const W = body.clientWidth;
    const H = body.clientHeight;
    if (W === 0 || H === 0) return finish();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const glyphs = measureGlyphs(body, origin, ctx);
    const monoSize = parseFloat(getComputedStyle(body).fontSize) || 13;
    const rainFont = `400 ${monoSize}px ${getComputedStyle(body).fontFamily}`;
    ctx.font = rainFont;
    const cw = ctx.measureText('0').width || monoSize * 0.6;
    const rowH = Math.round(monoSize * 1.25);
    const step = cw + 3;
    const rainAsc = ctx.measureText('M').fontBoundingBoxAscent;

    // 기둥마다 시작 시각, 속도, 꼬리 길이가 다르다. 머리가 아래 끝을 지나 꼬리까지 빠지는 데 1.1~1.7초
    const columns: Column[] = [];
    for (let x = rand(0, 3); x < W; x += step) {
      const length = Math.round(rand(5, 16));
      const travel = rand(1100, 1700);
      const glyphs: string[] = [];
      for (let r = 0; r < Math.ceil(H / rowH) + 2; r++) glyphs.push(pick(RAIN_GLYPHS));
      columns.push({ x, start: rand(0, 480), speed: (H + rowH + length * rowH) / travel, length, glyphs });
    }

    // 글자는 자기 자리를 덮는 기둥의 머리가 지나갈 때 깨어나 무작위 글리프를 3~6번 거친 뒤 확정된다
    for (const g of glyphs) {
      const center = g.x + g.w / 2;
      const col = columns.reduce((best, c) => (Math.abs(c.x + cw / 2 - center) < Math.abs(best.x + cw / 2 - center) ? c : best), columns[0]);
      const y = g.baseline;
      g.hit = col.start + (y + rowH) / col.speed + rand(0, 60);
      g.settle = g.hit + Math.round(rand(3, 6)) * rand(45, 70);
    }
    const lastSettle = glyphs.reduce((m, g) => Math.max(m, g.settle), 0);
    const rainEnd = columns.reduce((m, c) => Math.max(m, c.start + (H + rowH + c.length * rowH) / c.speed), 0);
    const end = Math.max(lastSettle + 220, rainEnd);
    const startedAt = performance.now();

    const draw = (now: number) => {
      if (stopped) return;
      const t = now - startedAt;
      if (t >= end) return finish();
      ctx.clearRect(0, 0, W, H);

      // 비
      ctx.font = rainFont;
      for (const c of columns) {
        if (t < c.start) continue;
        const headY = -rowH + c.speed * (t - c.start);
        const headRow = Math.floor(headY / rowH);
        for (let k = 0; k <= c.length; k++) {
          const row = headRow - k;
          if (row < 0) break;
          if (row >= c.glyphs.length) continue;
          if (Math.random() < 0.05) c.glyphs[row] = pick(RAIN_GLYPHS);
          const y = row * rowH + rainAsc;
          if (k === 0) {
            ctx.fillStyle = `rgba(${HEAD[0]},${HEAD[1]},${HEAD[2]},0.95)`;
            ctx.fillText(pick(RAIN_GLYPHS), c.x, y, cw);
          } else {
            const a = Math.pow(1 - k / (c.length + 1), 1.6) * 0.55;
            ctx.fillStyle = `rgba(${TRAIL[0]},${TRAIL[1]},${TRAIL[2]},${a.toFixed(3)})`;
            ctx.fillText(c.glyphs[row], c.x, y, cw);
          }
        }
      }

      // 글자
      for (const g of glyphs) {
        if (t < g.hit) continue;
        ctx.font = g.font;
        if (t < g.settle) {
          if (t >= g.swapAt) {
            g.cur = pick(g.wide ? WIDE_GLYPHS : NARROW_GLYPHS);
            g.swapAt = t + rand(45, 70);
          }
          const a = t - g.hit < 60 ? 1 : 0.85;
          ctx.fillStyle = `rgba(${SCRAMBLE[0]},${SCRAMBLE[1]},${SCRAMBLE[2]},${a})`;
          ctx.fillText(g.cur, g.x, g.baseline, g.w);
        } else {
          // 확정되는 순간 밝게 빛났다가 원래 색으로 가라앉는다
          const k = Math.min(1, (t - g.settle) / 200);
          const mix = (i: 0 | 1 | 2) => Math.round(HEAD[i] + (g.color[i] - HEAD[i]) * k);
          ctx.fillStyle = `rgb(${mix(0)},${mix(1)},${mix(2)})`;
          ctx.fillText(g.ch, g.x, g.baseline);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
  };

  // 글꼴이 다 들어온 뒤에 재야 글자 자리가 맞는다
  const ready = document.fonts?.ready;
  if (ready) ready.then(begin, begin);
  else begin();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', finish);
  };
}
