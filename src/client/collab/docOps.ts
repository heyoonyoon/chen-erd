/**
 * Yjs 문서를 읽고 고치는 함수 모음. 문서 구조를 아는 곳은 이 파일과 shared/ydoc.ts뿐이다.
 * (CORE 파일)
 *
 * 문서 구조
 *   doc.getMap('nodes') : Y.Map<nodeId, Y.Map>  각 노드의 필드가 Y.Map의 키로 들어간다
 *   doc.getMap('edges') : Y.Map<edgeId, Y.Map>
 *   doc.getMap('meta')  : { title: string }
 *
 * 로컬에서 일으킨 변경은 모두 LOCAL_ORIGIN으로 transact한다(실행 취소 대상).
 */
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { NODE_PRESETS, type ErdEdge, type ErdNode, type Point, type PresetId } from '../../shared/types';
import { applyPatch, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode, toYMap } from '../../shared/ydoc';
import { presetText } from '../i18n';
import { fitNodeSize } from '../text/measure';

// 문서를 읽고 쓰는 순수 함수는 서버(API)도 쓰므로 shared/ydoc.ts에 있다. 화면 쪽은 지금까지처럼 이 파일에서 가져다 쓴다.
export {
  getEdges,
  getEdgesMap,
  getMetaMap,
  getNodes,
  getNodesMap,
  getTitle,
  readEdge,
  readNode,
  type YElementMap,
} from '../../shared/ydoc';

export const LOCAL_ORIGIN = 'local';

export function newId(): string {
  return nanoid(10);
}

export function getNode(doc: Y.Doc, id: string): ErdNode | null {
  const m = getNodesMap(doc).get(id);
  return m ? readNode(m) : null;
}
export function getEdge(doc: Y.Doc, id: string): ErdEdge | null {
  const m = getEdgesMap(doc).get(id);
  return m ? readEdge(m) : null;
}

/** 여러 변경을 실행 취소 한 단계로 묶는다. */
export function transact(doc: Y.Doc, fn: () => void): void {
  doc.transact(fn, LOCAL_ORIGIN);
}

export function addNodes(doc: Y.Doc, nodes: ErdNode[]): void {
  transact(doc, () => {
    const map = getNodesMap(doc);
    for (const n of nodes) map.set(n.id, toYMap(n) as Y.Map<unknown>);
  });
}
export function addNode(doc: Y.Doc, node: ErdNode): void {
  addNodes(doc, [node]);
}

export function addEdges(doc: Y.Doc, edges: ErdEdge[]): void {
  transact(doc, () => {
    const map = getEdgesMap(doc);
    for (const e of edges) map.set(e.id, toYMap(e) as Y.Map<unknown>);
  });
}
export function addEdge(doc: Y.Doc, edge: ErdEdge): void {
  addEdges(doc, [edge]);
}

export type NodePatch = Partial<Omit<ErdNode, 'id'>>;
export type EdgePatch = Partial<Omit<ErdEdge, 'id'>>;

/** 값이 undefined인 키는 지운다(플래그 끄기). 없는 id는 무시한다. */
export function updateNodes(doc: Y.Doc, patches: Array<{ id: string; patch: NodePatch }>): void {
  transact(doc, () => {
    const map = getNodesMap(doc);
    for (const { id, patch } of patches) {
      const m = map.get(id);
      if (m) applyPatch(m, patch);
    }
  });
}
export function updateNode(doc: Y.Doc, id: string, patch: NodePatch): void {
  updateNodes(doc, [{ id, patch }]);
}

export function updateEdges(doc: Y.Doc, patches: Array<{ id: string; patch: EdgePatch }>): void {
  transact(doc, () => {
    const map = getEdgesMap(doc);
    for (const { id, patch } of patches) {
      const m = map.get(id);
      if (m) applyPatch(m, patch);
    }
  });
}
export function updateEdge(doc: Y.Doc, id: string, patch: EdgePatch): void {
  updateEdges(doc, [{ id, patch }]);
}

/** 노드와 엣지 id를 섞어서 받는다. 노드를 지우면 그 노드에 붙은 엣지도 함께 지운다. */
export function deleteElements(doc: Y.Doc, ids: string[]): void {
  if (ids.length === 0) return;
  transact(doc, () => {
    const nodes = getNodesMap(doc);
    const edges = getEdgesMap(doc);
    const removedNodes = new Set<string>();
    for (const id of ids) {
      if (nodes.has(id)) {
        nodes.delete(id);
        removedNodes.add(id);
      } else if (edges.has(id)) {
        edges.delete(id);
      }
    }
    if (removedNodes.size > 0) {
      for (const [eid, m] of Array.from(edges.entries())) {
        if (removedNodes.has(String(m.get('source'))) || removedNodes.has(String(m.get('target')))) {
          edges.delete(eid);
        }
      }
    }
  });
}

/** 문서를 통째로 바꾼다(JSON 불러오기의 '덮어쓰기'). */
export function replaceAll(doc: Y.Doc, nodes: ErdNode[], edges: ErdEdge[]): void {
  transact(doc, () => {
    const nm = getNodesMap(doc);
    const em = getEdgesMap(doc);
    for (const k of Array.from(nm.keys())) nm.delete(k);
    for (const k of Array.from(em.keys())) em.delete(k);
    for (const n of nodes) nm.set(n.id, toYMap(n) as Y.Map<unknown>);
    for (const e of edges) em.set(e.id, toYMap(e) as Y.Map<unknown>);
  });
}

export function setTitle(doc: Y.Doc, title: string): void {
  transact(doc, () => getMetaMap(doc).set('title', title));
}

// ───────────── 순수 생성 함수(문서를 건드리지 않는다) ─────────────

/**
 * 프리셋으로 새 도형을 만들 때의 글자와 크기.
 * 글자를 주지 않으면 만드는 사람의 현재 언어로 된 기본 글자를 넣는다(문서에 들어간 뒤에는 번역하지 않는다).
 * 크기는 프리셋 기본값이고, 언어에 따라 기본 글자가 길어 넘치면 글자에 맞게 키운다.
 */
export function presetPlacement(presetId: PresetId, text?: string): { text: string; w: number; h: number } {
  const p = NODE_PRESETS[presetId];
  const label = text ?? presetText(presetId);
  const fit = fitNodeSize({ kind: p.kind, ...p.props }, label);
  return { text: label, w: Math.max(p.w, fit.w), h: Math.max(p.h, fit.h) };
}

/** 프리셋 도형을 center가 중심이 되도록 만든다. */
export function createNodeFromPreset(presetId: PresetId, center: Point, text?: string): ErdNode {
  const p = NODE_PRESETS[presetId];
  const placed = presetPlacement(presetId, text);
  return {
    id: newId(),
    kind: p.kind,
    x: Math.round(center.x - placed.w / 2),
    y: Math.round(center.y - placed.h / 2),
    w: placed.w,
    h: placed.h,
    text: placed.text,
    ...p.props,
  };
}

export function createEdge(source: string, target: string, props: Partial<Omit<ErdEdge, 'id' | 'source' | 'target'>> = {}): ErdEdge {
  return { id: newId(), source, target, double: false, label: '', role: '', ...props };
}
