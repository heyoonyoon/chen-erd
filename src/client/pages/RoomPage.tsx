/**
 * 방 화면. 방 연결을 만들고, 상단 바 아래를 pane 배치(DockLayout)로 채운다. (CORE 파일)
 * pane은 네 가지다: ERD(캔버스와 그 위의 패널), 관계 모델(사람이 적는 글), IE 다이어그램, SQL.
 * 배치는 사람마다 다르고 이 브라우저에만 저장한다(src/client/layout).
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { pruneSelection } from '../actions';
import { ErdPane } from '../canvas/ErdPane';
import { handleSaveKey, useShortcuts } from '../canvas/shortcuts';
import { RoomContext, useBlockedReason, useRoom, useTitle } from '../collab/hooks';
import { createRoom, type Room } from '../collab/room';
import { APP_NAME, useT } from '../i18n';
import { getIdentity, getRecentRooms, rememberRoom } from '../identity';
import { DockLayout } from '../layout/DockLayout';
import { loadLayout, openPane, openPanes, saveLayout } from '../layout/model';
import { PaneMenu } from '../layout/PaneMenu';
import { PANE_IDS, type LayoutState, type PaneId } from '../layout/types';
import { NicknameDialog } from '../presence/NicknameDialog';
import { PaneIcon, paneTitleKey } from '../relational/paneMeta';
import { useRelPanes } from '../relational/paneStore';
import { navigate } from '../router';
import { useUi } from '../state/ui';
import { entryKind, useRoomTelemetry } from '../telemetry';
import type { EntryKind } from '../../shared/telemetry';
import { ContextMenu } from '../ui/ContextMenu';
import { TopBar } from '../ui/TopBar';
import './RoomPage.css';

// 관계 모델 쪽 pane은 엔진과 함께 따로 내려받는다(탭 제목과 아이콘은 paneMeta에서 바로 가져온다)
const panesModule = () => import('../relational/panes');
const RelationalTextPane = lazy(() => panesModule().then((m) => ({ default: m.RelationalTextPane })));
const IePane = lazy(() => panesModule().then((m) => ({ default: m.IePane })));
const SqlPane = lazy(() => panesModule().then((m) => ({ default: m.SqlPane })));

/** 이보다 좁으면 나누지 않고 탭 한 줄로 pane을 하나씩 보여 준다(상단 바가 버튼 글자를 숨기는 폭과 같다) */
const NARROW_QUERY = '(max-width: 900px)';
/** 나눔선을 끄는 동안에는 저장을 미룬다 */
const SAVE_DELAY_MS = 300;

type SetLayout = Dispatch<SetStateAction<LayoutState>>;

