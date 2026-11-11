/**
 * 논리 모델을 다이어그램에 반영한다. 다이어그램을 모델과 같게 만들되, 사람이 놓아 둔 자리는 지킨다.
 *
 * 1. 지금 다이어그램에서 모델을 뽑아(extract) 새 모델의 각 요소와 짝을 짓는다. 짝이 맞으면 노드 id와 좌표,
 *    엣지 id와 붙는 면을 그대로 쓴다. 이름만 바뀐 것도 되도록 같은 도형으로 본다.
 * 2. 짝이 없는 옛 도형은 지우고(붙어 있던 선도 함께), 짝이 없는 새 요소는 만든다.
 * 3. 새 도형의 자리를 정한다. 남은 도형이 하나도 없거나 relayout이면 전체를 다시 배치하고, 아니면 새 도형만 놓는다.
 *
 * extract가 모델에 담지 못한 도형과 선은 건드리지 않는다. derived 플래그는 모델에 없으므로 그대로 둔다.
 */
import { nanoid } from 'nanoid';
import { unionBounds } from '../geometry';
import { fitNodeSize } from '../measure';
import { specRoles } from '../rules';
import { NODE_PRESETS, presetOf, type ErdEdge, type ErdNode, type NodeKind, type Rect } from '../types';
import { extractBound, type BoundAttribute } from './extract';
import { layoutFull, layoutIncremental, type LayoutAttr, type LayoutGraph, type LayoutOwner, type LayoutRelationship, type LayoutSpec } from './layout';
import { normalizeModel } from './text';
import type { ApplyOptions, ApplyResult, DiagramChange, Model, ModelAttribute } from './types';

type NodePatch = Partial<Omit<ErdNode, 'id'>>;
type EdgePatch = Partial<Omit<ErdEdge, 'id'>>;

/** 아무것도 바꾸지 않는 변경인지 */
export function isEmptyChange(change: DiagramChange): boolean {
  return (
    change.addNodes.length === 0 &&
    change.patchNodes.length === 0 &&
    change.removeNodeIds.length === 0 &&
    change.addEdges.length === 0 &&
    change.patchEdges.length === 0 &&
    change.removeEdgeIds.length === 0 &&
    change.title === undefined
  );
}

function assignPatch<T extends object>(target: T, patch: Partial<T>): void {
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (value === undefined) delete target[key];
    else target[key] = value as T[keyof T];
  }
}

/** 이름 집합의 자카드 유사도. 둘 다 비어 있으면 0(근거가 없다) */
function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let both = 0;
  for (const x of sa) if (sb.has(x)) both++;
  return both / (sa.size + sb.size - both);
}

/**
 * 옛 목록과 새 목록의 짝을 단계별로 짓는다. 각 단계는 (옛 것, 새 것)이 짝이 될 수 있는지 판단하고,
 * 앞 단계에서 짝이 지어진 것은 다음 단계에서 빠진다. 돌려주는 배열은 새 목록의 각 항목에 대응하는 옛 인덱스(-1이면 없음).
 */
function matchInOrder<O, N>(olds: O[], news: N[], passes: Array<(o: O, n: N) => boolean>): number[] {
  const result = news.map(() => -1);
  const used = olds.map(() => false);
  for (const same of passes) {
    news.forEach((n, j) => {
      if (result[j] >= 0) return;
      for (let i = 0; i < olds.length; i++) {
        if (used[i] || !same(olds[i], n)) continue;
        used[i] = true;
        result[j] = i;
        return;
      }
    });
  }
  return result;
}

