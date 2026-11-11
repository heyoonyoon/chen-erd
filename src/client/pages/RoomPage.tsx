/**
 * 방 화면. 방 연결을 만들고 각 패널을 정해진 자리에 놓는다. (CORE 파일)
 * 패널 컴포넌트는 자기 위치를 스스로 잡지 않고, 여기의 slot 안에서 내용만 그린다.
 */
import { useEffect, useState } from 'react';
import { pruneSelection } from '../actions';
import { RoomContext, useBlockedReason, useRoom, useTitle, type BlockedReason } from '../collab/hooks';
import { createRoom, type Room } from '../collab/room';
import { Canvas } from '../canvas/Canvas';
import { Minimap, ZoomControls } from '../canvas/ViewportControls';
import { useShortcuts } from '../canvas/shortcuts';
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

const BLOCKED_TEXT: Record<BlockedReason, { title: string; body: string }> = {
  connections: {
    title: '동시에 열 수 있는 창을 넘었습니다',
    body: '같은 네트워크에서 열어 둔 다이어그램 창이 너무 많습니다. 쓰지 않는 창을 닫고 다시 시도해 주세요.',
  },
  'room-full': {
    title: '방이 가득 찼습니다',
    body: '한 다이어그램에는 15명까지 함께 들어올 수 있습니다. 자리가 나면 자동으로 연결됩니다.',
  },
  'room-rate': {
    title: '새 다이어그램은 1분에 하나만 만들 수 있습니다',
    body: '잠시 뒤에 다시 시도해 주세요. 이미 만든 다이어그램에는 바로 들어갈 수 있습니다.',
  },
};

/** 서버의 접속 제한에 걸렸을 때 이유를 알리는 창 */
function BlockedNotice() {
  const room = useRoom();
  const reason = useBlockedReason();
  if (!reason) return null;
  const text = BLOCKED_TEXT[reason];
  return (
    <div className="room-blocked-overlay" data-testid="blocked-notice" data-reason={reason}>
      <div className="panel room-blocked" role="alertdialog" aria-modal="true" aria-label={text.title}>
        <p className="room-blocked-title">{text.title}</p>
        <p className="room-blocked-body">{text.body}</p>
        <div className="room-blocked-actions">
          <button type="button" className="btn" onClick={() => navigate('/')}>
            처음 화면으로
          </button>
          <button type="button" className="btn btn-primary" onClick={() => room.provider.connect()}>
            다시 시도
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
    document.title = title ? `${title} | Chen ERD` : 'Chen ERD';
  }, [room, title]);

  return room;
}
