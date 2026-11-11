/**
 * 방 상태를 React에서 읽는 훅. (CORE 파일)
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ErdEdge, ErdNode, Peer, Presence } from '../../shared/types';
import { getMetaMap, getTitle } from './docOps';
import type { ConnectionStatus, Room } from './room';

export const RoomContext = createContext<Room | null>(null);

/** 현재 방. RoomPage 아래에서만 쓸 수 있다. */
export function useRoom(): Room {
  const room = useContext(RoomContext);
  if (!room) throw new Error('useRoom은 RoomContext 안에서만 쓸 수 있습니다');
  return room;
}

/** 모든 노드. 내용이 바뀔 때만 새 배열이 된다. */
export function useNodes(): ErdNode[] {
  const room = useRoom();
  return useSyncExternalStore(room.nodes.subscribe, room.nodes.getSnapshot);
}

/** 모든 엣지. */
export function useEdges(): ErdEdge[] {
  const room = useRoom();
  return useSyncExternalStore(room.edges.subscribe, room.edges.getSnapshot);
}

/** id → 노드 조회용 Map */
export function useNodeMap(): Map<string, ErdNode> {
  const nodes = useNodes();
  return useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
}

/** 문서 제목 */
export function useTitle(): string {
  const room = useRoom();
  const [title, setTitle] = useState(() => getTitle(room.doc));
  useEffect(() => {
    const meta = getMetaMap(room.doc);
    const update = () => setTitle(getTitle(room.doc));
    meta.observe(update);
    update();
    return () => meta.unobserve(update);
  }, [room]);
  return title;
}

function readPeers(room: Room): Peer[] {
  const out: Peer[] = [];
  room.awareness.getStates().forEach((state, clientId) => {
    if (clientId === room.awareness.clientID) return;
    const s = state as Partial<Presence>;
    if (!s || !s.user) return;
    out.push({
      clientId,
      user: s.user,
      cursor: s.cursor ?? null,
      selection: Array.isArray(s.selection) ? s.selection : [],
      editing: s.editing ?? null,
    });
  });
  out.sort((a, b) => a.clientId - b.clientId);
  return out;
}

/** 나를 뺀 다른 접속자들. 커서가 움직일 때마다 갱신되므로 필요한 컴포넌트에서만 쓴다. */
export function usePeers(): Peer[] {
  const room = useRoom();
  const [peers, setPeers] = useState<Peer[]>(() => readPeers(room));
  useEffect(() => {
    const update = () => setPeers(readPeers(room));
    room.awareness.on('change', update);
    update();
    return () => room.awareness.off('change', update);
  }, [room]);
  return peers;
}

/** 내 접속자 상태(이름, 색 등) */
export function useMyPresence(): Presence | null {
  const room = useRoom();
  const [me, setMe] = useState<Presence | null>(() => room.awareness.getLocalState() as Presence | null);
  useEffect(() => {
    const update = () => setMe(room.awareness.getLocalState() as Presence | null);
    room.awareness.on('change', update);
    return () => room.awareness.off('change', update);
  }, [room]);
  return me;
}

/** 서버 연결 상태 */
export function useConnectionStatus(): ConnectionStatus {
  const room = useRoom();
  const read = (): ConnectionStatus =>
    room.provider.wsconnected ? 'connected' : room.provider.wsconnecting ? 'connecting' : 'disconnected';
  const [status, setStatus] = useState<ConnectionStatus>(read);
  useEffect(() => {
    const onStatus = (e: { status: ConnectionStatus }) => setStatus(e.status);
    room.provider.on('status', onStatus);
    // 첫 렌더와 구독 사이에 연결이 끝났을 수 있으므로 구독한 뒤 한 번 더 읽는다
    setStatus(read());
    return () => room.provider.off('status', onStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);
  return status;
}

/** 서버가 접속을 받아 주지 않은 이유. 서버의 닫기 코드(src/server/limits.ts, sync.ts)와 맞춘다 */
export type BlockedReason = 'connections' | 'room-rate' | 'room-full';

const BLOCKED_BY_CODE: Record<number, BlockedReason> = { 4429: 'connections', 4430: 'room-rate', 4503: 'room-full' };

/** 접속 제한에 걸려 서버가 연결을 닫았으면 그 이유. 다시 연결되면 null로 돌아간다 */
export function useBlockedReason(): BlockedReason | null {
  const room = useRoom();
  const [reason, setReason] = useState<BlockedReason | null>(null);
  useEffect(() => {
    const onClose = (event: CloseEvent | null) => {
      const blocked = event ? BLOCKED_BY_CODE[event.code] : undefined;
      if (blocked) setReason(blocked);
    };
    const onStatus = (e: { status: ConnectionStatus }) => {
      if (e.status === 'connected') setReason(null);
    };
    room.provider.on('connection-close', onClose);
    room.provider.on('status', onStatus);
    return () => {
      room.provider.off('connection-close', onClose);
      room.provider.off('status', onStatus);
    };
  }, [room]);
  return reason;
}

/** 서버의 문서를 처음 한 번 다 받았는지 */
export function useSynced(): boolean {
  const room = useRoom();
  const [synced, setSynced] = useState<boolean>(() => room.provider.synced);
  useEffect(() => {
    const onSync = (s: boolean) => setSynced(s);
    room.provider.on('sync', onSync);
    setSynced(room.provider.synced);
    return () => room.provider.off('sync', onSync);
  }, [room]);
  return synced;
}

/** 실행 취소/다시 실행 가능 여부 */
export function useUndoState(): { canUndo: boolean; canRedo: boolean } {
  const room = useRoom();
  const read = () => ({ canUndo: room.undo.undoStack.length > 0, canRedo: room.undo.redoStack.length > 0 });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    room.undo.on('stack-item-added', update);
    room.undo.on('stack-item-popped', update);
    room.undo.on('stack-cleared', update);
    return () => {
      room.undo.off('stack-item-added', update);
      room.undo.off('stack-item-popped', update);
      room.undo.off('stack-cleared', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);
  return state;
}
