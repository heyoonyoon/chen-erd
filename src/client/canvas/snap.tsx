/**
 * 이동/크기 조절 중 정렬 맞춤과 안내선. [담당: snap 에이전트]
 */
import type { Guide, Rect } from '../../shared/types';
import { useUi } from '../state/ui';

export interface SnapResult {
  /** 맞춤을 적용하려면 이동량에 더해야 하는 보정값 */
  dx: number;
  dy: number;
  guides: Guide[];
}

/** 안내선이 도형 바깥으로 더 나가는 길이(월드 단위) */
export const GUIDE_PAD = 8;
/** 같은 간격 표시의 양 끝 눈금 길이의 절반(월드 단위) */
export const GAP_TICK = 4;
export const GUIDE_COLOR = '#ff3db4';

/** 거리가 같다고 볼 오차 */
const TIE_EPS = 1e-6;
/** 보정 후 같은 선 위에 있다고 볼 오차 */
const ALIGN_EPS = 0.01;

/**
 * 한 축에서 가장 가까운 맞춤 보정값을 찾는다. 후보가 없으면 null.
 * 거리가 같으면 가운데끼리 맞는 후보를 고른다.
 */
function bestDelta(
  mStart: number,
  mSize: number,
  others: Rect[],
  xAxis: boolean,
  threshold: number,
): number | null {
  let best = 0;
  let bestAbs = Infinity;
  let bestCenter = false;
  const mEnd = mStart + mSize;
  const mLines = mSize > 0 ? 3 : 1;
  for (let k = 0; k < others.length; k++) {
    const o = others[k];
    const oStart = xAxis ? o.x : o.y;
    const oSize = xAxis ? o.w : o.h;
    // 범위가 threshold보다 멀리 떨어져 있으면 어떤 선도 맞을 수 없다
    if (oStart > mEnd + threshold || oStart + oSize < mStart - threshold) continue;
    for (let i = 0; i < 3; i++) {
      const oLine = oStart + (oSize * i) / 2;
      for (let j = 0; j < mLines; j++) {
        const d = oLine - (mStart + (mSize * j) / 2);
        const a = d < 0 ? -d : d;
        if (!(a <= threshold)) continue;
        const center = i === 1 && j === 1;
        if (a < bestAbs - TIE_EPS || (a <= bestAbs + TIE_EPS && center && !bestCenter)) {
          best = d;
          bestAbs = a;
          bestCenter = center;
        }
      }
    }
  }
  return bestAbs === Infinity ? null : best;
}

/**
 * 보정이 끝난 moving의 기준선 3개에 대해, 그 선 위에 기준선이 놓인 other들을 모아 안내선을 만든다.
 * 같은 위치에 맞는 other가 여럿이어도 안내선은 하나다.
 */
function collectGuides(
  out: Guide[],
  mStart: number,
  mSize: number,
  crossStart: number,
  crossSize: number,
  others: Rect[],
  xAxis: boolean,
): void {
  const mLines = mSize > 0 ? 3 : 1;
  for (let j = 0; j < mLines; j++) {
    const mLine = mStart + (mSize * j) / 2;
    let pos = mLine;
    let from = Infinity;
    let to = -Infinity;
    for (let k = 0; k < others.length; k++) {
      const o = others[k];
      const oStart = xAxis ? o.x : o.y;
      const oSize = xAxis ? o.w : o.h;
      if (oStart > mLine + ALIGN_EPS || oStart + oSize < mLine - ALIGN_EPS) continue;
      for (let i = 0; i < 3; i++) {
        const oLine = oStart + (oSize * i) / 2;
        const d = oLine - mLine;
        if (d > ALIGN_EPS || d < -ALIGN_EPS) continue;
        const cStart = xAxis ? o.y : o.x;
        const cEnd = cStart + (xAxis ? o.h : o.w);
        if (from === Infinity) pos = oLine; // 가만히 있는 도형 쪽 값을 써서 오차가 쌓이지 않게 한다
        if (cStart < from) from = cStart;
        if (cEnd > to) to = cEnd;
        break;
      }
    }
    if (from === Infinity) continue;
    if (crossStart < from) from = crossStart;
    if (crossStart + crossSize > to) to = crossStart + crossSize;
    out.push({ orientation: xAxis ? 'v' : 'h', pos, from: from - GUIDE_PAD, to: to + GUIDE_PAD });
  }
}

/** 같은 간격 맞춤 후보. kind: 0 = a와 b 사이, 1 = b의 오른쪽, 2 = a의 왼쪽 */
interface SpacingHit {
  dx: number;
  a: Rect;
  b: Rect;
  kind: 0 | 1 | 2;
}

/**
 * 가로로 나란한(세로 범위가 moving과 겹치는) 도형들 가운데 이웃한 두 도형 a, b를 골라,
 * moving까지 세 도형의 가로 간격이 같아지는 x 위치를 찾는다. threshold 안에서 가장 가까운 후보 하나만 돌려준다.
 */
