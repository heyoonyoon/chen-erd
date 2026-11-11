/**
 * Yjs 문서를 읽고 쓰는 순수 함수. 브라우저와 서버(API)가 같은 문서 구조를 같은 코드로 다룬다.
 *
 * 문서 구조
 *   doc.getMap('nodes') : Y.Map<nodeId, Y.Map>  각 노드의 필드가 Y.Map의 키로 들어간다
 *   doc.getMap('edges') : Y.Map<edgeId, Y.Map>
 *   doc.getMap('meta')  : { title: string }
 *
 * 화면 쪽의 편집 함수(실행 취소 묶음, 프리셋 등)는 src/client/collab/docOps.ts에 있다.
 */
import * as Y from 'yjs';
import type { DiagramChange } from './model/types';
import type { ErdEdge, ErdNode, Side } from './types';

export type YElementMap = Y.Map<Y.Map<unknown>>;

export function getNodesMap(doc: Y.Doc): YElementMap {
  return doc.getMap('nodes') as YElementMap;
}
export function getEdgesMap(doc: Y.Doc): YElementMap {
  return doc.getMap('edges') as YElementMap;
}
export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

export function readNode(m: Y.Map<unknown>): ErdNode {
  const o = m.toJSON() as Partial<ErdNode>;
  return {
    ...o,
    id: String(o.id ?? ''),
    kind: o.kind ?? 'entity',
    x: Number(o.x ?? 0),
    y: Number(o.y ?? 0),
    w: Number(o.w ?? 100),
    h: Number(o.h ?? 50),
    text: String(o.text ?? ''),
  } as ErdNode;
}

export function readEdge(m: Y.Map<unknown>): ErdEdge {
  const o = m.toJSON() as Partial<ErdEdge>;
  const edge: ErdEdge = {
    id: String(o.id ?? ''),
    source: String(o.source ?? ''),
    target: String(o.target ?? ''),
    double: Boolean(o.double),
    label: String(o.label ?? ''),
    role: String(o.role ?? ''),
  };
  if (isSide(o.sourceSide)) edge.sourceSide = o.sourceSide;
  if (isSide(o.targetSide)) edge.targetSide = o.targetSide;
  if (o.shape === 'straight' || o.shape === 'elbow') edge.shape = o.shape;
  return edge;
}

function isSide(v: unknown): v is Side {
  return v === 'top' || v === 'right' || v === 'bottom' || v === 'left';
}

export function getNodes(doc: Y.Doc): ErdNode[] {
  return Array.from(getNodesMap(doc).values(), readNode);
}
export function getEdges(doc: Y.Doc): ErdEdge[] {
  return Array.from(getEdgesMap(doc).values(), readEdge);
}

export function getTitle(doc: Y.Doc): string {
  const t = getMetaMap(doc).get('title');
  return typeof t === 'string' ? t : '';
}

/** 객체를 Y.Map으로 옮긴다. 값이 undefined인 키는 넣지 않는다. */
export function toYMap(obj: object): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) m.set(k, v);
  }
  return m;
}

/** 값이 undefined인 키는 지우고, 값이 같은 키는 건드리지 않는다. id는 바꾸지 않는다. */
export function applyPatch(m: Y.Map<unknown>, patch: object): void {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id') continue;
    if (v === undefined) {
      if (m.has(k)) m.delete(k);
    } else if (m.get(k) !== v) {
      m.set(k, v);
    }
  }
}

/**
 * 변경 묶음을 트랜잭션 하나로 적용한다(받는 쪽에는 update 하나로 간다).
 * 순서: 선 지우기, 도형 지우기(지운 도형에 아직 붙어 있는 선도 함께), 도형 추가, 도형 고치기, 선 추가, 선 고치기, 제목.
 * 없는 id를 지우거나 고치라는 항목은 무시한다.
 */
export function applyChange(doc: Y.Doc, change: DiagramChange, origin: unknown): void {
  doc.transact(() => {
    const nodes = getNodesMap(doc);
    const edges = getEdgesMap(doc);

    for (const id of change.removeEdgeIds) {
      if (edges.has(id)) edges.delete(id);
    }

    const removedNodes = new Set<string>();
    for (const id of change.removeNodeIds) {
      if (!nodes.has(id)) continue;
      nodes.delete(id);
      removedNodes.add(id);
    }
    if (removedNodes.size > 0) {
      for (const [eid, m] of Array.from(edges.entries())) {
        if (removedNodes.has(String(m.get('source'))) || removedNodes.has(String(m.get('target')))) {
          edges.delete(eid);
        }
      }
    }

    for (const n of change.addNodes) nodes.set(n.id, toYMap(n));
    for (const { id, patch } of change.patchNodes) {
      const m = nodes.get(id);
      if (m) applyPatch(m, patch);
    }

    for (const e of change.addEdges) edges.set(e.id, toYMap(e));
    for (const { id, patch } of change.patchEdges) {
      const m = edges.get(id);
      if (m) applyPatch(m, patch);
    }

    if (change.title !== undefined && getTitle(doc) !== change.title) getMetaMap(doc).set('title', change.title);
  }, origin);
}
