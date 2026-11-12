/**
 * 화면 테스트용 가짜 방(서버 연결 없이 Y.Doc만 가진다). 다른 테스트(TopBar.test.tsx)의 방식과 같다.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';

export function makeTestRoom(id = 'testroom'): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const provider = { wsconnected: true, synced: true, on: () => undefined, off: () => undefined, connect: () => undefined };
  return {
    id,
    doc,
    provider,
    awareness: { getStates: () => new Map(), clientID: 1, on: () => undefined, off: () => undefined, getLocalState: () => null },
    undo: new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 }),
    nodes: new ElementStore(nodesMap, readNode),
    edges: new ElementStore(edgesMap, readEdge),
    setPresence: () => undefined,
    destroy: () => undefined,
  } as unknown as Room;
}
