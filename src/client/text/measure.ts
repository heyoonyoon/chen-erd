/**
 * 글자 크기 재기와 도형 크기 맞춤. [담당: shapes 에이전트]
 * 시그니처는 계약이므로 바꾸지 않는다.
 */
import { NODE_PRESETS, STYLE, presetOf, type ErdNode } from '../../shared/types';

export interface TextMetrics {
  /** 가장 긴 줄의 너비(px) */
  width: number;
  /** 전체 높이(px) = 줄 수 * lineHeight */
  height: number;
  lines: string[];
  /** 줄별 너비 */
  lineWidths: number[];
}

// ───────────────────────── 줄 너비 재기 ─────────────────────────

type MeasureContext = Pick<CanvasRenderingContext2D, 'measureText' | 'font'>;

/** undefined = 아직 확인 안 함, null = 쓸 수 없음(근사값 사용) */
let context: MeasureContext | null | undefined;
const widthCache = new Map<string, number>();
const CACHE_LIMIT = 4000;

function getContext(): MeasureContext | null {
  if (context !== undefined) return context;
  context = null;
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    // jsdom의 canvas는 getContext가 구현되어 있지 않고 호출하면 경고만 남긴다.
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? '')) return null;
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx && typeof ctx.measureText === 'function') {
      context = ctx;
      // 글꼴이 나중에 로드되면 이전에 잰 값이 틀어지므로 버린다.
      document.fonts?.addEventListener?.('loadingdone', () => widthCache.clear());
    }
  } catch {
    context = null;
  }
  return context;
}

/** 한글, 한자, 가나, 전각 문자처럼 한 글자가 정사각형 칸을 차지하는지 */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
    (code >= 0x2e80 && code <= 0x303e) || // 한자 부수, CJK 기호
    (code >= 0x3041 && code <= 0x33ff) || // 가나, 호환 자모, CJK 호환
    (code >= 0x3400 && code <= 0x4dbf) || // 한자 확장 A
    (code >= 0x4e00 && code <= 0x9fff) || // 한자
    (code >= 0xa960 && code <= 0xa97f) || // 한글 자모 확장 A
    (code >= 0xac00 && code <= 0xd7ff) || // 한글 음절, 자모 확장 B
    (code >= 0xf900 && code <= 0xfaff) || // 한자 호환
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK 호환 꼴
    (code >= 0xff01 && code <= 0xff60) || // 전각 영숫자
    (code >= 0xffe0 && code <= 0xffe6) || // 전각 기호
    (code >= 0x1f300 && code <= 0x1faff) || // 그림 문자
    (code >= 0x20000 && code <= 0x3fffd) // 한자 확장 B 이후
  );
}

/** canvas 없이 줄 너비를 어림한다. 넓은 문자는 fontSize × 1.0, 나머지는 fontSize × 0.56 */
export function approximateLineWidth(line: string, fontSize: number = STYLE.fontSize): number {
  let width = 0;
  for (const ch of line) {
    width += isWideChar(ch.codePointAt(0) ?? 0) ? fontSize : fontSize * 0.56;
  }
  return width;
}

