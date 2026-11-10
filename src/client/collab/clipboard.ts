/**
 * 복사, 잘라내기, 붙여넣기, 복제. [담당: shortcuts 에이전트]
 *
 * 시스템 클립보드에는 `{ type: 'chen-erd/clip', nodes, edges }` JSON을 text/plain으로 넣는다.
 * 같은 형식이면 다른 방, 다른 탭에서 복사한 것도 붙여넣을 수 있다.
 * 우클릭 메뉴의 붙여넣기는 권한 창을 띄우지 않으려고 모듈 안에 둔 마지막 복사본을 쓴다.
 */
import { rectsIntersect, unionBounds } from '../../shared/geometry';
import type { ErdEdge, ErdNode, KeyType, NodeKind, Point, Rect, SpecType } from '../../shared/types';
import { visibleWorldRect } from '../canvas/coords';
import { ui } from '../state/ui';
import { addEdges, addNodes, deleteElements, getEdgesMap, getNodesMap, newId, transact } from './docOps';
import type { Room } from './room';

export const CLIP_TYPE = 'chen-erd/clip';

export interface Clip {
  type: typeof CLIP_TYPE;
  nodes: ErdNode[];
  edges: ErdEdge[];
}

/** 붙여넣을 자리. at = 묶음의 중심이 올 월드 좌표, offset = 원래 위치에서 옮길 거리 */
export type ClipPlacement = { at: Point } | { offset: Point };

/** 한 번 붙여넣을 때마다 비껴 놓는 거리 */
export const PASTE_STEP = 20;

// ───────────────────────── 순수 함수 ─────────────────────────

/** 선택된 노드와, 양 끝이 모두 선택된 엣지만 골라 낸다. 노드가 하나도 없으면 null */
export function clipFromSelection(nodes: ErdNode[], edges: ErdEdge[], selection: Iterable<string>): Clip | null {
  const selected = new Set(selection);
  const pickedNodes = nodes.filter((n) => selected.has(n.id));
  if (pickedNodes.length === 0) return null;
  const nodeIds = new Set(pickedNodes.map((n) => n.id));
  // 선택한 노드 사이의 선은 따로 고르지 않아도 따라온다(묶음을 복사하면 연결이 유지되어야 한다)
  const pickedEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return { type: CLIP_TYPE, nodes: pickedNodes.map((n) => ({ ...n })), edges: pickedEdges.map((e) => ({ ...e })) };
}

/** 선택을 클립보드용 JSON 문자열로 만든다. 복사할 것이 없으면 null */
export function serializeSelection(nodes: ErdNode[], edges: ErdEdge[], selection: Iterable<string>): string | null {
  const clip = clipFromSelection(nodes, edges, selection);
  return clip ? JSON.stringify(clip) : null;
}

const NODE_KINDS: NodeKind[] = ['entity', 'relationship', 'attribute', 'spec', 'note'];
const KEY_TYPES: KeyType[] = ['none', 'key', 'partial'];
const SPEC_TYPES: SpecType[] = ['d', 'o'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 클립보드에서 온 값은 믿을 수 없으므로 아는 필드만 골라 담는다. 형식이 틀리면 null */
function sanitizeNode(raw: unknown): ErdNode | null {
  if (!isRecord(raw)) return null;
  const { id, kind, x, y, w, h, text } = raw;
  if (typeof id !== 'string' || id === '') return null;
  if (!NODE_KINDS.includes(kind as NodeKind)) return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) return null;
  if (w <= 0 || h <= 0) return null;
  const node: ErdNode = { id, kind: kind as NodeKind, x, y, w, h, text: typeof text === 'string' ? text : '' };
  if (raw.weak === true) node.weak = true;
  if (raw.identifying === true) node.identifying = true;
  if (raw.multivalued === true) node.multivalued = true;
  if (raw.derived === true) node.derived = true;
  if (KEY_TYPES.includes(raw.keyType as KeyType)) node.keyType = raw.keyType as KeyType;
  if (SPEC_TYPES.includes(raw.specType as SpecType)) node.specType = raw.specType as SpecType;
  return node;
}

function sanitizeEdge(raw: unknown): ErdEdge | null {
  if (!isRecord(raw)) return null;
  const { id, source, target } = raw;
  if (typeof id !== 'string' || typeof source !== 'string' || typeof target !== 'string') return null;
  const edge: ErdEdge = {
    id,
    source,
    target,
    double: raw.double === true,
    label: typeof raw.label === 'string' ? raw.label : '',
    role: typeof raw.role === 'string' ? raw.role : '',
  };
  const isSide = (v: unknown): v is NonNullable<ErdEdge['sourceSide']> => v === 'top' || v === 'right' || v === 'bottom' || v === 'left';
  if (isSide(raw.sourceSide)) edge.sourceSide = raw.sourceSide;
  if (isSide(raw.targetSide)) edge.targetSide = raw.targetSide;
  if (raw.shape === 'straight' || raw.shape === 'elbow') edge.shape = raw.shape;
  return edge;
}