function bestSpacing(
  mx: number,
  my: number,
  mw: number,
  mh: number,
  others: Rect[],
  threshold: number,
): SpacingHit | null {
  let row: Rect[] | null = null;
  for (let k = 0; k < others.length; k++) {
    const o = others[k];
    if (o.y < my + mh && o.y + o.h > my) (row ??= []).push(o);
  }
  if (!row || row.length < 2) return null;
  row.sort((p, q) => p.x - q.x);

  let bestAbs = Infinity;
  let bestDx = 0;
  let bestI = -1;
  let bestKind: 0 | 1 | 2 = 0;
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i];
    const b = row[i + 1];
    const aRight = a.x + a.w;
    const gap = b.x - aRight;
    if (!(gap > 0)) continue;
    for (let kind = 0; kind < 3; kind++) {
      let tx: number;
      if (kind === 0) {
        if (gap < mw) continue; // 사이에 들어갈 자리가 없다
        tx = (aRight + b.x - mw) / 2;
      } else if (kind === 1) {
        tx = b.x + b.w + gap;
        // 그 자리에 다른 도형이 끼어 있으면 세 도형이 나란한 것이 아니다
        if (i + 2 < row.length && row[i + 2].x < tx + mw) continue;
      } else {
        tx = a.x - gap - mw;
        if (i > 0 && row[i - 1].x + row[i - 1].w > tx) continue;
      }
      const d = tx - mx;
      const abs = d < 0 ? -d : d;
      if (abs <= threshold && abs < bestAbs - TIE_EPS) {
        bestAbs = abs;
        bestDx = d;
        bestI = i;
        bestKind = kind as 0 | 1 | 2;
      }
    }
  }
  if (bestI < 0) return null;
  return { dx: bestDx, a: row[bestI], b: row[bestI + 1], kind: bestKind };
}

/** 간격 하나를 가로 막대와 양 끝 눈금으로 표시한다. */
function pushGap(out: Guide[], y: number, from: number, to: number): void {
  out.push({ orientation: 'h', pos: y, from, to });
  out.push({ orientation: 'v', pos: from, from: y - GAP_TICK, to: y + GAP_TICK });
  out.push({ orientation: 'v', pos: to, from: y - GAP_TICK, to: y + GAP_TICK });
}

/**
 * moving(이동 중인 도형들을 감싼 사각형, 이미 이동량이 반영된 위치)을 others(가만히 있는 도형들)의
 * 왼쪽/가운데/오른쪽, 위/가운데/아래 선에 맞춘다. threshold(월드 단위) 안에 들어온 가장 가까운 선에 붙는다.
 *
 * 추가로 x축은 가로로 나란한 두 도형과 간격이 같아지는 위치에도 붙는다(정렬 후보보다 더 가까울 때만).
 * 이때 guides에는 두 간격을 나타내는 가로 막대와 눈금이 들어간다.
 */
export function computeSnap(moving: Rect, others: Rect[], threshold: number): SnapResult {
  if (others.length === 0 || !(threshold >= 0)) return { dx: 0, dy: 0, guides: [] };

  const ay = bestDelta(moving.y, moving.h, others, false, threshold);
  const dy = ay ?? 0;
  const y = moving.y + dy;

  const ax = bestDelta(moving.x, moving.w, others, true, threshold);
  let spacing = bestSpacing(moving.x, y, moving.w, moving.h, others, threshold);
  let dx = ax ?? 0;
  if (spacing) {
    const sAbs = Math.abs(spacing.dx);
    if (ax === null || sAbs < Math.abs(ax) - TIE_EPS) dx = spacing.dx;
    else if (Math.abs(spacing.dx - ax) > ALIGN_EPS) spacing = null; // 정렬이 이겼고 간격은 맞지 않는다
  }

  const guides: Guide[] = [];
  if (ax === null && ay === null && !spacing) return { dx: 0, dy: 0, guides };

  const x = moving.x + dx;
  if (ax !== null || spacing) collectGuides(guides, x, moving.w, y, moving.h, others, true);
  if (ay !== null) collectGuides(guides, y, moving.h, x, moving.w, others, false);
  if (spacing) {
    const { a, b, kind } = spacing;
    const cy = y + moving.h / 2;
    const aRight = a.x + a.w;
    if (kind === 0) {
      pushGap(guides, cy, aRight, x);
      pushGap(guides, cy, x + moving.w, b.x);
    } else if (kind === 1) {
      pushGap(guides, cy, aRight, b.x);
      pushGap(guides, cy, b.x + b.w, x);
    } else {
      pushGap(guides, cy, x + moving.w, a.x);
      pushGap(guides, cy, aRight, b.x);
    }
  }
  return { dx, dy, guides };
}

/** 값을 격자 간격의 배수로 맞춘다. */
export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/** ui.guides를 그리는 SVG 레이어. Canvas의 월드 변환 <g> 안에 놓는다. 선 굵기는 배율과 무관하게 1px로 보이게 한다. */
export function GuidesLayer() {
  const guides = useUi((s) => s.guides);
  if (guides.length === 0) return null;
  return (
    <g pointerEvents="none" stroke={GUIDE_COLOR} strokeWidth={1} fill="none" data-testid="guides">
      {guides.map((g, i) => {
        const v = g.orientation === 'v';
        // vector-effect는 상속되지 않으므로 선마다 넣는다
        return (
          <line
            key={i}
            x1={v ? g.pos : g.from}
            y1={v ? g.from : g.pos}
            x2={v ? g.pos : g.to}
            y2={v ? g.to : g.pos}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
