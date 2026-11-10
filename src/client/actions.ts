/**
 * 여러 곳(단축키, 상단 바, 우클릭 메뉴)에서 함께 쓰는 기본 명령. (CORE 파일)
 */
import type { Room } from './collab/room';
import { deleteElements, updateNodes } from './collab/docOps';
import { ui } from './state/ui';

export function undo(room: Room): void {
  room.undo.undo();
}
export function redo(room: Room): void {
  room.undo.redo();
}

export function deleteSelection(room: Room): void {
  const ids = ui().selection;
  if (ids.length === 0) return;
  deleteElements(room.doc, ids);
  ui().clearSelection();
}

export function selectAll(room: Room): void {
  ui().setSelection([...room.nodes.getSnapshot().map((n) => n.id), ...room.edges.getSnapshot().map((e) => e.id)]);
}

/** 선택된 노드를 dx, dy만큼 옮긴다(방향키). */
export function nudgeSelection(room: Room, dx: number, dy: number): void {
  const patches = ui()
    .selection.map((id) => room.nodes.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => ({ id: n.id, patch: { x: n.x + dx, y: n.y + dy } }));
  if (patches.length > 0) updateNodes(room.doc, patches);
}

/** 선택 목록에서 문서에 더 이상 없는 id를 걸러 낸다(다른 사람이 지운 경우). */
export function pruneSelection(room: Room): void {
  const cur = ui().selection;
  const next = cur.filter((id) => room.nodes.has(id) || room.edges.has(id));
  if (next.length !== cur.length) ui().setSelection(next);
  const editing = ui().editingId;
  if (editing && !room.nodes.has(editing)) ui().setEditing(null);
}
