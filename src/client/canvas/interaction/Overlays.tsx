/**
 * 다이어그램 위에 겹쳐 그리는 조작용 표시: 선택 외곽선과 손잡이, 연결 점, 연결 중인 임시 선,
 * 상자 선택 사각형, 도형 놓기 미리보기, 안내문. [담당: canvas 에이전트]
 */
import { memo, useMemo, type ReactNode } from 'react';
import { boundaryPoint, nodeCenter, nodeRect, unionBounds } from '../../../shared/geometry';
import { NODE_PRESETS, STYLE, presetOfTool, type ErdNode, type NodePreset, type Point, type Rect } from '../../../shared/types';
import { useNodeMap, useNodes, useSynced } from '../../collab/hooks';
import { useUi } from '../../state/ui';
import { worldToScreen } from '../coords';
import {
  CONNECT_DOT_OFFSET,
  CONNECT_DOT_RADIUS,
  CORNER_HANDLES,
  HANDLE_CURSOR,
  HANDLE_SIZE,
  SIDE_HANDLES,
  connectDotPoints,
  handlePoint,
  type Handle,
} from './logic';
import { useCanvasLocal } from './store';

/** 선택 외곽선을 도형 테두리에서 띄우는 간격(화면 px) */
const OUTLINE_PAD = 3;
/** 변 가운데 손잡이를 보이려면 그 변이 이만큼은 길어야 한다(화면 px) */
const SIDE_HANDLE_MIN = 44;

function padRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

// ───────────────────────── 선택 표시, 손잡이, 연결 점 ─────────────────────────

function ResizeHandles({ node, zoom }: { node: ErdNode; zoom: number }) {
  const rect = padRect(nodeRect(node), OUTLINE_PAD / zoom);
  const size = HANDLE_SIZE / zoom;
  const hit = (HANDLE_SIZE + 8) / zoom;
  const handles: Handle[] = [...CORNER_HANDLES];
  if (node.w * zoom >= SIDE_HANDLE_MIN) handles.push('n', 's');
  if (node.h * zoom >= SIDE_HANDLE_MIN) handles.push('e', 'w');
  // 변 손잡이를 먼저 그려 모서리 손잡이가 위에 오게 한다
  handles.sort((a, b) => Number(SIDE_HANDLES.includes(b)) - Number(SIDE_HANDLES.includes(a)));
  return (
    <g>
      {handles.map((h) => {
        const p = handlePoint(rect, h);
        return (
          <g key={h} data-handle={h} data-handle-node={node.id} style={{ cursor: HANDLE_CURSOR[h] }}>
            <rect className="canvas-handle-hit" x={p.x - hit / 2} y={p.y - hit / 2} width={hit} height={hit} />
            <rect className="canvas-handle" x={p.x - size / 2} y={p.y - size / 2} width={size} height={size} />
          </g>
        );
      })}
    </g>
  );
}

function ConnectDots({ node, zoom }: { node: ErdNode; zoom: number }) {
  const dots = connectDotPoints(nodeRect(node), CONNECT_DOT_OFFSET / zoom);
  return (
    <g>
      {dots.map((d) => (
        <g key={d.side} className="canvas-connect-dot" data-connect-from={node.id} data-side={d.side}>
          <circle className="canvas-connect-dot-hit" cx={d.x} cy={d.y} r={(CONNECT_DOT_RADIUS + 5) / zoom} />
          <circle className="canvas-connect-dot-mark" cx={d.x} cy={d.y} r={CONNECT_DOT_RADIUS / zoom} />
        </g>
      ))}
    </g>
  );
}

