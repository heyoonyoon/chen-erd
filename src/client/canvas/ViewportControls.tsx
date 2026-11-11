/**
 * 화면 이동/확대와 관련된 부품. [담당: viewport 에이전트]
 * 계산은 viewportMath.ts의 순수 함수가 하고, 여기서는 ui store에 반영하고 화면을 그린다.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { diagramBounds } from '../../shared/geometry';
import { MAX_ZOOM, MIN_ZOOM } from '../../shared/types';
import type { ErdEdge, ErdNode, Point, Rect, Viewport } from '../../shared/types';
import { useEdges, useNodes } from '../collab/hooks';
import { useT } from '../i18n';
import { ui, useUi } from '../state/ui';
import { clientToScreen, screenToWorld, visibleWorldRect } from './coords';
import {
  FIT_PADDING,
  centerViewportOn,
  fitRect,
  fitViewport,
  gridLayout,
  panViewport,
  sizeCenter,
  unionRect,
  wheelDeltaPx,
  wheelPan,
  wheelZoomFactor,
  zoomViewportAt,
  zoomViewportTo,
} from './viewportMath';
import './ViewportControls.css';

// ───────────────────────── 화면 이동/확대 함수 ─────────────────────────

function applyViewport(next: Viewport): void {
  const s = ui();
  const cur = s.viewport;
  if (next === cur || (next.x === cur.x && next.y === cur.y && next.zoom === cur.zoom)) return;
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.zoom)) return;
  s.setViewport(next);
}

/** 왼쪽 도구 팔레트(RoomPage의 slot-left)가 캔버스를 가리는 폭(px) */
const LEFT_INSET = 72;

/** 화면을 dx, dy(px)만큼 민다. */
export function panBy(dx: number, dy: number): void {
  applyViewport(panViewport(ui().viewport, dx, dy));
}
/** 화면의 한 점(캔버스 영역 기준 px)을 고정한 채 factor배 확대/축소한다. MIN_ZOOM~MAX_ZOOM으로 제한. */
export function zoomAt(screen: Point, factor: number): void {
  applyViewport(zoomViewportAt(ui().viewport, screen, factor));
}
/** 캔버스 가운데를 기준으로 확대/축소 */
export function zoomBy(factor: number): void {
  zoomAt(sizeCenter(ui().canvasSize), factor);
}
/** 배율을 정확히 zoom으로 맞춘다(가운데 기준). */
export function setZoom(zoom: number): void {
  const s = ui();
  applyViewport(zoomViewportTo(s.viewport, sizeCenter(s.canvasSize), zoom));
}
/** 월드 영역 rect가 화면에 다 보이도록 맞춘다. rect가 null이면 배율 1, 원점으로. */
export function zoomToRect(rect: Rect | null, padding: number = FIT_PADDING): void {
  const size = ui().canvasSize;
  // 왼쪽 도구 팔레트가 가리는 폭만큼은 빼고 맞춘다(그림 왼쪽 끝이 팔레트 밑에 깔리지 않게)
  if (rect && size.w > LEFT_INSET * 4) {
    const v = fitViewport(rect, { w: size.w - LEFT_INSET, h: size.h }, padding);
    applyViewport({ ...v, x: v.x + LEFT_INSET });
    return;
  }
  applyViewport(fitViewport(rect, size, padding));
}
/** 월드의 한 점이 화면 가운데에 오도록 민다(배율 유지). */
export function centerOn(world: Point): void {
  const s = ui();
  applyViewport(centerViewportOn(s.viewport, s.canvasSize, world));
}

// ───────────────────────── 휠, 트랙패드 ─────────────────────────

/** Safari의 GestureEvent(표준이 아니라 DOM 타입에 없다) */
interface GestureEventLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * 휠과 트랙패드 동작을 연결한다. 휠 = 화면 이동, Ctrl/Cmd+휠 또는 핀치 = 마우스 위치 기준 확대.
 * (wheel 이벤트는 passive: false로 직접 등록해야 preventDefault가 먹는다.)
 */
export function useWheelZoom(ref: RefObject<Element | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Safari 핀치 중에는 gesture 이벤트로만 확대한다(같은 동작이 두 번 반영되지 않게)
    let gesturing = false;
    let lastScale = 1;

    const onWheel = (ev: Event) => {
      const e = ev as WheelEvent;
      const zooming = e.ctrlKey || e.metaKey;
      // 입력창 위의 일반 휠은 입력창이 스스로 스크롤하게 둔다. 확대 동작은 페이지가 커지지 않게 캔버스가 받는다.
      if (!zooming && isEditableTarget(e.target)) return;
      // 페이지 확대, 뒤로 가기 제스처, 페이지 스크롤을 막는다
      e.preventDefault();

      const size = ui().canvasSize;
      if (zooming) {
        if (gesturing) return;
        const dy = wheelDeltaPx(e.deltaY, e.deltaMode, size.h);
        zoomAt(clientToScreen(el, e.clientX, e.clientY), wheelZoomFactor(dy));
        return;
      }
      const dx = wheelDeltaPx(e.deltaX, e.deltaMode, size.w);
      const dy = wheelDeltaPx(e.deltaY, e.deltaMode, size.h);
      const d = wheelPan(dx, dy, e.shiftKey);
      panBy(d.x, d.y);
    };

    const onGestureStart = (ev: Event) => {
      ev.preventDefault();
      gesturing = true;
      lastScale = 1;
    };
    const onGestureChange = (ev: Event) => {
      ev.preventDefault();
      const e = ev as GestureEventLike;
      if (!Number.isFinite(e.scale) || e.scale <= 0) return;
      const factor = e.scale / lastScale;
      lastScale = e.scale;
      zoomAt(clientToScreen(el, e.clientX, e.clientY), factor);
    };
    const onGestureEnd = (ev: Event) => {
      ev.preventDefault();
      gesturing = false;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [ref]);
}