function lineWidth(line: string, fontSize: number): number {
  if (line === '') return 0;
  const ctx = getContext();
  if (!ctx) return approximateLineWidth(line, fontSize);
  const key = `${fontSize}|${line}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  let width: number;
  try {
    ctx.font = `${fontSize}px ${STYLE.fontFamily}`;
    width = ctx.measureText(line).width;
    if (!Number.isFinite(width)) width = approximateLineWidth(line, fontSize);
  } catch {
    width = approximateLineWidth(line, fontSize);
  }
  if (widthCache.size >= CACHE_LIMIT) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

/** '\n'으로 나눈 여러 줄 글자의 크기를 잰다. 브라우저에서는 canvas 2D로, DOM이 없으면 근사값으로. */
export function measureText(text: string, fontSize: number = STYLE.fontSize): TextMetrics {
  const lines = text.split('\n');
  const lineWidths = lines.map((line) => lineWidth(line, fontSize));
  return { width: Math.max(0, ...lineWidths), height: lines.length * STYLE.lineHeight, lines, lineWidths };
}

// ───────────────────────── 도형 크기 맞춤 ─────────────────────────

/** 마름모가 이보다 납작해지면(가로/세로) 높이도 함께 키운다 */
const MAX_DIAMOND_ASPECT = 2.5;

function ceil10(value: number): number {
  // 부동소수 오차로 140.0000001이 150이 되지 않게 한다.
  return Math.ceil((value - 1e-6) / 10) * 10;
}

/**
 * 필요한 길이가 프리셋 기본 길이 안에 들어오면 기본 길이를 그대로 쓰고(기본 크기는 10 단위가 아닐 수 있다),
 * 넘치면 10 단위로 올림한다.
 */
function snapSize(need: number, presetSize: number): number {
  return need <= presetSize + 1e-6 ? presetSize : ceil10(need);
}

/**
 * 마름모의 변을 수직 방향으로 gap만큼 안쪽으로 옮겼을 때의 축소 비율(1보다 작다. 너무 작은 도형이면 0 이하).
 * 변 x/a + y/b = 1을 평행 이동하면 두 반축이 같은 비율로 줄어든다.
 */
export function innerDiamondScale(w: number, h: number, gap: number = STYLE.doubleGap): number {
  if (w <= 0 || h <= 0) return 0;
  return 1 - (2 * gap * Math.hypot(w, h)) / (w * h);
}

/**
 * 글자 상자(bw × bh)가 w × h 마름모 안에 들어가는지. 모서리가 |x|/(W/2) + |y|/(H/2) ≤ 1을 만족해야 한다.
 * gap이 있으면(이중 마름모) 안쪽 마름모를 기준으로 본다.
 */
function diamondFits(w: number, h: number, bw: number, bh: number, gap: number): boolean {
  return bw / w + bh / h <= innerDiamondScale(w, h, gap);
}

/** 높이가 정해졌을 때 글자 상자가 들어가는 가장 좁은 마름모 너비 */
function minDiamondWidth(h: number, bw: number, bh: number, gap: number): number {
  let lo = Math.max(bw, 1);
  let hi = lo * 2;
  while (!diamondFits(hi, h, bw, bh, gap)) {
    hi *= 2;
    if (hi > 1e6) return hi; // 높이가 모자라 어떤 너비로도 들어가지 않는 경우(호출 쪽에서 막는다)
  }
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (diamondFits(mid, h, bw, bh, gap)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function fitDiamond(bw: number, bh: number, gap: number, presetH: number): { w: number; h: number } {
  let h = snapSize(bh * 2 + gap * 4, presetH);
  let w = minDiamondWidth(h, bw, bh, gap);
  if (w / h > MAX_DIAMOND_ASPECT) {
    // 긴 글자에서 지나치게 납작해지지 않게 가로세로 비율을 고정하고 높이를 다시 구한다.
    const r = MAX_DIAMOND_ASPECT;
    h = snapSize(bw / r + bh + (2 * gap * Math.hypot(r, 1)) / r, presetH);
    w = minDiamondWidth(h, bw, bh, gap);
  }
  return { w, h };
}

/**
 * 글자가 도형 안에 다 들어가는 최소 크기. 도형 모양(마름모, 타원은 같은 글자에 더 큰 외곽이 필요)을 고려하고
 * 해당 프리셋의 기본 크기보다 작아지지 않는다.
 * 기본 크기를 넘는 축은 10 단위로 올림한다(기본 크기 자체는 10 단위가 아닐 수 있고, 넘지 않으면 그대로 돌려준다).
 */
export function fitNodeSize(node: Pick<ErdNode, 'kind' | 'weak' | 'identifying' | 'multivalued' | 'derived' | 'keyType' | 'specType'>, text: string): { w: number; h: number } {
  const preset = NODE_PRESETS[presetOf(node as ErdNode)];
  if (node.kind === 'spec') return { w: preset.w, h: preset.h };

  const { width: tw, height: th } = measureText(text);
  const padX = STYLE.textPaddingX;
  const padY = STYLE.textPaddingY;
  const gap = STYLE.doubleGap;
  let w: number;
  let h: number;

  switch (node.kind) {
    case 'relationship': {
      // 마름모는 모서리 쪽이 좁아 여백을 절반만 잡아도 글자 둘레가 충분히 남는다.
      ({ w, h } = fitDiamond(tw + padX, th + padY, node.identifying ? gap : 0, preset.h));
      break;
    }
    case 'attribute': {
      // 높이는 내접 사각형 조건(글자 높이 × √2 + 여백)으로 정하고,
      // 너비는 그 높이의 타원에서 글자 위아래 끝 높이의 폭이 글자 + 좌우 여백 이상이 되게 한다.
      // 한 줄 글자에서 타원이 필요 이상으로 길어지지 않고, 줄이 많으면 글자 너비 × √2 + 여백에 가까워진다.
      const extra = node.multivalued ? gap * 2 : 0;
      h = snapSize(th * Math.SQRT2 + padY * 2 + extra, preset.h);
      w = (tw + padX * 2) / Math.sqrt(1 - (th / (h - extra)) ** 2) + extra;
      break;
    }
    default: {
      // entity, note: 글자 + 여백
      const extra = node.kind === 'entity' && node.weak ? gap * 2 : 0;
      w = tw + padX * 2 + extra;
      h = th + padY * 2 + extra;
    }
  }

  return { w: snapSize(w, preset.w), h: snapSize(h, preset.h) };
}

/**
 * 글자를 고친 뒤 노드 크기를 어떻게 바꿀지. 글자가 넘치면 중심을 유지한 채 키우고, 넘치지 않으면 그대로 둔다.
 * 바꿀 필요가 없으면 null.
 */
export function growToFit(node: ErdNode, text: string): { x: number; y: number; w: number; h: number } | null {
  const fit = fitNodeSize(node, text);
  const w = Math.max(node.w, fit.w);
  const h = Math.max(node.h, fit.h);
  if (w === node.w && h === node.h) return null;
  return { x: node.x - (w - node.w) / 2, y: node.y - (h - node.h) / 2, w, h };
}