/** 선택된 노드의 파란 외곽선, 묶음 사각형, 크기 조절 손잡이, 연결 점 */
export const SelectionLayer = memo(function SelectionLayer() {
  const nodeMap = useNodeMap();
  const selection = useUi((s) => s.selection);
  const zoom = useUi((s) => s.viewport.zoom);
  const tool = useUi((s) => s.tool);
  const editingId = useUi((s) => s.editingId);
  const mode = useCanvasLocal((s) => s.mode);
  const hostId = useCanvasLocal((s) => s.hostId);
  const spaceHeld = useCanvasLocal((s) => s.spaceHeld);

  const selected = useMemo(
    () => selection.map((id) => nodeMap.get(id)).filter((n): n is ErdNode => n != null),
    [selection, nodeMap],
  );
  const single = selected.length === 1 ? selected[0] : null;
  const group = selected.length > 1 ? unionBounds(selected.map(nodeRect)) : null;
  const pad = OUTLINE_PAD / zoom;

  const idle = mode === 'idle' && !spaceHeld;
  const showHandles = single != null && single.kind !== 'spec' && single.id !== editingId && tool === 'select' && (idle || mode === 'resize');

  // 연결 점: 마우스를 올린 노드와 하나만 선택된 노드
  const dotNodes: ErdNode[] = [];
  if (idle && (tool === 'select' || tool === 'connect' || tool === 'connect-double')) {
    const ids = new Set<string>();
    if (single) ids.add(single.id);
    if (hostId) ids.add(hostId);
    for (const id of ids) {
      const n = nodeMap.get(id);
      if (n && n.kind !== 'note' && n.id !== editingId) dotNodes.push(n);
    }
  }

  return (
    <g className="canvas-selection">
      {selected.map((n) => {
        const r = padRect(nodeRect(n), pad);
        return <rect key={n.id} className="canvas-sel-outline" x={r.x} y={r.y} width={r.w} height={r.h} />;
      })}
      {group && (
        <rect
          className="canvas-sel-group"
          x={group.x - pad * 3}
          y={group.y - pad * 3}
          width={group.w + pad * 6}
          height={group.h + pad * 6}
        />
      )}
      {dotNodes.map((n) => (
        <ConnectDots key={n.id} node={n} zoom={zoom} />
      ))}
      {showHandles && single && <ResizeHandles node={single} zoom={zoom} />}
    </g>
  );
});

// ───────────────────────── 연결 중인 임시 선 ─────────────────────────

