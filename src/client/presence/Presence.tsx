/**
 * 다른 접속자 표시. [담당: presence 에이전트]
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Peer, Point, UserInfo } from '../../shared/types';
import { clientToWorld, worldToScreen } from '../canvas/coords';
import { centerOn } from '../canvas/ViewportControls';
import { useMyPresence, useNodeMap, usePeers, useRoom } from '../collab/hooks';
import { getIdentity } from '../identity';
import { ui, useUi } from '../state/ui';
import { openNicknameDialog } from './NicknameDialog';
import {
  anchorOffset,
  buildRemoteRings,
  createThrottle,
  displayName,
  estimateTextWidth,
  initialOf,
  isPoint,
  locateCursor,
  roundPoint,
  safeColor,
} from './presenceMath';
import './Presence.css';

/**
 * 커서 위치를 보내는 최소 간격(ms). 초당 15회 정도.
 * 받는 쪽이 80ms 동안 이어서 움직이므로 이 간격에서도 끊겨 보이지 않는다. 서버가 방의 모든 사람에게 다시 보내므로 줄일수록 부하가 준다.
 */
export const CURSOR_INTERVAL_MS = 66;

/** ref 요소 위에서 움직이는 내 마우스 위치(월드 좌표)를 다른 접속자에게 보낸다. 벗어나면 null을 보낸다. 전송은 초당 30회 정도로 제한한다. */
export function useBroadcastCursor(ref: RefObject<Element | null>): void {
  const room = useRoom();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /** 마지막으로 본 마우스 위치(client 좌표). 요소 밖이면 null */
    let lastClient: Point | null = null;
    /** 마지막으로 보낸 값. 아직 보낸 적이 없으면 undefined */
    let sent: Point | null | undefined;

    const send = (cursor: Point | null) => {
      if (sent !== undefined) {
        if (cursor === null && sent === null) return;
        if (cursor && sent && cursor.x === sent.x && cursor.y === sent.y) return;
      }
      sent = cursor;
      room.setPresence({ cursor });
    };
    // 보내는 순간의 화면 상태로 월드 좌표를 계산한다. 화면을 밀거나 확대한 뒤에도 같은 경로를 쓴다.
    const sendCurrent = () => {
      if (!lastClient) return;
      send(roundPoint(clientToWorld(el, ui().viewport, lastClient.x, lastClient.y)));
    };
    const throttled = createThrottle(sendCurrent, CURSOR_INTERVAL_MS);

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      lastClient = { x: pe.clientX, y: pe.clientY };
      throttled();
    };
    const clear = () => {
      lastClient = null;
      throttled.cancel();
      send(null);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clear();
    };

    // 안쪽 요소가 전파를 막아도 받을 수 있게 캡처 단계에서 듣는다. 포인터 캡처 중인 드래그도 여기로 지나간다.
    el.addEventListener('pointermove', onMove, { capture: true, passive: true });
    el.addEventListener('pointerdown', onMove, { capture: true, passive: true });
    el.addEventListener('pointerleave', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = useUi.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport && lastClient) throttled();
    });

    return () => {
      el.removeEventListener('pointermove', onMove, { capture: true });
      el.removeEventListener('pointerdown', onMove, { capture: true });
      el.removeEventListener('pointerleave', clear);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      throttled.cancel();
      lastClient = null;
      // 방이 이미 닫혔으면(상태가 null) 다시 살리지 않는다
      if (room.awareness.getLocalState()) send(null);
    };
  }, [room, ref]);
}

