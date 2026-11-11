/**
 * 다이어그램(노드와 엣지)에서 논리 모델을 뽑는다.
 *
 * 모델로 나타낼 수 있는 도형과 선만 "관리 대상"으로 삼고, 나머지(어디에도 붙지 않은 속성, 엔티티가 없는 특수화 원,
 * 표기법에 맞지 않는 선, 이름이 겹치는 두 번째 엔티티)는 빼고 개수만 센다. apply는 관리 대상만 고친다.
 *
 * 순서는 화면 위치로 정해서 같은 다이어그램이면 항상 같은 글이 나온다(노드와 엣지 배열의 순서에 기대지 않는다).
 *   엔티티, 관계, 특수화 원, 메모: 읽는 순서(y, x, id)
 *   속성: 소유자 중심에서 본 방향. 서쪽에서 시작해 시계 방향(서, 북, 동, 남). 자동 배치도 이 순서로 놓는다
 *   참여자: 엔티티의 읽는 순서, 같으면 엣지 id
 */
import { specRoles } from '../rules';
import type { ErdEdge, ErdNode } from '../types';
import { printModel } from './text';
import type { ExtractResult, Model, ModelAttribute, ModelEntity, ModelParticipant, ModelRelationship, ModelSpecialization } from './types';

// ───────────────────────── id가 붙은 모델 ─────────────────────────

export interface BoundAttribute {
  model: ModelAttribute;
  nodeId: string;
  /** 상위(소유자 또는 복합 속성)와 잇는 선 */
  edgeId: string;
  parts: BoundAttribute[];
}

export interface BoundEntity {
  model: ModelEntity;
  nodeId: string;
  attributes: BoundAttribute[];
}

export interface BoundParticipant {
  model: ModelParticipant;
  edgeId: string;
  entityId: string;
}

export interface BoundRelationship {
  model: ModelRelationship;
  nodeId: string;
  participants: BoundParticipant[];
  attributes: BoundAttribute[];
}

export interface BoundSpecialization {
  model: ModelSpecialization;
  nodeId: string;
  parentId: string;
  parentEdgeId: string;
  /** model.children과 같은 순서 */
  children: Array<{ entityId: string; edgeId: string }>;
}

export interface BoundNote {
  text: string;
  nodeId: string;
}

/** 모델과, 모델의 각 요소가 어느 노드와 엣지에서 왔는지 */
export interface BoundModel {
  model: Model;
  entities: BoundEntity[];
  relationships: BoundRelationship[];
  specializations: BoundSpecialization[];
  notes: BoundNote[];
  managedNodeIds: Set<string>;
  managedEdgeIds: Set<string>;
  skipped: number;
}

// ───────────────────────── 순서 ─────────────────────────

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 읽는 순서: 위에서 아래, 왼쪽에서 오른쪽 */
export function readingOrder(a: ErdNode, b: ErdNode): number {
  return a.y - b.y || a.x - b.x || compareId(a.id, b.id);
}

/**
 * 중심에서 (dx, dy)만큼 떨어진 속성의 순서 값. 서쪽이 가장 작고 시계 방향으로 커진다(화면 좌표는 y가 아래로 자란다).
 * 정서쪽은 반올림 한 칸 차이로 처음과 끝이 뒤바뀌지 않게 |dy| ≤ 1이면 처음으로 본다.
 */
export function fanOrderKey(dx: number, dy: number): number {
  if (dx < 0 && Math.abs(dy) <= 1) return -Math.PI;
  return Math.atan2(dy, dx);
}

function fanOrder(center: ErdNode): (a: ErdNode, b: ErdNode) => number {
  const cx = center.x + center.w / 2;
  const cy = center.y + center.h / 2;
  const key = (n: ErdNode) => fanOrderKey(n.x + n.w / 2 - cx, n.y + n.h / 2 - cy);
  const dist = (n: ErdNode) => Math.hypot(n.x + n.w / 2 - cx, n.y + n.h / 2 - cy);
  return (a, b) => key(a) - key(b) || dist(a) - dist(b) || compareId(a.id, b.id);
}

// ───────────────────────── 뽑기 ─────────────────────────

type EdgeClass = 'participant' | 'attribute' | 'part' | 'spec';

/** 모델이 뜻을 아는 선의 종류. 표기법에 없는 조합이면 null */
function classify(s: ErdNode, t: ErdNode): EdgeClass | null {
  const kinds = [s.kind, t.kind].sort().join('+');
  switch (kinds) {
    case 'entity+relationship':
      return 'participant';
    case 'attribute+entity':
    case 'attribute+relationship':
      return 'attribute';
    case 'attribute+attribute':
      return 'part';
    case 'entity+spec':
      return 'spec';
    default:
      return null;
  }
}

