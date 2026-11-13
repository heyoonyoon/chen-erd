/**
 * 서비스 지표 이벤트를 우리 서버(POST /api/t)로 보낸다. 바깥 서비스로는 아무것도 보내지 않는다.
 * 개인정보를 싣지 않는다: 사람 구분은 이 브라우저에서 만든 무작위 익명 ID(128비트)뿐이고, 유입은 직전 사이트의 도메인만 보낸다.
 * sendBeacon이 없는 환경(테스트의 jsdom 등)에서는 아무것도 하지 않는다.
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  ANON_ID_PATTERN,
  TELEMETRY_PATH,
  type EntryKind,
  type ExportKind,
  type TelemetryEvent,
  type TelemetryPayload,
} from '../shared/telemetry';
import { RELATIONAL_COLUMNS, RELATIONAL_META, RELATIONAL_TEXT, readRoomDialect } from '../shared/relational/ydoc';
import { getNodesMap } from '../shared/ydoc';
import type { LayoutNode, LayoutState } from './layout/types';
import { useUi } from './state/ui';

const ID_KEY = 'modelll.anon';
/** IE 그림 안 편집의 문서 변경 출처(src/client/relational/panes.tsx 의 IE_ORIGIN). 관계 모델 쪽 코드를 첫 번들에 끌어오지 않으려고 값만 적는다 */
const IE_ORIGIN = 'ie-edit';

let memoryId: string | null = null;
let landed = false;
/** 첫 화면에서 방금 만든 방 */
let createdRoom: string | null = null;
/** 이 페이지에서 앱 안 이동(navigate)이 있었는지 */
let navigatedInApp = false;
const sentOnce = new Set<string>();

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 이 브라우저의 익명 ID. 저장할 수 없으면 이 페이지에서만 쓰는 값 */
export function anonId(): string {
  if (memoryId) return memoryId;
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved && ANON_ID_PATTERN.test(saved)) return (memoryId = saved);
    const fresh = randomId();
    localStorage.setItem(ID_KEY, fresh);
    return (memoryId = fresh);
  } catch {
    return (memoryId = randomId());
  }
}

function enabled(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && typeof crypto?.getRandomValues === 'function';
}

/** 직전 사이트의 도메인. 같은 사이트 안이거나 없으면 direct */
function referrerDomain(): string {
  try {
    if (!document.referrer) return 'direct';
    const url = new URL(document.referrer);
    if (url.host === location.host) return 'direct';
    return url.hostname.slice(0, 64);
  } catch {
    return 'direct';
  }
}

function device(): 'm' | 'd' {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || window.innerWidth < 768 ? 'm' : 'd';
}

export function track(e: TelemetryEvent, extra: Partial<Omit<TelemetryPayload, 'a' | 'e'>> = {}): void {
  if (!enabled()) return;
  try {
    const payload: TelemetryPayload = { a: anonId(), e, ...extra };
    if (!landed && (e === 'home_view' || e === 'room_enter')) {
      landed = true;
      payload.land = 1;
      payload.ref = referrerDomain();
      const utm = new URLSearchParams(location.search).get('utm_source');
      if (utm) payload.utm = utm.slice(0, 40);
      payload.lang = document.documentElement.lang || navigator.language;
      payload.dev = device();
    }
    navigator.sendBeacon(TELEMETRY_PATH, new Blob([JSON.stringify(payload)], { type: 'text/plain' }));
  } catch {
    // 지표는 앱 동작에 영향을 주지 않는다
  }
}

/** 방마다 한 번만 보낸다(퍼널 단계) */
export function trackOnce(e: TelemetryEvent, roomId: string, extra: Partial<Omit<TelemetryPayload, 'a' | 'e'>> = {}): void {
  const key = `${e}:${roomId}`;
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  track(e, { r: roomId, ...extra });
}

export function trackExport(roomId: string, kind: ExportKind): void {
  track('export', { r: roomId, kind });
}

/** 첫 화면의 새 다이어그램 만들기 */
export function noteCreated(roomId: string): void {
  createdRoom = roomId;
  track('create_click');
}

