/**
 * 인스펙터의 계산 부분(순수 함수). 문서나 DOM을 건드리지 않고 패치만 만든다. [담당: inspector 에이전트]
 */
import {
  MIN_NODE_SIZE,
  NODE_PRESETS,
  presetOf,
  type EdgeShapeKind,
  type ErdEdge,
  type ErdNode,
  type KeyType,
  type PresetId,
} from '../../shared/types';
import { edgeShapeOf } from '../../shared/geometry';
import type { NodePatch } from '../collab/docOps';

export interface NodePatchEntry {
  id: string;
  patch: NodePatch;
}

type Box = Pick<ErdNode, 'id' | 'x' | 'y' | 'w' | 'h'>;

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'h' | 'v';

/** 직접 입력으로 넣을 수 있는 가장 큰 크기(실수로 0을 여러 개 친 경우를 막는다) */
export const MAX_NODE_SIZE = 4000;

function bounds(nodes: Box[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const n of nodes) {
    left = Math.min(left, n.x);
    top = Math.min(top, n.y);
    right = Math.max(right, n.x + n.w);
    bottom = Math.max(bottom, n.y + n.h);
  }
  return { left, top, right, bottom };
}

/**
 * 선택한 도형들을 전체 범위의 한쪽 변이나 가운데에 맞춘다.
 * 실제로 움직여야 하는 도형의 패치만 돌려준다.
 */
export function alignNodes(nodes: Box[], mode: AlignMode): NodePatchEntry[] {
  if (nodes.length < 2) return [];
  const b = bounds(nodes);
  const out: NodePatchEntry[] = [];
  for (const n of nodes) {
    let x = n.x;
    let y = n.y;
    switch (mode) {
      case 'left':
        x = b.left;
        break;
      case 'hcenter':
        x = Math.round((b.left + b.right) / 2 - n.w / 2);
        break;
      case 'right':
        x = b.right - n.w;
        break;
      case 'top':
        y = b.top;
        break;
      case 'vcenter':
        y = Math.round((b.top + b.bottom) / 2 - n.h / 2);
        break;
      case 'bottom':
        y = b.bottom - n.h;
        break;
    }
    if (x !== n.x) out.push({ id: n.id, patch: { x } });
    else if (y !== n.y) out.push({ id: n.id, patch: { y } });
  }
  return out;
}

/**
 * 도형 사이의 빈 간격을 같게 만든다. 전체 범위(가장 왼쪽 변 ~ 가장 오른쪽 변)는 그대로 두고
 * 가운데 순서대로 다시 놓는다. axis 'h'는 가로 방향(x), 'v'는 세로 방향(y).
 */
export function distributeNodes(nodes: Box[], axis: DistributeAxis): NodePatchEntry[] {
  if (nodes.length < 3) return [];
  const start = (n: Box) => (axis === 'h' ? n.x : n.y);
  const size = (n: Box) => (axis === 'h' ? n.w : n.h);
  const sorted = [...nodes].sort((a, b) => start(a) + size(a) / 2 - (start(b) + size(b) / 2) || start(a) - start(b));
  const b = bounds(nodes);
  const from = axis === 'h' ? b.left : b.top;
  const to = axis === 'h' ? b.right : b.bottom;
  const total = sorted.reduce((sum, n) => sum + size(n), 0);
  const gap = (to - from - total) / (sorted.length - 1);
  const out: NodePatchEntry[] = [];
  let pos = from;
  for (const n of sorted) {
    const next = Math.round(pos);
    if (next !== start(n)) out.push({ id: n.id, patch: axis === 'h' ? { x: next } : { y: next } });
    pos += size(n) + gap;
  }
  return out;
}

/**
 * 도형을 다른 프리셋으로 바꾸는 패치. 종류 전용 플래그를 모두 지운 뒤 프리셋의 플래그만 켠다.
 * 글자는 건드리지 않고, 크기는 중심을 유지한 채 size로 맞춘다.
 */
