/**
 * 캔버스. SVG로 다이어그램을 그리고 마우스 조작(선택, 이동, 크기 조절, 연결, 도형 놓기, 화면 이동)을 처리한다.
 * [담당: canvas 에이전트]
 *
 * 조작 처리는 interaction/ 아래에 있다. 이 파일은 층을 쌓고 부품을 조립한다.
 * 다시 그리기를 줄이기 위해 층마다 필요한 상태만 구독하고, 노드/엣지 하나하나는 memo로 감싼다.
 */
import { memo, useMemo, useRef, type ReactNode } from 'react';
import { computeEdgeGeometry, siblingInfo } from '../../shared/geometry';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { useEdges, useNodeMap, useNodes } from '../collab/hooks';
import { RemoteCursors, RemoteSelections, useBroadcastCursor } from '../presence/Presence';
import { useUi } from '../state/ui';
import { viewportTransform } from './coords';
import { EdgeShape } from './EdgeShape';
import { ConnectDraftLayer, ConnectReason, EdgeEndsLayer, EmptyHint, MarqueeLayer, PlacePreview, SelectionLayer } from './interaction/Overlays';
import { useCanvasCursor, useCanvasSize, useInitialFit, useSpaceKey } from './interaction/useCanvasSetup';
import { usePointerInteractions } from './interaction/usePointerInteractions';
import { NodeShape } from './NodeShape';
import { GuidesLayer } from './snap';
import { TextEditor } from './TextEditor';
import { Grid, useWheelZoom } from './ViewportControls';
import './Canvas.css';

/** 월드 좌표계. 뷰포트가 바뀌면 이 <g>의 transform만 바뀌고 안쪽 층은 다시 그리지 않는다. */
function World({ children }: { children: ReactNode }) {
  const viewport = useUi((s) => s.viewport);
  return <g transform={viewportTransform(viewport)}>{children}</g>;
}

interface EdgeViewProps {
  edge: ErdEdge;
  source: ErdNode;
  target: ErdNode;
  siblingIndex: number;
  siblingCount: number;
  selected: boolean;
  hovered: boolean;
  highlighted: boolean;
}

/** 엣지 좌표는 엣지나 양 끝 노드의 참조가 바뀔 때만 다시 계산한다. */
const EdgeView = memo(function EdgeView({ edge, source, target, siblingIndex, siblingCount, selected, hovered, highlighted }: EdgeViewProps) {
  const geometry = useMemo(
    () => computeEdgeGeometry(edge, source, target, siblingIndex, siblingCount),
    [edge, source, target, siblingIndex, siblingCount],
  );
  return <EdgeShape edge={edge} geometry={geometry} selected={selected} hovered={hovered} highlighted={highlighted} />;
});

const EdgesLayer = memo(function EdgesLayer() {
  const edges = useEdges();
  const nodeMap = useNodeMap();
  const selection = useUi((s) => s.selection);
  const hoveredId = useUi((s) => s.hoveredId);
  const highlightIds = useUi((s) => s.highlightIds);
  const siblings = useMemo(() => siblingInfo(edges), [edges]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const highlighted = useMemo(() => new Set(highlightIds), [highlightIds]);
  return (
    <g className="canvas-edges">
      {edges.map((e) => {
        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        if (!source || !target) return null;
        const sib = siblings.get(e.id);
        return (
          <EdgeView
            key={e.id}
            edge={e}
            source={source}
            target={target}
            siblingIndex={sib?.index ?? 0}
            siblingCount={sib?.count ?? 1}
            selected={selected.has(e.id)}
            hovered={hoveredId === e.id}
            highlighted={highlighted.has(e.id)}
          />
        );
      })}
    </g>
  );
});

const NodesLayer = memo(function NodesLayer() {
  const nodes = useNodes();
  const selection = useUi((s) => s.selection);
  const hoveredId = useUi((s) => s.hoveredId);
  const editingId = useUi((s) => s.editingId);
  const highlightIds = useUi((s) => s.highlightIds);
  const selected = useMemo(() => new Set(selection), [selection]);
  const highlighted = useMemo(() => new Set(highlightIds), [highlightIds]);
  return (
    <g className="canvas-nodes">
      {nodes.map((n) => (
        // NodeShape는 memo라서 node 참조와 아래 원시값이 그대로면 다시 그리지 않는다
        <NodeShape
          key={n.id}
          node={n}
          selected={selected.has(n.id)}
          hovered={hoveredId === n.id}
          editing={editingId === n.id}
          highlighted={highlighted.has(n.id)}
        />
      ))}
    </g>
  );
});

export function Canvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  useCanvasSize(rootRef);
  useWheelZoom(rootRef);
  useBroadcastCursor(rootRef);
  useInitialFit();
  useSpaceKey();
  const handlers = usePointerInteractions(rootRef);
  const cursor = useCanvasCursor();

  return (
    <div ref={rootRef} className="canvas-root" data-cursor={cursor.kind} style={{ cursor: cursor.cursor }}>
      <svg data-testid="canvas-svg" className="canvas-svg" width="100%" height="100%" {...handlers}>
        <Grid />
        <World>
          <EdgesLayer />
          <NodesLayer />
          <RemoteSelections />
          <ConnectDraftLayer />
          <SelectionLayer />
          <EdgeEndsLayer />
          <GuidesLayer />
          <MarqueeLayer />
          <PlacePreview />
        </World>
      </svg>
      <RemoteCursors />
      <TextEditor />
      <ConnectReason />
      <EmptyHint />
    </div>
  );
}