/** 임시 선과 후보 노드 표시(가능하면 파란색, 불가능하면 빨간색) */
export const ConnectDraftLayer = memo(function ConnectDraftLayer() {
  const draft = useUi((s) => s.connectDraft);
  const zoom = useUi((s) => s.viewport.zoom);
  const nodeMap = useNodeMap();
  if (!draft) return null;
  const source = nodeMap.get(draft.sourceId);
  if (!source) return null;
  const target = draft.targetId ? nodeMap.get(draft.targetId) : undefined;

  // 연결할 수 있는 후보 위에서는 선이 후보의 테두리에 붙는다
  const snapTo = target && draft.valid ? target : null;
  const start = boundaryPoint(source, snapTo ? nodeCenter(snapTo) : draft.to);
  const end = snapTo ? boundaryPoint(snapTo, nodeCenter(source)) : draft.to;

  const lines: Array<[Point, Point]> = [];
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  if (draft.double && len > 0) {
    const off = STYLE.doubleGap / 2;
    const nx = (-(end.y - start.y) / len) * off;
    const ny = ((end.x - start.x) / len) * off;
    lines.push([{ x: start.x + nx, y: start.y + ny }, { x: end.x + nx, y: end.y + ny }]);
    lines.push([{ x: start.x - nx, y: start.y - ny }, { x: end.x - nx, y: end.y - ny }]);
  } else {
    lines.push([start, end]);
  }

  const pad = (OUTLINE_PAD + 1) / zoom;
  const targetRect = target ? padRect(nodeRect(target), pad) : null;
  return (
    <g className="canvas-draft" pointerEvents="none">
      {targetRect && (
        <rect
          className={`canvas-draft-target ${draft.valid ? 'is-valid' : 'is-invalid'}`}
          x={targetRect.x}
          y={targetRect.y}
          width={targetRect.w}
          height={targetRect.h}
          rx={4 / zoom}
        />
      )}
      {lines.map(([a, b], i) => (
        <line
          key={i}
          className={`canvas-draft-line${target && !draft.valid ? ' is-invalid' : ''}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
        />
      ))}
    </g>
  );
});

/** 연결할 수 없는 이유를 마우스 옆에 보여 주는 말풍선(HTML 레이어) */
export const ConnectReason = memo(function ConnectReason() {
  const reason = useCanvasLocal((s) => s.connectReason);
  const draft = useUi((s) => s.connectDraft);
  const viewport = useUi((s) => s.viewport);
  if (!reason || !draft) return null;
  const p = worldToScreen(viewport, draft.to);
  return (
    <div className="canvas-connect-reason" role="status" style={{ left: p.x + 14, top: p.y + 18 }}>
      {reason}
    </div>
  );
});

// ───────────────────────── 상자 선택 ─────────────────────────

export const MarqueeLayer = memo(function MarqueeLayer() {
  const m = useUi((s) => s.marquee);
  if (!m) return null;
  return <rect className="canvas-marquee" x={m.x} y={m.y} width={m.w} height={m.h} pointerEvents="none" />;
});

// ───────────────────────── 도형 놓기 미리보기 ─────────────────────────

/**
 * 프리셋 모양을 단순하게 그린 반투명 도형.
 * (NodeShape를 쓰지 않는 이유: data-node-id가 붙어 실제 도형으로 세어지거나 클릭 대상이 되면 안 된다.)
 */
function Ghost({ preset, center }: { preset: NodePreset; center: Point }) {
  const { w, h } = preset;
  const x = Math.round(center.x - w / 2);
  const y = Math.round(center.y - h / 2);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const g = STYLE.doubleGap;
  const props = preset.props;
  const common = { fill: STYLE.fill, stroke: STYLE.stroke, strokeWidth: STYLE.strokeWidth } as const;
  const inner = { ...common, fill: 'none' } as const;
  const diamond = (rx: number, ry: number) => `${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}`;

  let shape: ReactNode;
  switch (preset.kind) {
    case 'entity':
      shape = (
        <>
          <rect x={x} y={y} width={w} height={h} {...common} />
          {props.weak && <rect x={x + g} y={y + g} width={w - g * 2} height={h - g * 2} {...inner} />}
        </>
      );
      break;
    case 'relationship': {
      // 안쪽 마름모는 변 사이 간격이 g가 되도록 같은 비율로 줄인다
      const k = 1 - (g * Math.hypot(w, h)) / (w * h);
      shape = (
        <>
          <polygon points={diamond(w / 2, h / 2)} {...common} />
          {props.identifying && <polygon points={diamond((w / 2) * k, (h / 2) * k)} {...inner} />}
        </>
      );
      break;
    }
    case 'attribute':
      shape = (
        <>
          <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} {...common} strokeDasharray={props.derived ? '6 4' : undefined} />
          {props.multivalued && <ellipse cx={cx} cy={cy} rx={w / 2 - g} ry={h / 2 - g} {...inner} />}
        </>
      );
      break;
    case 'spec':
      shape = <circle cx={cx} cy={cy} r={Math.min(w, h) / 2} {...common} />;
      break;
    case 'note':
      shape = <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke="#8b95a1" strokeWidth={1} strokeDasharray="4 3" />;
      break;
  }

  const text = preset.kind === 'spec' ? (props.specType ?? 'd') : preset.defaultText;
  const underline = props.keyType === 'key' || props.keyType === 'partial';
  return (
    <g className="canvas-place-preview" pointerEvents="none" opacity={0.5}>
      {shape}
      <text
        x={cx}
        y={cy}
        dy="0.35em"
        textAnchor="middle"
        fontFamily={STYLE.fontFamily}
        fontSize={STYLE.fontSize}
        fill={STYLE.stroke}
        textDecoration={underline ? 'underline' : undefined}
      >
        {text}
      </text>
    </g>
  );
}

/** 도형 놓기 도구에서 마우스를 따라다니는 미리보기 */
export const PlacePreview = memo(function PlacePreview() {
  const tool = useUi((s) => s.tool);
  const pos = useCanvasLocal((s) => s.placePos);
  const hidden = useCanvasLocal((s) => s.spaceHeld || s.mode === 'pan');
  const presetId = presetOfTool(tool);
  if (!presetId || !pos || hidden) return null;
  return <Ghost preset={NODE_PRESETS[presetId]} center={pos} />;
});

// ───────────────────────── 빈 캔버스 안내문 ─────────────────────────

export const EmptyHint = memo(function EmptyHint() {
  const empty = useNodes().length === 0;
  const synced = useSynced();
  if (!empty || !synced) return null;
  return (
    <div className="canvas-empty">
      <p className="canvas-empty-title">아직 그려진 것이 없습니다</p>
      <p>왼쪽에서 도형을 고른 뒤 캔버스를 클릭하면 놓입니다</p>
      <p>도형에 마우스를 올리면 나오는 점을 다른 도형으로 끌어 선을 잇습니다</p>
      <p>스페이스를 누른 채 끌면 화면이 움직입니다</p>
    </div>
  );
});