// ───────────────────────── 격자 ─────────────────────────

const GRID_PATTERN_ID = 'viewport-grid-pattern';

/** 격자 배경. Canvas의 <svg> 안, 월드 변환 <g>의 바깥에 놓는다(화면 좌표로 그린다). ui.showGrid가 false면 아무것도 그리지 않는다. */
export function Grid() {
  const showGrid = useUi((s) => s.showGrid);
  const viewport = useUi((s) => s.viewport);
  if (!showGrid) return null;

  const g = gridLayout(viewport);
  const half = g.step / 2;
  return (
    <g className="viewport-grid" pointerEvents="none" aria-hidden="true">
      <defs>
        {/* 점이 타일 가장자리에서 잘리지 않게 타일 가운데에 찍고, 타일을 반 칸 당겨 놓는다 */}
        <pattern
          id={GRID_PATTERN_ID}
          patternUnits="userSpaceOnUse"
          x={g.offsetX - half}
          y={g.offsetY - half}
          width={g.step}
          height={g.step}
        >
          <circle className="viewport-grid-dot" cx={half} cy={half} r={1} />
        </pattern>
      </defs>
      <rect x={0} y={0} width="100%" height="100%" fill={`url(#${GRID_PATTERN_ID})`} pointerEvents="none" />
    </g>
  );
}

// ───────────────────────── 확대/축소 버튼 ─────────────────────────