/** 클립보드 글자를 해석한다. 이 도구에서 복사한 것이 아니면 null */
export function parseClip(text: string | null | undefined): Clip | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes(CLIP_TYPE)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.type !== CLIP_TYPE || !Array.isArray(raw.nodes)) return null;

  const nodes: ErdNode[] = [];
  const nodeIds = new Set<string>();
  for (const item of raw.nodes) {
    const node = sanitizeNode(item);
    if (!node || nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    nodes.push(node);
  }
  if (nodes.length === 0) return null;

  const edges: ErdEdge[] = [];
  for (const item of Array.isArray(raw.edges) ? raw.edges : []) {
    const edge = sanitizeEdge(item);
    if (edge && nodeIds.has(edge.source) && nodeIds.has(edge.target)) edges.push(edge);
  }
  return { type: CLIP_TYPE, nodes, edges };
}

/** 묶음 전체를 감싸는 사각형 */
export function clipBounds(clip: Pick<Clip, 'nodes'>): Rect | null {
  return unionBounds(clip.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
}

/**
 * 클립을 문서에 넣을 수 있는 새 요소로 바꾼다.
 * 모든 요소에 새 id를 주고, 엣지의 양 끝을 새 노드 id로 다시 잇고, 위치를 옮긴다.
 */
export function instantiateClip(
  clip: Pick<Clip, 'nodes' | 'edges'>,
  placement: ClipPlacement,
  makeId: () => string = newId,
): { nodes: ErdNode[]; edges: ErdEdge[] } {
  let dx = 0;
  let dy = 0;
  if ('at' in placement) {
    const b = clipBounds(clip);
    if (b) {
      dx = Math.round(placement.at.x - (b.x + b.w / 2));
      dy = Math.round(placement.at.y - (b.y + b.h / 2));
    }
  } else {
    dx = placement.offset.x;
    dy = placement.offset.y;
  }

  const idMap = new Map<string, string>();
  const nodes = clip.nodes.map((n) => {
    const id = makeId();
    idMap.set(n.id, id);
    return { ...n, id, x: n.x + dx, y: n.y + dy };
  });
  const edges: ErdEdge[] = [];
  for (const e of clip.edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) continue;
    edges.push({ ...e, id: makeId(), source, target });
  }
  return { nodes, edges };
}

// ───────────────────────── 모듈 상태 ─────────────────────────

/** 마지막으로 복사한 것(우클릭 메뉴의 붙여넣기용) */
let memoryText: string | null = null;
/** 연달아 붙여넣을 때 계속 비껴 놓기 위한 기록 */
let pasteSeriesText: string | null = null;
let pasteSeriesCount = 0;

function remember(text: string, firstPasteInPlace: boolean): void {
  memoryText = text;
  pasteSeriesText = text;
  // 잘라낸 것은 원본이 없으니 첫 붙여넣기를 제자리에 놓는다
  pasteSeriesCount = firstPasteInPlace ? -1 : 0;
}

/** 테스트에서 모듈 상태를 비운다. */
export function resetClipboardForTest(): void {
  memoryText = null;
  pasteSeriesText = null;
  pasteSeriesCount = 0;
}

function writeSystemClipboard(text: string): void {
  // 메뉴 클릭처럼 사용자 동작 안에서는 권한 창 없이 쓸 수 있다. 실패해도 모듈 안 복사본으로 붙여넣을 수 있다.
  try {
    void navigator.clipboard?.writeText(text).catch(() => {});
  } catch {
    // 클립보드 API가 없는 환경
  }
}

// ───────────────────────── 방에 적용 ─────────────────────────

function currentClip(room: Room): Clip | null {
  return clipFromSelection(room.nodes.getSnapshot(), room.edges.getSnapshot(), ui().selection);
}

/**
 * 선택을 직렬화해 모듈 안에 기억하고 그 글자를 돌려준다. 시스템 클립보드는 건드리지 않는다.
 * copy DOM 이벤트 처리기가 돌려받은 글자를 `clipboardData`에 직접 넣는다.
 */
export function copySelectionText(room: Room): string | null {
  const clip = currentClip(room);
  if (!clip) return null;
  const text = JSON.stringify(clip);
  remember(text, false);
  return text;
}