export function noteNavigation(): void {
  navigatedInApp = true;
}

/** 방에 어떻게 들어왔는지. wasRecent = 들어오기 전에 이 브라우저의 최근 방 목록에 있었는지 */
export function entryKind(roomId: string, wasRecent: boolean): EntryKind {
  if (createdRoom === roomId) return 'new';
  if (navigatedInApp) return 'home';
  return wasRecent ? 'recent' : 'link';
}

/** pane이 어떻게 나뉘고 어디에 있는지(크기와 고른 탭은 빼고) */
function layoutShape(node: LayoutNode): string {
  return node.type === 'group' ? node.panes.join(',') : `${node.direction}(${node.children.map(layoutShape).join('|')})`;
}

function sqlVisible(state: LayoutState): boolean {
  const visit = (node: LayoutNode): boolean =>
    node.type === 'group' ? node.active === 'sql' && (state.maximized === null || state.maximized === node.id) : node.children.some(visit);
  return visit(state.root);
}

/**
 * 방 화면의 지표: 들어옴, 첫 도형, 관계 모델 작성, IE 편집, DBMS, 패널 열기, pane 배치, SQL 보기.
 * 문서 변경은 이 브라우저에서 한 것(transaction.local)만 센다. 다른 사람이나 AI가 바꾼 것은 세지 않는다.
 */
export function useRoomTelemetry(roomId: string, doc: Y.Doc, entry: EntryKind, layout: LayoutState): void {
  useEffect(() => {
    track('room_enter', { r: roomId, entry });
  }, [roomId, entry]);

  useEffect(() => {
    const nodes = getNodesMap(doc);
    const text = doc.getText(RELATIONAL_TEXT);
    const columns = doc.getMap(RELATIONAL_COLUMNS);
    const meta = doc.getMap(RELATIONAL_META);
    const onNodes = (ev: Y.YEvent<any>) => {
      if (!ev.transaction.local) return;
      for (const change of ev.changes.keys.values()) {
        if (change.action === 'add') return trackOnce('shape_add', roomId);
      }
    };
    const onText = (ev: Y.YTextEvent) => {
      if (!ev.transaction.local) return;
      trackOnce(ev.transaction.origin === IE_ORIGIN ? 'ie_edit' : 'rel_write', roomId);
    };
    const onColumns = (ev: Y.YEvent<any>) => {
      if (ev.transaction.local) trackOnce('ie_edit', roomId);
    };
    const onMeta = (ev: Y.YEvent<any>) => {
      if (!ev.transaction.local) return;
      const v = readRoomDialect(doc);
      if (v) track('dbms', { r: roomId, v });
    };
    nodes.observe(onNodes);
    text.observe(onText);
    columns.observe(onColumns);
    meta.observe(onMeta);
    return () => {
      nodes.unobserve(onNodes);
      text.unobserve(onText);
      columns.unobserve(onColumns);
      meta.unobserve(onMeta);
    };
  }, [roomId, doc]);

  useEffect(() => {
    return useUi.subscribe((s, prev) => {
      if (s.panels.issues && !prev.panels.issues) trackOnce('validate_open', roomId);
      if (s.panels.legend && !prev.panels.legend) trackOnce('legend_open', roomId);
      if (s.panels.help && !prev.panels.help) trackOnce('help_open', roomId);
    });
  }, [roomId]);

  const firstShape = useRef<string | null>(null);
  const shape = layoutShape(layout.root);
  if (firstShape.current === null) firstShape.current = shape;
  const changed = shape !== firstShape.current || layout.maximized !== null;
  const sql = sqlVisible(layout);
  useEffect(() => {
    if (changed) trackOnce('layout_change', roomId);
  }, [changed, roomId]);
  useEffect(() => {
    if (sql) trackOnce('sql_view', roomId);
  }, [sql, roomId]);
}

/** 테스트에서 상태를 비운다 */
export function resetTelemetryForTest(): void {
  memoryId = null;
  landed = false;
  createdRoom = null;
  navigatedInApp = false;
  sentOnce.clear();
}