/** 요소의 크기를 잰다. ResizeObserver가 없으면 처음 한 번만 잰다. */
function useElementSize(ref: RefObject<Element | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

type ColorStyle = CSSProperties & { '--presence-color': string };

function CursorArrow({ color }: { color: string }) {
  return (
    <svg className="presence-cursor-arrow" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 2 L16.5 7.5 L9.6 9.6 L7.5 16.5 Z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 다른 접속자의 마우스 포인터와 이름표. HTML 레이어(position:absolute; inset:0; pointer-events:none)로 그리며
 * Canvas가 .canvas-root 안에 놓는다. 배율과 무관하게 일정한 크기로 보인다.
 */
export function RemoteCursors() {
  const peers = usePeers();
  const viewport = useUi((s) => s.viewport);
  const canvasSize = useUi((s) => s.canvasSize);
  const layerRef = useRef<HTMLDivElement>(null);
  const measured = useElementSize(layerRef);
  const size = measured.w > 0 && measured.h > 0 ? measured : canvasSize;

  // 화면이 움직인 렌더에서는 보간을 끈다. 켜 두면 커서가 캔버스보다 늦게 따라온다.
  const prevViewport = useRef(viewport);
  const instant = prevViewport.current !== viewport;
  useEffect(() => {
    prevViewport.current = viewport;
  });

  return (
    <div ref={layerRef} className={instant ? 'presence-cursors is-instant' : 'presence-cursors'}>
      {peers.map((peer) => {
        if (!isPoint(peer.cursor)) return null;
        const place = locateCursor(worldToScreen(viewport, peer.cursor), size);
        const name = displayName(peer.user.name);
        const color = safeColor(peer.user.color);
        const style: ColorStyle = {
          '--presence-color': color,
          transform: `translate(${Math.round(place.x * 10) / 10}px, ${Math.round(place.y * 10) / 10}px)`,
        };
        return (
          <div
            key={peer.clientId}
            className="presence-cursor"
            data-testid={place.offscreen ? 'remote-cursor-edge' : 'remote-cursor'}
            data-user-name={name}
            data-client-id={peer.clientId}
            style={style}
          >
            {place.offscreen ? (
              <span
                className="presence-cursor-edge"
                style={{ transform: `translate(${anchorOffset(place.ax)}, ${anchorOffset(place.ay)})` }}
              >
                <span className="presence-cursor-edge-dot" />
                <span className="presence-cursor-edge-name">{name}</span>
              </span>
            ) : (
              <>
                <CursorArrow color={color} />
                <span className="presence-cursor-name">{name}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const LABEL_FONT = 11;
const LABEL_H = 18;
const LABEL_PAD_X = 6;
const LABEL_GAP = 3;

/** 다른 접속자가 선택했거나 편집 중인 도형에 그 사람 색의 테두리와 이름표를 그리는 SVG 레이어. Canvas의 월드 변환 <g> 안에 놓는다. */
export function RemoteSelections() {
  const peers = usePeers();
  const nodeMap = useNodeMap();
  const zoom = useUi((s) => s.viewport.zoom);

  // usePeers는 커서가 움직일 때마다 바뀐다. 선택과 관련된 값이 그대로면 다시 계산하지 않는다.
  const signature = peers
    .map((p) => `${p.clientId}\u0001${p.user.name}\u0001${p.user.color}\u0001${p.editing ?? ''}\u0001${p.selection.join('\u0002')}`)
    .join('\u0003');
  const peersRef = useRef<Peer[]>(peers);
  peersRef.current = peers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rings = useMemo(() => buildRemoteRings(peersRef.current, nodeMap, zoom), [signature, nodeMap, zoom]);

  return useMemo(() => {
    const inv = 1 / (zoom > 0 ? zoom : 1);
    return (
      <g pointerEvents="none" data-testid="remote-selections">
        {rings.map((r) => {
          const labelY = -(LABEL_H + LABEL_GAP) - r.stack * (LABEL_H + 2);
          return (
            // data-node-id는 도형 <g>의 식별자라 여기서는 쓰지 않는다
            <g key={r.key} data-testid="remote-selection" data-for-node={r.nodeId} data-editing={r.editing ? 'true' : undefined}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={2}
                fill="none"
                stroke={r.color}
                strokeWidth={2}
                strokeDasharray={r.editing ? '6 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {r.label && (
                // 이름표는 배율과 무관하게 화면에서 같은 크기로 보이게 1/zoom으로 되돌린다
                <g transform={`translate(${r.x} ${r.y}) scale(${inv})`}>
                  <rect
                    x={-1}
                    y={labelY}
                    width={estimateTextWidth(r.label, LABEL_FONT) + LABEL_PAD_X * 2}
                    height={LABEL_H}
                    rx={4}
                    fill={r.color}
                  />
                  <text
                    x={-1 + LABEL_PAD_X}
                    y={labelY + LABEL_H / 2}
                    dominantBaseline="central"
                    fontSize={LABEL_FONT}
                    fontWeight={600}
                    fill="#fff"
                    style={{ fontFamily: 'var(--font)', userSelect: 'none' }}
                  >
                    {r.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    );
  }, [rings, zoom]);
}

/** 아바타를 이만큼까지만 그리고 나머지는 +N으로 줄인다(나 포함). */
export const MAX_AVATARS = 6;

function Avatar({ user, me, clickable, onClick }: { user: UserInfo; me?: boolean; clickable: boolean; onClick(): void }) {
  const name = displayName(user.name);
  const style: ColorStyle = { '--presence-color': safeColor(user.color) };
  const className = ['presence-avatar', me ? 'is-me' : '', clickable ? 'is-clickable' : ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={className}
      data-testid="avatar"
      data-user-name={name}
      data-me={me ? 'true' : undefined}
      title={name}
      aria-label={me ? `${name} (나), 이름 바꾸기` : clickable ? `${name}, 이 사람 위치로 이동` : name}
      style={style}
      onClick={onClick}
    >
      {initialOf(user.name)}
    </button>
  );
}

/** 접속자 아바타 줄(나 포함). TopBar 오른쪽에 놓인다. 내 아바타를 누르면 이름을 바꿀 수 있다. */
export function UserAvatars() {
  const peers = usePeers();
  const me = useMyPresence();
  const myUser = me?.user ?? getIdentity();

  const shown = peers.slice(0, MAX_AVATARS - 1);
  const hidden = peers.slice(shown.length);

  return (
    <div className="presence-avatars" role="group" aria-label="접속자">
      <Avatar user={myUser} me clickable onClick={openNicknameDialog} />
      {shown.map((peer) => (
        <Avatar
          key={peer.clientId}
          user={peer.user}
          clickable={isPoint(peer.cursor)}
          onClick={() => {
            if (isPoint(peer.cursor)) centerOn(peer.cursor);
          }}
        />
      ))}
      {hidden.length > 0 && (
        <span
          className="presence-avatar presence-avatar-more"
          data-testid="avatar-more"
          title={hidden.map((p) => displayName(p.user.name)).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
    </div>
  );
}