interface Link {
  edge: ErdEdge;
  other: ErdNode;
}

function attributeModel(node: ErdNode, parts: BoundAttribute[]): ModelAttribute {
  const model: ModelAttribute = { name: node.text };
  if (node.keyType === 'key' || node.keyType === 'partial') model.key = node.keyType;
  if (node.multivalued) model.multivalued = true;
  if (parts.length > 0) model.parts = parts.map((p) => p.model);
  return model;
}

/** 다이어그램에서 모델을 뽑고, 각 요소의 노드와 엣지 id를 함께 돌려준다(apply가 쓴다) */
export function extractBound(nodes: ErdNode[], edges: ErdEdge[], title?: string): BoundModel {
  const nodeById = new Map<string, ErdNode>();
  for (const n of nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);
  const all = [...nodeById.values()];

  // 뜻이 있는 선만 종류별 인접 목록에 넣는다. 같은 두 도형 사이의 선은 허용 개수까지만(id가 앞선 것부터)
  const links: Record<EdgeClass, Map<string, Link[]>> = { participant: new Map(), attribute: new Map(), part: new Map(), spec: new Map() };
  const pairCount = new Map<string, number>();
  const seenEdge = new Set<string>();
  const sortedEdges = [...edges].sort((a, b) => compareId(a.id, b.id));
  for (const e of sortedEdges) {
    if (seenEdge.has(e.id)) continue;
    seenEdge.add(e.id);
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t || s.id === t.id) continue;
    const cls = classify(s, t);
    if (!cls) continue;
    const pair = s.id < t.id ? `${s.id}\u0000${t.id}` : `${t.id}\u0000${s.id}`;
    const count = pairCount.get(pair) ?? 0;
    if (count >= (cls === 'participant' ? 2 : 1)) continue;
    pairCount.set(pair, count + 1);
    const map = links[cls];
    const push = (from: ErdNode, to: ErdNode) => {
      const list = map.get(from.id);
      if (list) list.push({ edge: e, other: to });
      else map.set(from.id, [{ edge: e, other: to }]);
    };
    push(s, t);
    push(t, s);
  }

  const managedNodeIds = new Set<string>();
  const managedEdgeIds = new Set<string>();

  // 엔티티: 같은 이름은 읽는 순서로 처음 것만 모델에 넣는다(이름으로 가리키므로 둘을 구분할 수 없다)
  const entityNodes: ErdNode[] = [];
  const entityNames = new Set<string>();
  for (const n of all.filter((x) => x.kind === 'entity').sort(readingOrder)) {
    if (entityNames.has(n.text)) continue;
    entityNames.add(n.text);
    entityNodes.push(n);
    managedNodeIds.add(n.id);
  }
  const relationshipNodes = all.filter((x) => x.kind === 'relationship').sort(readingOrder);
  for (const n of relationshipNodes) managedNodeIds.add(n.id);

  // 속성: 먼저 소유자에 직접 붙은 속성을 모두 최상위로 잡고(첫 소유자가 가진다), 그다음 속성끼리의 선을 따라 하위를 모은다
  const owners = [...entityNodes, ...relationshipNodes];
  const claimed = new Set<string>();
  const direct = new Map<string, Link[]>();
  for (const owner of owners) {
    const list: Link[] = [];
    for (const link of links.attribute.get(owner.id) ?? []) {
      if (link.other.kind !== 'attribute' || claimed.has(link.other.id)) continue;
      claimed.add(link.other.id);
      list.push(link);
    }
    direct.set(owner.id, list);
  }
  const subtree = (node: ErdNode, edgeId: string): BoundAttribute => {
    managedNodeIds.add(node.id);
    managedEdgeIds.add(edgeId);
    const children: Link[] = [];
    for (const link of links.part.get(node.id) ?? []) {
      if (claimed.has(link.other.id)) continue;
      claimed.add(link.other.id);
      children.push(link);
    }
    const order = fanOrder(node);
    children.sort((a, b) => order(a.other, b.other));
    const parts = children.map((c) => subtree(c.other, c.edge.id));
    return { model: attributeModel(node, parts), nodeId: node.id, edgeId, parts };
  };
  const attributesOf = (owner: ErdNode): BoundAttribute[] => {
    const order = fanOrder(owner);
    return [...(direct.get(owner.id) ?? [])].sort((a, b) => order(a.other, b.other)).map((l) => subtree(l.other, l.edge.id));
  };

  const entities: BoundEntity[] = entityNodes.map((n) => {
    const attributes = attributesOf(n);
    const model: ModelEntity = { name: n.text, attributes: attributes.map((a) => a.model) };
    if (n.weak) model.weak = true;
    return { model, nodeId: n.id, attributes };
  });

  const relationships: BoundRelationship[] = relationshipNodes.map((n) => {
    const participantLinks = (links.participant.get(n.id) ?? [])
      .filter((l) => managedNodeIds.has(l.other.id))
      .sort((a, b) => readingOrder(a.other, b.other) || compareId(a.edge.id, b.edge.id));
    const participants: BoundParticipant[] = participantLinks.map((l) => {
      managedEdgeIds.add(l.edge.id);
      const model: ModelParticipant = { entity: l.other.text, cardinality: l.edge.label ?? '' };
      if (l.edge.double) model.total = true;
      if (l.edge.role) model.role = l.edge.role;
      return { model, edgeId: l.edge.id, entityId: l.other.id };
    });
    const attributes = attributesOf(n);
    const model: ModelRelationship = { name: n.text, participants: participants.map((p) => p.model), attributes: attributes.map((a) => a.model) };
    if (n.identifying) model.identifying = true;
    return { model, nodeId: n.id, participants, attributes };
  });

  // 특수화: 슈퍼타입과 서브타입은 화면과 같은 규칙(specRoles)으로 가린다
  const specializations: BoundSpecialization[] = [];
  for (const n of all.filter((x) => x.kind === 'spec').sort(readingOrder)) {
    const members = (links.spec.get(n.id) ?? []).filter((l) => managedNodeIds.has(l.other.id));
    if (members.length === 0) continue;
    const roles = specRoles(n, nodeById, members.map((m) => m.edge));
    if (!roles.supertype) continue;
    const edgeOf = (entityId: string) => members.find((m) => m.other.id === entityId)!.edge;
    const parentEdge = edgeOf(roles.supertype.id);
    managedNodeIds.add(n.id);
    for (const m of members) managedEdgeIds.add(m.edge.id);
    const model: ModelSpecialization = { parent: roles.supertype.text, kind: n.specType === 'o' ? 'o' : 'd', children: roles.subtypes.map((s) => s.text) };
    if (parentEdge.double) model.total = true;
    specializations.push({
      model,
      nodeId: n.id,
      parentId: roles.supertype.id,
      parentEdgeId: parentEdge.id,
      children: roles.subtypes.map((s) => ({ entityId: s.id, edgeId: edgeOf(s.id).id })),
    });
  }

  const notes: BoundNote[] = all
    .filter((x) => x.kind === 'note')
    .sort(readingOrder)
    .map((n) => {
      managedNodeIds.add(n.id);
      return { text: n.text, nodeId: n.id };
    });

  // 빠진 것: 관리하지 않는 도형, 그리고 양 끝은 모델에 있는데 선만 빠진 경우
  let skipped = all.length - managedNodeIds.size;
  for (const e of sortedEdges) {
    if (managedEdgeIds.has(e.id)) continue;
    if (managedNodeIds.has(e.source) && managedNodeIds.has(e.target)) skipped++;
  }

  const model: Model = {
    entities: entities.map((e) => e.model),
    relationships: relationships.map((r) => r.model),
    specializations: specializations.map((s) => s.model),
    notes: notes.map((n) => n.text),
  };
  if (title !== undefined && title !== '') model.title = title;

  return { model, entities, relationships, specializations, notes, managedNodeIds, managedEdgeIds, skipped };
}

/** 다이어그램을 모델로 바꾼다. title을 주면 모델에 넣는다 */
export function extractModel(nodes: ErdNode[], edges: ErdEdge[], title?: string): ExtractResult {
  const bound = extractBound(nodes, edges, title);
  return { model: bound.model, skipped: bound.skipped };
}

/** extractModel + printModel. 모델에 담지 못한 도형이 있으면 끝에 주석 한 줄로 알린다 */
export function diagramToText(nodes: ErdNode[], edges: ErdEdge[], title?: string): string {
  const { model, skipped } = extractModel(nodes, edges, title);
  let text = printModel(model);
  if (skipped > 0) {
    const what = skipped === 1 ? '1 shape is' : `${skipped} shapes are`;
    text += `${text === '' ? '' : '\n'}# ${what} not shown here (e.g. unconnected attributes); push leaves them untouched\n`;
  }
  return text;
}