const ZOOM_STEP = 1.25;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function IconButton(props: {
  label: string;
  title?: string;
  testId?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const toggle = props.pressed !== undefined;
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon${props.pressed ? ' is-active' : ''}`}
      title={props.title ?? props.label}
      aria-label={props.label}
      aria-pressed={toggle ? props.pressed : undefined}
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** 전체 보기 버튼. 노드 목록을 구독하는 부분을 따로 떼어 나머지 버튼이 다시 그려지지 않게 한다. */
function FitButton() {
  const nodes = useNodes();
  const t = useT();
  return (
    <IconButton label={t('common.fit')} testId="zoom-fit" onClick={() => zoomToRect(diagramBounds(nodes, 0))}>
      <Icon>
        <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
      </Icon>
    </IconButton>
  );
}

/** 왼쪽 아래의 확대/축소 버튼 묶음(−, 배율 %, +, 전체 보기, 격자 켜기/끄기, 붙기 켜기/끄기) */
export function ZoomControls() {
  const zoom = useUi((s) => s.viewport.zoom);
  const showGrid = useUi((s) => s.showGrid);
  const snapEnabled = useUi((s) => s.snapEnabled);
  const minimapOpen = useUi((s) => s.panels.minimap);
  const percent = Math.round(zoom * 100);
  const t = useT();

  return (
    <div className="panel zoom-controls" role="toolbar" aria-label={t('view.toolbarLabel')}>
      <IconButton label={t('common.zoomOut')} testId="zoom-out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / ZOOM_STEP)}>
        <Icon>
          <path d="M3.5 8h9" />
        </Icon>
      </IconButton>
      <button
        type="button"
        className="btn btn-ghost zoom-controls-level"
        title={t('view.zoomReset')}
        aria-label={t('view.zoomResetLabel', { percent })}
        data-testid="zoom-level"
        onClick={() => setZoom(1)}
      >
        {percent}%
      </button>
      <IconButton label={t('common.zoomIn')} testId="zoom-in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>
        <Icon>
          <path d="M3.5 8h9M8 3.5v9" />
        </Icon>
      </IconButton>
      <FitButton />
      <span className="zoom-controls-sep" aria-hidden="true" />
      <IconButton
        label={t('view.grid')}
        title={showGrid ? t('view.gridOff') : t('view.gridOn')}
        testId="toggle-grid"
        pressed={showGrid}
        onClick={() => ui().setShowGrid(!ui().showGrid)}
      >
        <Icon>
          <g fill="currentColor" stroke="none">
            <circle cx="3.5" cy="3.5" r="1.1" />
            <circle cx="8" cy="3.5" r="1.1" />
            <circle cx="12.5" cy="3.5" r="1.1" />
            <circle cx="3.5" cy="8" r="1.1" />
            <circle cx="8" cy="8" r="1.1" />
            <circle cx="12.5" cy="8" r="1.1" />
            <circle cx="3.5" cy="12.5" r="1.1" />
            <circle cx="8" cy="12.5" r="1.1" />
            <circle cx="12.5" cy="12.5" r="1.1" />
          </g>
        </Icon>
      </IconButton>
      <IconButton
        label={t('view.snap')}
        title={snapEnabled ? t('view.snapOff') : t('view.snapOn')}
        testId="toggle-snap"
        pressed={snapEnabled}
        onClick={() => ui().setSnapEnabled(!ui().snapEnabled)}
      >
        {/* 안내선 하나에 도형 두 개가 맞춰 선 모양 */}
        <Icon>
          <path d="M3 1.5v13" />
          <rect x="5.5" y="3" width="8" height="3.5" rx="0.5" />
          <rect x="5.5" y="9.5" width="5" height="3.5" rx="0.5" />
        </Icon>
      </IconButton>
      <IconButton
        label={t('view.minimap')}
        title={minimapOpen ? t('view.minimapOff') : t('view.minimapOn')}
        testId="toggle-minimap"
        pressed={minimapOpen}
        onClick={() => ui().togglePanel('minimap')}
      >
        <Icon>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <rect x="8" y="8" width="4.5" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
        </Icon>
      </IconButton>
    </div>
  );
}

// ───────────────────────── 미니맵 ─────────────────────────

const MINIMAP_W = 200;
const MINIMAP_H = 140;
const MINIMAP_PADDING = 8;

const MiniNode = memo(function MiniNode({ node }: { node: ErdNode }) {
  const { x, y, w, h } = node;
  switch (node.kind) {
    case 'relationship':
      return (
        <polygon
          className="minimap-node"
          points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
        />
      );
    case 'attribute':
      return <ellipse className="minimap-node" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
    case 'spec':
      return <circle className="minimap-node" cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} />;
    case 'note':
      return <rect className="minimap-node minimap-node-note" x={x} y={y} width={w} height={h} />;
    default:
      return <rect className="minimap-node" x={x} y={y} width={w} height={h} />;
  }
});

/** 월드 좌표로 그린 미니맵 내용. 화면을 밀 때는 바깥 <g>의 transform만 바뀌고 이 부분은 다시 그려지지 않는다. */
const MinimapContent = memo(function MinimapContent({ nodes, edges }: { nodes: ErdNode[]; edges: ErdEdge[] }) {
  const lines = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let d = '';
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      d += `M${a.x + a.w / 2} ${a.y + a.h / 2}L${b.x + b.w / 2} ${b.y + b.h / 2}`;
    }
    return d;
  }, [nodes, edges]);

  return (
    <>
      {lines && <path className="minimap-edge" d={lines} />}
      {nodes.map((n) => (
        <MiniNode key={n.id} node={n} />
      ))}
    </>
  );
});

/** 오른쪽 아래의 미니맵. 전체 다이어그램과 현재 보이는 영역을 보여 주고, 클릭/드래그하면 그 위치로 이동한다. */
export function Minimap() {
  const t = useT();
  const nodes = useNodes();
  const edges = useEdges();
  const viewport = useUi((s) => s.viewport);
  const canvasSize = useUi((s) => s.canvasSize);
  // 끄는 동안에는 축척을 고정한다(화면이 움직이면서 범위가 바뀌면 마우스 아래 위치가 달라지기 때문)
  const [frozen, setFrozen] = useState<Viewport | null>(null);
  const frozenRef = useRef<Viewport | null>(null);

  const bounds = useMemo(() => diagramBounds(nodes, 0), [nodes]);
  if (!bounds) return null;

  const visible = visibleWorldRect(viewport, canvasSize);
  const layout =
    frozen ?? fitRect(unionRect(bounds, visible), { w: MINIMAP_W, h: MINIMAP_H }, MINIMAP_PADDING);

  const moveTo = (e: ReactPointerEvent<SVGSVGElement>, map: Viewport) => {
    centerOn(screenToWorld(map, clientToScreen(e.currentTarget, e.clientX, e.clientY)));
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 포인터 캡처를 못 해도 클릭 이동은 된다
    }
    frozenRef.current = layout;
    setFrozen(layout);
    moveTo(e, layout);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (frozenRef.current) moveTo(e, frozenRef.current);
  };
  const endDrag = () => {
    if (!frozenRef.current) return;
    frozenRef.current = null;
    setFrozen(null);
  };

  return (
    <div className="panel minimap" data-testid="minimap">
      <svg
        className={`minimap-svg${frozen ? ' is-dragging' : ''}`}
        width={MINIMAP_W}
        height={MINIMAP_H}
        role="img"
        aria-label={t('view.minimap')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <g transform={`translate(${layout.x} ${layout.y}) scale(${layout.zoom})`}>
          <MinimapContent nodes={nodes} edges={edges} />
        </g>
        <rect
          className="minimap-view"
          data-testid="minimap-view"
          x={visible.x * layout.zoom + layout.x}
          y={visible.y * layout.zoom + layout.y}
          width={Math.max(visible.w * layout.zoom, 2)}
          height={Math.max(visible.h * layout.zoom, 2)}
          rx={1.5}
        />
      </svg>
    </div>
  );
}
