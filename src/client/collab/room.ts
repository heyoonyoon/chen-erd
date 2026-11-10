/**
 * 방 하나에 대한 실시간 연결. Y.Doc, 웹소켓, 접속자 상태(awareness), 실행 취소를 묶는다.
 * (CORE 파일)
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import type { ErdEdge, ErdNode, Presence, UserInfo } from '../../shared/types';
import { LOCAL_ORIGIN, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode, type YElementMap } from './docOps';

/**
 * Y.Map<id, Y.Map>을 평범한 객체 배열로 비춰 주는 저장소.
 * 바뀐 요소만 새 객체로 만들기 때문에 React에서 참조 비교로 다시 그릴지 판단할 수 있다.
 */
export class ElementStore<T extends { id: string }> {
  private cache = new Map<string, T>();
  private list: T[] = [];
  private listeners = new Set<() => void>();
  private readonly handler: (events: Y.YEvent<any>[]) => void;

  constructor(
    private readonly ymap: YElementMap,
    private readonly read: (m: Y.Map<unknown>) => T,
  ) {
    for (const [id, m] of ymap.entries()) this.cache.set(id, read(m));
    this.list = Array.from(this.cache.values());
    this.handler = (events) => {
      const touched = new Set<string>();
      for (const ev of events) {
        if (ev.target === this.ymap) {
          for (const key of ev.changes.keys.keys()) touched.add(key);
        } else if (ev.path.length > 0) {
          touched.add(String(ev.path[0]));
        }
      }
      if (touched.size === 0) return;
      for (const id of touched) {
        const m = this.ymap.get(id);
        if (m) this.cache.set(id, this.read(m));
        else this.cache.delete(id);
      }
      this.list = Array.from(this.cache.values());
      for (const l of this.listeners) l();
    };
    ymap.observeDeep(this.handler);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** 현재 요소 배열. 내용이 바뀌기 전까지 같은 배열 참조를 돌려준다. */
  getSnapshot = (): T[] => this.list;
  get(id: string): T | undefined {
    return this.cache.get(id);
  }
  has(id: string): boolean {
    return this.cache.has(id);
  }
  destroy(): void {
    this.ymap.unobserveDeep(this.handler);
    this.listeners.clear();
  }
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface Room {
  id: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  undo: Y.UndoManager;
  nodes: ElementStore<ErdNode>;
  edges: ElementStore<ErdEdge>;
  /** 내 접속자 상태의 일부를 바꾼다. */
  setPresence(patch: Partial<Presence>): void;
  destroy(): void;
}

function wsBaseUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function createRoom(roomId: string, user: UserInfo): Room {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsBaseUrl(), roomId, doc, { disableBc: false });
  const awareness = provider.awareness;

  const initial: Presence = { user, cursor: null, selection: [], editing: null };
  awareness.setLocalState(initial);

  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const undo = new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 400,
  });

  const nodes = new ElementStore<ErdNode>(nodesMap, readNode);
  const edges = new ElementStore<ErdEdge>(edgesMap, readEdge);

  return {
    id: roomId,
    doc,
    provider,
    awareness,
    undo,
    nodes,
    edges,
    setPresence(patch) {
      const cur = (awareness.getLocalState() ?? initial) as Presence;
      awareness.setLocalState({ ...cur, ...patch });
    },
    destroy() {
      nodes.destroy();
      edges.destroy();
      undo.destroy();
      provider.destroy();
      doc.destroy();
    },
  };
}