export function presetChangePatch(node: ErdNode, presetId: PresetId, size: { w: number; h: number }): NodePatch {
  const preset = NODE_PRESETS[presetId];
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  return {
    kind: preset.kind,
    weak: undefined,
    identifying: undefined,
    multivalued: undefined,
    derived: undefined,
    keyType: undefined,
    specType: undefined,
    ...preset.props,
    x: Math.round(cx - size.w / 2),
    y: Math.round(cy - size.h / 2),
    w: size.w,
    h: size.h,
  };
}

/** 중심을 유지한 채 크기를 바꾸는 패치. 최소 크기보다 작아지지 않는다. 바뀌는 것이 없으면 null. */
export function resizePatch(node: Pick<ErdNode, 'x' | 'y' | 'w' | 'h'>, size: { w?: number; h?: number }): NodePatch | null {
  const clamp = (v: number | undefined, min: number, cur: number) =>
    v === undefined || !Number.isFinite(v) ? cur : Math.min(MAX_NODE_SIZE, Math.max(min, Math.round(v)));
  const w = clamp(size.w, MIN_NODE_SIZE.w, node.w);
  const h = clamp(size.h, MIN_NODE_SIZE.h, node.h);
  if (w === node.w && h === node.h) return null;
  return {
    x: Math.round(node.x + node.w / 2 - w / 2),
    y: Math.round(node.y + node.h / 2 - h / 2),
    w,
    h,
  };
}

/** 숫자 입력 칸의 글자를 수로 바꾼다. 비었거나 수가 아니면 null. */
export function parseSize(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** 입력한 글자를 문서에 넣을 형태로 다듬는다(줄바꿈 통일, 끝의 빈 줄 제거). */
export function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

/** 도형을 한 줄로 부르는 이름. 글자가 비어 있으면 종류 이름. */
export function nodeLabel(node: ErdNode | undefined): string {
  if (!node) return '(없는 도형)';
  const text = node.kind === 'spec' ? '' : node.text.replace(/\s+/g, ' ').trim();
  return text || NODE_PRESETS[presetOf(node)].label;
}

/** 선이 무엇과 무엇을 잇는지. 인스펙터가 보여 줄 항목과 안내 문구를 고르는 데 쓴다. */
export type EdgeNature = 'entity-relationship' | 'entity-spec' | 'other';

export function edgeNature(source: ErdNode | undefined, target: ErdNode | undefined): EdgeNature {
  if (!source || !target) return 'other';
  const kinds = new Set([source.kind, target.kind]);
  if (kinds.size !== 2 || !kinds.has('entity')) return 'other';
  if (kinds.has('relationship')) return 'entity-relationship';
  if (kinds.has('spec')) return 'entity-spec';
  return 'other';
}

/**
 * 모양을 고르지 않은 선의 기본 모양. 재귀 관계(같은 엔티티와 관계 사이에 선이 둘 이상)의 선은 꺾은선, 그 밖은 직선.
 * pairCount는 같은 두 도형을 잇는 선의 수(geometry.ts의 siblingInfo가 주는 pair).
 */
export function defaultEdgeShape(source: ErdNode | undefined, target: ErdNode | undefined, pairCount = 1): EdgeShapeKind {
  return edgeShapeOf({}, source, target, pairCount);
}

/** 실제로 그려지는 선 모양. 직접 고른 모양이 있으면 그 모양, 없으면 기본 모양. */
export function resolveEdgeShape(
  edge: Pick<ErdEdge, 'shape'>,
  source?: ErdNode,
  target?: ErdNode,
  pairCount = 1,
): EdgeShapeKind {
  return edgeShapeOf(edge, source, target, pairCount);
}

/** 여러 값이 모두 같으면 그 값, 섞여 있거나 비어 있으면 null. */
export function commonValue<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? first : null;
}

/** 저장된 keyType(없으면 undefined)을 선택 칸의 값으로 */
export function keyTypeOf(node: Pick<ErdNode, 'keyType'>): KeyType {
  return node.keyType === 'key' || node.keyType === 'partial' ? node.keyType : 'none';
}
