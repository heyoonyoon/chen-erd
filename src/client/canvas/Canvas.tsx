/**
 * 캔버스. SVG로 다이어그램을 그리고 마우스 조작(선택, 이동, 크기 조절, 연결, 도형 놓기, 화면 이동)을 처리한다.
 * [담당: canvas 에이전트]
 *
 * 조작 처리는 interaction/ 아래에 있다. 이 파일은 층을 쌓고 부품을 조립한다.
 * 다시 그리기를 줄이기 위해 층마다 필요한 상태만 구독하고, 노드/엣지 하나하나는 memo로 감싼다.
 */
import { memo, useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { computeEdgeGeometry, siblingInfo } from '../../shared/geometry';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { useEdges, useNodeMap, useNodes, useRoom } from '../collab/hooks';
import { RemoteCursors, RemoteSelections, useBroadcastCursor } from '../presence/Presence';
import { useErdHighlight } from '../state/highlight';
import { useUi } from '../state/ui';
import { viewportTransform } from './coords';
import { EdgeShape } from './EdgeShape';
import { ConnectDraftLayer, ConnectReason, EdgeEndsLayer, EmptyHint, MarqueeLayer, PlacePreview, SelectionLayer } from './interaction/Overlays';
import { useCanvasCursor, useCanvasSize, useInitialFit, useSpaceKey } from './interaction/useCanvasSetup';
import { usePointerInteractions } from './interaction/usePointerInteractions';
import { NodeShape } from './NodeShape';
import { useErdReveal } from './reveal';
import { isEditableElement } from './shortcuts';
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
  /** 같은 두 도형을 잇는 선의 수. 재귀 관계의 기본 모양을 정한다 */
  pairCount: number;
  selected: boolean;
  hovered: boolean;
  highlighted: boolean;
  related: boolean;
  dimmed: boolean;
}

/** 다른 pane이 건 강조(state/highlight.ts). 강조 대상 id 집합과, 강조가 걸려 있는지 */
function useRelated(): { related: ReadonlySet<string>; active: boolean } {
  const ids = useErdHighlight((s) => s.ids);
  return useMemo(() => ({ related: new Set(ids), active: ids.length > 0 }), [ids]);
}

/** 엣지 좌표는 엣지나 양 끝 노드의 참조가 바뀔 때만 다시 계산한다. */
const EdgeView = memo(function EdgeView({ edge, source, target, siblingIndex, siblingCount, pairCount, selected, hovered, highlighted, related, dimmed }: EdgeViewProps) {
  const geometry = useMemo(
    () => computeEdgeGeometry(edge, source, target, siblingIndex, siblingCount, pairCount),
    [edge, source, target, siblingIndex, siblingCount, pairCount],
  );
  return (
    <EdgeShape edge={edge} geometry={geometry} selected={selected} hovered={hovered} highlighted={highlighted} related={related} dimmed={dimmed} />
  );
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
  const { related, active } = useRelated();
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
            pairCount={sib?.pair ?? 1}
            selected={selected.has(e.id)}
            hovered={hoveredId === e.id}
            highlighted={highlighted.has(e.id)}
            related={related.has(e.id)}
            dimmed={active && !related.has(e.id)}
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
  const { related, active } = useRelated();
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
          related={related.has(n.id)}
          dimmed={active && !related.has(n.id)}
        />
      ))}
    </g>
  );
});

/**
 * 캔버스. 놓인 컨테이너를 꽉 채우고(.canvas-root가 position:absolute; inset:0), 그 크기가 언제 바뀌어도 따라간다.
 * 루트는 포커스를 받을 수 있다(tabIndex=-1). 캔버스를 누르면 포커스가 여기로 와서,
 * 다른 pane에 있던 포커스가 빠지고 캔버스 단축키가 바로 듣는다.
 */
export function Canvas() {
  const room = useRoom();
  const rootRef = useRef<HTMLDivElement>(null);
  useCanvasSize(rootRef);
  useWheelZoom(rootRef);
  useBroadcastCursor(rootRef);
  useInitialFit();
  useSpaceKey();
  useErdReveal(room);
  const handlers = usePointerInteractions(rootRef);
  const cursor = useCanvasCursor();
  const hasRelated = useErdHighlight((s) => s.ids.length > 0);

  // 캔버스를 누르면 포커스를 캔버스로 가져온다(글자 편집창을 누른 경우는 빼고)
  const takeFocus = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || isEditableElement(e.target)) return;
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    root.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={rootRef}
      className="canvas-root"
      data-cursor={cursor.kind}
      data-related={hasRelated || undefined}
      style={{ cursor: cursor.cursor }}
      tabIndex={-1}
      onPointerDownCapture={takeFocus}
    >
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