export function RoomPage({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  // 지표: 어떻게 들어왔는지. 최근 목록에 이 방을 넣기 전에 본다
  const [entry] = useState<EntryKind>(() => entryKind(roomId, getRecentRooms().some((r) => r.id === roomId)));

  useEffect(() => {
    useUi.getState().reset();
    const r = createRoom(roomId, getIdentity());
    setRoom(r);
    // 디버깅과 E2E 테스트에서 방 상태를 들여다볼 수 있게 한다
    (window as unknown as { __erdRoom?: Room }).__erdRoom = r;
    return () => {
      r.destroy();
      setRoom(null);
    };
  }, [roomId]);

  if (!room) return null;
  return (
    <RoomContext.Provider value={room}>
      <RoomLayout entry={entry} />
    </RoomContext.Provider>
  );
}

export function RoomLayout({ entry = 'home' }: { entry?: EntryKind }) {
  const room = useRoomSync();
  const t = useT();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [layout, setLayout] = useRoomLayout();
  useRoomTelemetry(room.id, room.doc, entry, layout);
  const erdOpen = openPanes(layout).includes('erd');

  useErdFollow(setLayout);
  useEditorFollow(setLayout);
  useSaveKey();

  const paneTitle = useCallback((pane: PaneId) => t(paneTitleKey(pane)), [t]);
  // 패널 메뉴는 상단 바에 둔다. 좁은 화면에서는 상단 바에 자리가 없어서 pane 탭 줄 끝으로 옮긴다
  const paneMenu = <PaneMenu state={layout} onChange={setLayout} paneTitle={paneTitle} paneIcon={paneIcon} />;

  return (
    <div className="room" data-room-id={room.id}>
      <header className="room-top">
        <TopBar paneMenu={narrow ? undefined : paneMenu} />
      </header>
      <main className="room-body">
        <DockLayout
          state={layout}
          onChange={setLayout}
          renderPane={renderPane}
          paneTitle={paneTitle}
          paneIcon={paneIcon}
          narrow={narrow}
          narrowBarEnd={paneMenu}
        />
      </main>
      {/* 캔버스 단축키는 ERD pane이 열려 있을 때 한 번 건다. 어느 pane에서 누른 키인지는 canvas/paneScope가 가린다 */}
      {erdOpen && <ErdShortcuts />}
      <ContextMenu />
      <NicknameDialog />
      <BlockedNotice />
    </div>
  );
}

function paneIcon(pane: PaneId): ReactNode {
  return <PaneIcon pane={pane} />;
}

/**
 * pane 내용. 모듈 수준의 함수라서 언제나 같고, 배치가 바뀌어도 pane을 다시 그리지 않는다.
 * 관계 모델 쪽 pane은 포커스를 받을 수 있는 틀에 넣는다: 그 안을 누르면 포커스가 그 pane으로 옮겨 가서
 * (ERD에 남아 있던 포커스가 빠져서) 캔버스 단축키가 듣지 않는다.
 */
function renderPane(pane: PaneId): ReactNode {
  if (pane === 'erd') return <ErdPane />;
  let content: ReactNode;
  if (pane === 'relational') content = <RelationalTextPane />;
  else if (pane === 'ie') content = <IePane />;
  else content = <SqlPane />;
  return (
    <div className="room-pane" tabIndex={-1}>
      <Suspense fallback={<div className="room-pane-loading" aria-busy="true" />}>{content}</Suspense>
    </div>
  );
}

function ErdShortcuts() {
  useShortcuts();
  return null;
}

/** Ctrl/Cmd+S는 방 화면 어디서나 브라우저 저장 창 대신 자동 저장 안내를 띄운다(pane이 키 전파를 막기 전에 받는다) */
function useSaveKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleSaveKey(e);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

// ───────────── 배치 상태 ─────────────

/** 주소의 #relational 같은 해시(예전 보기 전환의 링크)가 가리키는 pane */
function paneFromHash(hash: string): PaneId | null {
  const h = hash.replace(/^#/, '').toLowerCase();
  return (PANE_IDS as readonly string[]).includes(h) ? (h as PaneId) : null;
}

function clearHash(): void {
  if (!location.hash) return;
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

/**
 * 이 브라우저에 저장된 배치를 읽고, 바뀌면 조금 기다렸다가 저장한다(나눔선을 끄는 동안 매번 쓰지 않는다).
 * 페이지를 떠나거나 방을 나갈 때는 기다리지 않고 바로 저장한다.
 * 예전 링크의 #relational, #sql 은 그 pane을 열어 보이게 하고 주소에서 지운다.
 */
function useRoomLayout(): [LayoutState, SetLayout] {
  const [layout, setLayout] = useState<LayoutState>(() => {
    const loaded = loadLayout();
    const pane = paneFromHash(location.hash);
    return pane ? openPane(loaded, pane) : loaded;
  });
  const initial = useRef(layout);
  const latest = useRef(layout);
  latest.current = layout;
  const pending = useRef(false);

  useEffect(() => {
    if (layout === initial.current) return;
    pending.current = true;
    const timer = setTimeout(() => {
      pending.current = false;
      saveLayout(latest.current);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [layout]);

  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      pending.current = false;
      saveLayout(latest.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  useEffect(() => {
    const onHash = () => {
      const pane = paneFromHash(location.hash);
      if (pane) setLayout((s) => openPane(s, pane));
      clearHash();
    };
    clearHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return [layout, setLayout];
}

/** ERD pane 안에서만 보이는 것(상단 바의 검증, 표기법, 도움말)을 열면 ERD pane을 열거나 보이게 한다 */
function useErdFollow(setLayout: SetLayout): void {
  useEffect(() => {
    return useUi.subscribe((s, prev) => {
      const opened =
        (s.panels.issues && !prev.panels.issues) ||
        (s.panels.legend && !prev.panels.legend) ||
        (s.panels.help && !prev.panels.help);
      if (opened) setLayout((l) => openPane(l, 'erd'));
    });
  }, [setLayout]);
}

/** 다른 pane이 관계 모델 편집기의 한 자리를 보여 달라고 하면(IE의 오류 배지, 테이블 누르기) 관계 모델 pane을 열거나 보이게 한다 */
function useEditorFollow(setLayout: SetLayout): void {
  useEffect(() => {
    return useRelPanes.subscribe((s, prev) => {
      if (s.reveal && s.reveal !== prev.reveal) setLayout((l) => openPane(l, 'relational'));
    });
  }, [setLayout]);
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    [query],
  );
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, get, () => false);
}

// ───────────── 그 밖 ─────────────

/** 서버의 접속 제한에 걸렸을 때 이유를 알리는 창 */
function BlockedNotice() {
  const room = useRoom();
  const reason = useBlockedReason();
  const t = useT();
  if (!reason) return null;
  const text = { title: t(`blocked.${reason}.title`), body: t(`blocked.${reason}.body`) };
  return (
    <div className="room-blocked-overlay" data-testid="blocked-notice" data-reason={reason}>
      <div className="panel room-blocked" role="alertdialog" aria-modal="true" aria-label={text.title}>
        <p className="room-blocked-title">{text.title}</p>
        <p className="room-blocked-body">{text.body}</p>
        <div className="room-blocked-actions">
          <button type="button" className="btn" onClick={() => navigate('/')}>
            {t('common.home')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => room.provider.connect()}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 선택/편집 상태를 다른 접속자에게 알리고, 지워진 요소를 선택에서 빼고, 최근 방 목록을 갱신한다. */
function useRoomSync(): Room {
  const room = useRoom();
  const title = useTitle();
  const t = useT();

  useEffect(() => {
    const push = () => {
      const s = useUi.getState();
      room.setPresence({ selection: s.selection, editing: s.editingId });
    };
    push();
    return useUi.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.editingId !== prev.editingId) push();
    });
  }, [room]);

  useEffect(() => {
    const unsubNodes = room.nodes.subscribe(() => pruneSelection(room));
    const unsubEdges = room.edges.subscribe(() => pruneSelection(room));
    return () => {
      unsubNodes();
      unsubEdges();
    };
  }, [room]);

  useEffect(() => {
    rememberRoom(room.id, title);
  }, [room, title]);

  // 브라우저 탭 제목. 제목이 없으면 현재 언어의 '제목 없는 다이어그램'을 쓰고, 언어를 바꾸면 따라 바뀐다
  useEffect(() => {
    document.title = `${title || t('doc.untitled')} | ${APP_NAME}`;
  }, [title, t]);

  return room;
}