export function applyModel(input: Model, nodes: ErdNode[], edges: ErdEdge[], currentTitle: string, opts: ApplyOptions = {}): ApplyResult {
  // 이미 쓰는 id가 나오면 다시 뽑는다(우연히 겹친 id가 기존 도형을 덮어쓰지 않게)
  const makeId = opts.newId ?? (() => nanoid(10));
  const usedIds = new Set<string>();
  for (const n of nodes) usedIds.add(n.id);
  for (const e of edges) usedIds.add(e.id);
  const newId = (): string => {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const id = makeId();
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      return id;
    }
    throw new Error('newId keeps returning ids that are already in use');
  };
  const model = normalizeModel(input);
  const warnings: string[] = [];
  const bound = extractBound(nodes, edges);

  // 작업용 복사본. 패치는 복사본에도 바로 반영해서 배치가 최종 크기를 보게 한다
  const finalNodes = new Map<string, ErdNode>();
  for (const n of nodes) if (!finalNodes.has(n.id)) finalNodes.set(n.id, { ...n });
  const finalEdges = new Map<string, ErdEdge>();
  for (const e of edges) if (!finalEdges.has(e.id)) finalEdges.set(e.id, { ...e });
  const nodePatches = new Map<string, NodePatch>();
  const edgePatches = new Map<string, EdgePatch>();
  const addedNodes: ErdNode[] = [];
  const addedIds = new Set<string>();
  const addedEdges: ErdEdge[] = [];
  const removedNodes = new Set<string>();
  const removedEdges = new Set<string>();
  /** 짝이 지어져 그대로 남는 관리 대상 노드 */
  const kept = new Set<string>();

  const patchNode = (id: string, patch: NodePatch) => {
    const node = finalNodes.get(id);
    if (!node || Object.keys(patch).length === 0) return;
    assignPatch(node, patch as Partial<ErdNode>);
    if (addedIds.has(id)) return;
    nodePatches.set(id, { ...(nodePatches.get(id) ?? {}), ...patch });
  };
  const patchEdge = (id: string, patch: EdgePatch) => {
    const edge = finalEdges.get(id);
    if (!edge || Object.keys(patch).length === 0) return;
    assignPatch(edge, patch as Partial<ErdEdge>);
    edgePatches.set(id, { ...(edgePatches.get(id) ?? {}), ...patch });
  };
  const createNode = (kind: NodeKind, text: string, props: Partial<ErdNode> = {}): ErdNode => {
    const base = { kind, text, ...props } as ErdNode;
    const preset = NODE_PRESETS[presetOf(base)];
    const fit = fitNodeSize(base, text);
    const node: ErdNode = { id: newId(), kind, x: 0, y: 0, w: Math.max(preset.w, fit.w), h: Math.max(preset.h, fit.h), text, ...props };
    finalNodes.set(node.id, node);
    addedNodes.push(node);
    addedIds.add(node.id);
    return node;
  };
  const createEdge = (source: string, target: string, props: Partial<Pick<ErdEdge, 'double' | 'label' | 'role'>> = {}): ErdEdge => {
    const edge: ErdEdge = { id: newId(), source, target, double: false, label: '', role: '', ...props };
    finalEdges.set(edge.id, edge);
    addedEdges.push(edge);
    return edge;
  };
  /** 짝이 지어진 노드의 글자와 플래그를 맞춘다. 달라진 것만 패치하고, 글자가 넘치면 중심을 두고 키운다 */
  const syncNode = (id: string, text: string, flags: NodePatch) => {
    const node = finalNodes.get(id)!;
    kept.add(id);
    const patch: NodePatch = {};
    if (node.text !== text) patch.text = text;
    for (const key of Object.keys(flags) as Array<keyof NodePatch>) {
      if (node[key] !== flags[key]) (patch as Record<string, unknown>)[key] = flags[key];
    }
    if (Object.keys(patch).length === 0) return;
    const next = { ...node } as ErdNode;
    assignPatch(next, patch as Partial<ErdNode>);
    const fit = fitNodeSize(next, text);
    const w = Math.max(node.w, fit.w);
    const h = Math.max(node.h, fit.h);
    if (w !== node.w) {
      patch.x = Math.round(node.x - (w - node.w) / 2);
      patch.w = w;
    }
    if (h !== node.h) {
      patch.y = Math.round(node.y - (h - node.h) / 2);
      patch.h = h;
    }
    patchNode(id, patch);
  };

  // ───────────── 속성 ─────────────

  const attributeFlags = (node: ErdNode | undefined, a: ModelAttribute): NodePatch => {
    const flags: NodePatch = {};
    const oldKey = node?.keyType === 'key' || node?.keyType === 'partial' ? node.keyType : 'none';
    const newKey = a.key ?? 'none';
    // 'none'이 저장돼 있는 것과 필드가 없는 것은 같은 뜻이므로 바꾸지 않는다
    if (oldKey !== newKey) flags.keyType = newKey === 'none' ? undefined : newKey;
    if (!!node?.multivalued !== !!a.multivalued) flags.multivalued = a.multivalued ? true : undefined;
    return flags;
  };
  const removeAttribute = (a: BoundAttribute) => {
    removedNodes.add(a.nodeId);
    a.parts.forEach(removeAttribute);
  };
  const syncAttributes = (parentId: string, olds: BoundAttribute[], news: ModelAttribute[]): LayoutAttr[] => {
    const match = matchInOrder(olds, news, [(o, n) => o.model.name === n.name, () => true]);
    const usedOld = new Set(match.filter((i) => i >= 0));
    olds.forEach((o, i) => {
      if (!usedOld.has(i)) removeAttribute(o);
    });
    return news.map((a, j) => {
      const old = match[j] >= 0 ? olds[match[j]] : null;
      if (old) {
        syncNode(old.nodeId, a.name, attributeFlags(finalNodes.get(old.nodeId), a));
        return { id: old.nodeId, parts: syncAttributes(old.nodeId, old.parts, a.parts ?? []) };
      }
      const props: Partial<ErdNode> = {};
      if (a.key) props.keyType = a.key;
      if (a.multivalued) props.multivalued = true;
      const node = createNode('attribute', a.name, props);
      createEdge(parentId, node.id);
      return { id: node.id, parts: syncAttributes(node.id, [], a.parts ?? []) };
    });
  };

  // ───────────── 엔티티 ─────────────

  const entityIndexByName = new Map<string, number>();
  model.entities.forEach((e, i) => {
    if (entityIndexByName.has(e.name)) warnings.push(`Entity "${e.name}" is declared more than once; only the first one was used.`);
    else entityIndexByName.set(e.name, i);
  });
  const modelEntities = model.entities.filter((e, i) => entityIndexByName.get(e.name) === i);
  entityIndexByName.clear();
  modelEntities.forEach((e, i) => entityIndexByName.set(e.name, i));

  const entityMatch = matchInOrder(bound.entities, modelEntities, [(o, n) => o.model.name === n.name]);
  {
    // 이름이 바뀐 엔티티: 남은 것끼리 최상위 속성 이름이 많이 겹치는 순서로 짝짓는다
    const usedOld = new Set(entityMatch.filter((i) => i >= 0));
    const candidates: Array<{ i: number; j: number; score: number }> = [];
    bound.entities.forEach((o, i) => {
      if (usedOld.has(i)) return;
      modelEntities.forEach((n, j) => {
        if (entityMatch[j] >= 0) return;
        const score = jaccard(o.model.attributes.map((a) => a.name), n.attributes.map((a) => a.name));
        if (score >= 0.5) candidates.push({ i, j, score });
      });
    });
    candidates.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
    for (const c of candidates) {
      if (usedOld.has(c.i) || entityMatch[c.j] >= 0) continue;
      usedOld.add(c.i);
      entityMatch[c.j] = c.i;
    }
    bound.entities.forEach((o, i) => {
      if (usedOld.has(i)) return;
      removedNodes.add(o.nodeId);
      o.attributes.forEach(removeAttribute);
    });
  }
  /** 옛 엔티티 노드 id → 새 모델의 엔티티 인덱스 */
  const modelIndexOfOld = new Map<string, number>();
  const entityIds: string[] = [];
  const layoutEntities: LayoutOwner[] = modelEntities.map((e, j) => {
    const old = entityMatch[j] >= 0 ? bound.entities[entityMatch[j]] : null;
    let id: string;
    if (old) {
      id = old.nodeId;
      modelIndexOfOld.set(id, j);
      syncNode(id, e.name, finalNodes.get(id)!.weak ? (e.weak ? {} : { weak: undefined }) : e.weak ? { weak: true } : {});
    } else {
      id = createNode('entity', e.name, e.weak ? { weak: true } : {}).id;
    }
    entityIds.push(id);
    return { id, attrs: syncAttributes(id, old ? old.attributes : [], e.attributes) };
  });

  // ───────────── 관계 ─────────────

  const signature = (indexes: number[]) => [...indexes].sort((a, b) => a - b).join(',');
  const newRelationships = model.relationships.map((r) => {
    const participants = r.participants.filter((p) => {
      if (entityIndexByName.has(p.entity)) return true;
      warnings.push(`Relationship "${r.name}" names entity "${p.entity}", which is not declared; that participant was skipped.`);
      return false;
    });
    const indexes = participants.map((p) => entityIndexByName.get(p.entity)!);
    return { model: r, participants, indexes, sig: signature(indexes) };
  });
  const oldRelationships = bound.relationships.map((r) => {
    const indexes = r.participants.map((p) => modelIndexOfOld.get(p.entityId) ?? -1);
    return { bound: r, indexes, sig: signature(indexes) };
  });
  const relationshipMatch = matchInOrder(oldRelationships, newRelationships, [
    (o, n) => o.bound.model.name === n.model.name && o.sig === n.sig,
    (o, n) => o.bound.model.name === n.model.name,
    (o, n) => o.sig === n.sig && n.indexes.length > 0 && !o.indexes.includes(-1),
  ]);
  {
    const usedOld = new Set(relationshipMatch.filter((i) => i >= 0));
    oldRelationships.forEach((o, i) => {
      if (usedOld.has(i)) return;
      removedNodes.add(o.bound.nodeId);
      o.bound.attributes.forEach(removeAttribute);
    });
  }
  const layoutRelationships: LayoutRelationship[] = newRelationships.map((r, j) => {
    const old = relationshipMatch[j] >= 0 ? oldRelationships[relationshipMatch[j]] : null;
    let id: string;
    if (old) {
      id = old.bound.nodeId;
      syncNode(id, r.model.name, finalNodes.get(id)!.identifying ? (r.model.identifying ? {} : { identifying: undefined }) : r.model.identifying ? { identifying: true } : {});
    } else {
      id = createNode('relationship', r.model.name, r.model.identifying ? { identifying: true } : {}).id;
    }
    // 참여 선: 같은 엔티티끼리, 역할 이름이 같은 것을 먼저 짝짓는다
    const oldParts = old ? old.bound.participants.map((p, i) => ({ p, index: old.indexes[i] })) : [];
    const newParts = r.participants.map((p, i) => ({ p, index: r.indexes[i] }));
    const partMatch = matchInOrder(oldParts, newParts, [
      (o, n) => o.index === n.index && (o.p.model.role ?? '') === (n.p.role ?? ''),
      (o, n) => o.index === n.index,
    ]);
    const usedOld = new Set(partMatch.filter((i) => i >= 0));
    oldParts.forEach((o, i) => {
      if (!usedOld.has(i)) removedEdges.add(o.p.edgeId);
    });
    newParts.forEach((n, k) => {
      const want = { label: n.p.cardinality, double: !!n.p.total, role: n.p.role ?? '' };
      if (partMatch[k] < 0) {
        createEdge(id, entityIds[n.index], want);
        return;
      }
      const edge = finalEdges.get(oldParts[partMatch[k]].p.edgeId)!;
      const patch: EdgePatch = {};
      if ((edge.label ?? '') !== want.label) patch.label = want.label;
      if (!!edge.double !== want.double) patch.double = want.double;
      if ((edge.role ?? '') !== want.role) patch.role = want.role;
      patchEdge(edge.id, patch);
    });
    return { id, participants: r.indexes.map((i) => entityIds[i]), attrs: syncAttributes(id, old ? old.bound.attributes : [], r.model.attributes) };
  });

  // ───────────── 특수화 ─────────────

  const newSpecs = model.specializations.flatMap((s) => {
    const parent = entityIndexByName.get(s.parent);
    if (parent === undefined) {
      warnings.push(`A specialization names supertype "${s.parent}", which is not declared; it was skipped.`);
      return [];
    }
    const children: number[] = [];
    for (const name of s.children) {
      const index = entityIndexByName.get(name);
      if (index === undefined) warnings.push(`The specialization of "${s.parent}" names subtype "${name}", which is not declared; it was skipped.`);
      else if (index !== parent && !children.includes(index)) children.push(index);
    }
    return [{ model: s, parent, children }];
  });
  const oldSpecs = bound.specializations.map((s) => ({ bound: s, parent: modelIndexOfOld.get(s.parentId) ?? -1 }));
  const specMatch = matchInOrder(oldSpecs, newSpecs, [
    (o, n) => o.parent === n.parent && o.bound.model.kind === n.model.kind,
    (o, n) => o.parent === n.parent,
  ]);
  {
    const usedOld = new Set(specMatch.filter((i) => i >= 0));
    oldSpecs.forEach((o, i) => {
      if (!usedOld.has(i)) removedNodes.add(o.bound.nodeId);
    });
  }
  const layoutSpecs: LayoutSpec[] = newSpecs.map((s, j) => {
    const old = specMatch[j] >= 0 ? oldSpecs[specMatch[j]].bound : null;
    const total = !!s.model.total;
    let id: string;
    if (old) {
      id = old.nodeId;
      syncNode(id, finalNodes.get(id)!.text, (finalNodes.get(id)!.specType === 'o' ? 'o' : 'd') !== s.model.kind ? { specType: s.model.kind } : {});
      const parentEdge = finalEdges.get(old.parentEdgeId)!;
      if (!!parentEdge.double !== total) patchEdge(parentEdge.id, { double: total });
      const oldChildren = old.children.map((c) => ({ ...c, index: modelIndexOfOld.get(c.entityId) ?? -1 }));
      for (const c of oldChildren) {
        if (!s.children.includes(c.index)) removedEdges.add(c.edgeId);
        // 서브타입 쪽 선이 이중선이면 어느 쪽이 슈퍼타입인지 흐려지므로 단선으로 맞춘다
        else if (finalEdges.get(c.edgeId)!.double) patchEdge(c.edgeId, { double: false });
      }
      for (const index of s.children) {
        if (!oldChildren.some((c) => c.index === index)) createEdge(id, entityIds[index]);
      }
    } else {
      id = createNode('spec', '', { specType: s.model.kind }).id;
      createEdge(id, entityIds[s.parent], { double: total });
      for (const index of s.children) createEdge(id, entityIds[index]);
    }
    return { id, parent: entityIds[s.parent], children: s.children.map((i) => entityIds[i]) };
  });

  // ───────────── 메모 ─────────────

  const noteMatch = matchInOrder(bound.notes, model.notes, [(o, n) => o.text === n, () => true]);
  {
    const usedOld = new Set(noteMatch.filter((i) => i >= 0));
    bound.notes.forEach((o, i) => {
      if (!usedOld.has(i)) removedNodes.add(o.nodeId);
    });
  }
  const noteIds = model.notes.map((text, j) => {
    if (noteMatch[j] < 0) return createNode('note', text).id;
    const id = bound.notes[noteMatch[j]].nodeId;
    syncNode(id, text, {});
    return id;
  });

  // ───────────── 지우기 ─────────────

  for (const id of removedNodes) {
    finalNodes.delete(id);
    nodePatches.delete(id);
    kept.delete(id);
  }
  // 지워지는 도형에 붙은 선은 관리 대상이 아니어도 함께 지운다(허공에 뜬 선을 남기지 않는다)
  for (const e of finalEdges.values()) {
    if (removedNodes.has(e.source) || removedNodes.has(e.target)) removedEdges.add(e.id);
  }
  for (const id of removedEdges) {
    finalEdges.delete(id);
    edgePatches.delete(id);
  }

  // ───────────── 배치 ─────────────

  const sizes = new Map<string, { w: number; h: number }>();
  const managedIds: string[] = [];
  const collect = (attrs: LayoutAttr[]) => {
    for (const a of attrs) {
      managedIds.push(a.id);
      collect(a.parts);
    }
  };
  for (const owner of [...layoutEntities, ...layoutRelationships]) {
    managedIds.push(owner.id);
    collect(owner.attrs);
  }
  for (const s of layoutSpecs) managedIds.push(s.id);
  managedIds.push(...noteIds);
  for (const id of managedIds) {
    const n = finalNodes.get(id)!;
    sizes.set(id, { w: n.w, h: n.h });
  }
  const graph: LayoutGraph = { sizes, entities: layoutEntities, relationships: layoutRelationships, specs: layoutSpecs, notes: noteIds };
  const rectOf = (n: ErdNode): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h });
  const managed = new Set(managedIds);
  const obstacles: Rect[] = [];
  for (const n of finalNodes.values()) if (!managed.has(n.id)) obstacles.push(rectOf(n));
  const moveTo = (id: string, x: number, y: number) => {
    const node = finalNodes.get(id)!;
    const patch: NodePatch = {};
    if (node.x !== x) patch.x = x;
    if (node.y !== y) patch.y = y;
    patchNode(id, patch);
  };

  const full = kept.size === 0 || opts.relayout === true;
  if (full) {
    const before = unionBounds([...kept].map((id) => rectOf(finalNodes.get(id)!)));
    const positions = layoutFull(graph, obstacles, before ? { x: Math.round(before.x), y: Math.round(before.y) } : undefined);
    for (const [id, p] of positions) moveTo(id, p.x, p.y);
    // 자리가 바뀌었으니 사람이 정해 둔 붙는 면은 맞지 않는다. 자동으로 고르게 지운다
    for (const e of finalEdges.values()) {
      if (!bound.managedEdgeIds.has(e.id)) continue;
      const patch: EdgePatch = {};
      if (e.sourceSide !== undefined) patch.sourceSide = undefined;
      if (e.targetSide !== undefined) patch.targetSide = undefined;
      patchEdge(e.id, patch);
    }
  } else {
    const placed = new Map<string, Rect>();
    for (const id of managedIds) if (kept.has(id)) placed.set(id, rectOf(finalNodes.get(id)!));
    const positions = layoutIncremental(graph, placed, obstacles);
    for (const [id, p] of positions) moveTo(id, p.x, p.y);
  }

  // 특수화마다 화면 규칙(specRoles)으로 슈퍼타입이 모델과 같게 읽히는지 확인한다
  const edgeList = () => [...finalEdges.values()];
  for (const spec of layoutSpecs) {
    const supertypeOk = () => specRoles(finalNodes.get(spec.id)!, finalNodes, edgeList()).supertype?.id === spec.parent;
    if (supertypeOk()) continue;
    const circle = finalNodes.get(spec.id)!;
    const parent = finalNodes.get(spec.parent)!;
    moveTo(spec.id, Math.round(parent.x + parent.w / 2 - circle.w / 2), Math.round(parent.y + parent.h + 40));
    if (!supertypeOk()) {
      warnings.push(
        `The specialization of "${parent.text}" could not be drawn so that "${parent.text}" reads as the supertype; move the circle directly below "${parent.text}" or make the specialization total.`,
      );
    }
  }

  // ───────────── 결과 ─────────────

  const change: DiagramChange = {
    addNodes: addedNodes,
    patchNodes: [...nodePatches].filter(([, patch]) => Object.keys(patch).length > 0).map(([id, patch]) => ({ id, patch })),
    removeNodeIds: [...removedNodes],
    addEdges: addedEdges,
    patchEdges: [...edgePatches].filter(([, patch]) => Object.keys(patch).length > 0).map(([id, patch]) => ({ id, patch })),
    removeEdgeIds: [...removedEdges],
  };
  if (model.title !== undefined && model.title !== currentTitle) change.title = model.title;

  return {
    change,
    nodes: [...finalNodes.values()],
    edges: [...finalEdges.values()],
    summary: {
      added: change.addNodes.length + change.addEdges.length,
      updated: change.patchNodes.length + change.patchEdges.length,
      removed: change.removeNodeIds.length + change.removeEdgeIds.length,
    },
    warnings,
  };
}
