/**
 * 방 화면. 방 연결을 만들고 각 패널을 정해진 자리에 놓는다. (CORE 파일)
 * 패널 컴포넌트는 자기 위치를 스스로 잡지 않고, 여기의 slot 안에서 내용만 그린다.
 */
import { useEffect, useState } from 'react';
import { pruneSelection } from '../actions';
import { RoomContext, useBlockedReason, useRoom, useTitle } from '../collab/hooks';
import { createRoom, type Room } from '../collab/room';
import { Canvas } from '../canvas/Canvas';
import { Minimap, ZoomControls } from '../canvas/ViewportControls';
import { useShortcuts } from '../canvas/shortcuts';
import { APP_NAME, useT } from '../i18n';
import { getIdentity, rememberRoom } from '../identity';
import { NicknameDialog } from '../presence/NicknameDialog';
import { navigate } from '../router';
import { useUi } from '../state/ui';
import { ContextMenu } from '../ui/ContextMenu';
import { HelpOverlay } from '../ui/HelpOverlay';
import { Inspector } from '../ui/Inspector';
import { IssuesPanel } from '../ui/IssuesPanel';
import { Legend } from '../ui/Legend';
import { Toolbar } from '../ui/Toolbar';
import { TopBar } from '../ui/TopBar';
import './RoomPage.css';

export function RoomPage({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<Room | null>(null);

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
      <RoomLayout />
    </RoomContext.Provider>
  );
}

function RoomLayout() {
  const room = useRoomSync();
  const panels = useUi((s) => s.panels);
  const hasSelection = useUi((s) => s.selection.length > 0);
  useShortcuts();

  return (
    <div className="room" data-room-id={room.id}>
      <header className="room-top">
        <TopBar />
      </header>
      <main className="room-body" data-minimap={panels.minimap ? 'on' : 'off'}>
        <Canvas />
        <div className="slot slot-left">
          <Toolbar />
        </div>
        <div className="slot slot-right">
          {hasSelection && <Inspector />}
          {panels.issues && <IssuesPanel />}
          {panels.legend && <Legend />}
        </div>
        <div className="slot slot-bottom-left">
          <ZoomControls />
        </div>
        <div className="slot slot-bottom-right">{panels.minimap && <Minimap />}</div>
      </main>
      <ContextMenu />
      {panels.help && <HelpOverlay />}
      <NicknameDialog />
      <BlockedNotice />
    </div>
  );
}

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