/** copySelectionText와 같되 복사한 것을 문서에서 지운다(cut DOM 이벤트용). */
export function cutSelectionText(room: Room): string | null {
  const clip = currentClip(room);
  if (!clip) return null;
  const text = JSON.stringify(clip);
  remember(text, true);
  // 클립에 담긴 것만 지운다. 담기지 않은 선(한쪽 끝만 선택된 선)은 노드가 지워질 때 함께 사라진다.
  const removed = new Set([...clip.nodes.map((n) => n.id), ...clip.edges.map((e) => e.id)]);
  room.undo.stopCapturing();
  deleteElements(room.doc, [...removed]);
  ui().setSelection(ui().selection.filter((id) => !removed.has(id) && room.edges.has(id)));
  return text;
}

/** 선택된 노드와 그 사이의 엣지를 복사한다. 복사한 것이 있으면 true */
export function copySelection(room: Room): boolean {
  const text = copySelectionText(room);
  if (!text) return false;
  writeSystemClipboard(text);
  return true;
}

export function cutSelection(room: Room): boolean {
  const text = cutSelectionText(room);
  if (!text) return false;
  writeSystemClipboard(text);
  return true;
}

/** 새 요소를 실행 취소 한 단계로 문서에 넣고 선택한다. */
function insertAndSelect(room: Room, created: { nodes: ErdNode[]; edges: ErdEdge[] }): void {
  const nodesMap = getNodesMap(room.doc);
  const edgesMap = getEdgesMap(room.doc);
  // 앞선 편집과 한 단계로 합쳐지지 않게 끊는다
  room.undo.stopCapturing();
  transact(room.doc, () => {
    // 이미 있는 id는 덮어쓰지 않는다(새로 만든 id라 사실상 일어나지 않는다)
    addNodes(room.doc, created.nodes.filter((n) => !nodesMap.has(n.id)));
    addEdges(room.doc, created.edges.filter((e) => !edgesMap.has(e.id)));
  });
  ui().setSelection([...created.nodes.map((n) => n.id), ...created.edges.map((e) => e.id)]);
}

/**
 * 클립보드 글자를 붙여넣는다(paste DOM 이벤트용). 이 도구의 형식이 아니면 false.
 * at이 있으면 묶음의 중심이 at에 오고, 없으면 원래 위치에서 비껴 놓는다. 같은 내용을 연달아 붙이면 계속 비껴 간다.
 */
export function pasteText(room: Room, text: string | null | undefined, at?: Point): boolean {
  const clip = parseClip(text);
  if (!clip || !text) return false;
  // 다른 방이나 다른 탭에서 복사해 온 것도 이후 우클릭 메뉴에서 붙여넣을 수 있게 기억한다
  memoryText = text;

  let placement: ClipPlacement;
  if (at) {
    placement = { at };
  } else {
    if (pasteSeriesText !== text) {
      pasteSeriesText = text;
      pasteSeriesCount = 0;
    }
    pasteSeriesCount += 1;
    const d = PASTE_STEP * pasteSeriesCount;
    placement = { offset: { x: d, y: d } };

    // 놓일 자리가 화면 밖이면(다른 방에서 복사했거나 화면을 옮긴 경우) 화면 가운데에 놓는다
    const bounds = clipBounds(clip);
    const { viewport, canvasSize } = ui();
    if (bounds && canvasSize.w > 0 && canvasSize.h > 0) {
      const visible = visibleWorldRect(viewport, canvasSize);
      if (!rectsIntersect({ ...bounds, x: bounds.x + d, y: bounds.y + d }, visible)) {
        // 여기서도 연달아 붙이면 겹치지 않게 조금씩 비낀다
        const shift = PASTE_STEP * Math.max(0, pasteSeriesCount - 1);
        placement = { at: { x: visible.x + visible.w / 2 + shift, y: visible.y + visible.h / 2 + shift } };
      }
    }
  }

  insertAndSelect(room, instantiateClip(clip, placement));
  return true;
}

/** 붙여넣는다. at(월드 좌표)을 주면 그 위치가 중심이 되고, 없으면 원래 위치에서 조금 비껴 놓는다. 붙여넣은 요소를 선택한다. */
export function paste(room: Room, at?: Point): boolean {
  return pasteText(room, memoryText, at);
}

/** 선택된 것을 바로 옆에 복제하고 복제본을 선택한다. */
export function duplicateSelection(room: Room): boolean {
  const clip = currentClip(room);
  if (!clip) return false;
  insertAndSelect(room, instantiateClip(clip, { offset: { x: PASTE_STEP, y: PASTE_STEP } }));
  return true;
}

/** 붙여넣을 내용이 있는지 */
export function hasClipboard(): boolean {
  return memoryText !== null;
}
