/**
 * 첫 화면. 새 방 만들기, 코드로 들어가기, 최근 방 목록. [담당: home 에이전트]
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { NODE_PRESETS, PRESET_ORDER, ROOM_ID_PATTERN, USER_COLORS } from '../../shared/types';
import { PresetIcon } from '../canvas/PresetIcon';
import { forgetRoom, getIdentity, getRecentRooms, saveIdentity, type RecentRoom } from '../identity';
import { navigate, newRoomId, roomPath } from '../router';
import { extractRoomId, relativeTime } from './homeUtils';
import './Home.css';

const NAME_MAX = 20;
const UNTITLED = '제목 없는 다이어그램';
/** USER_COLORS와 같은 순서의 색 이름(화면 낭독기용) */
const COLOR_NAMES = ['빨강', '주황', '노랑', '초록', '청록', '하늘', '파랑', '보라', '분홍', '갈색'];

/** 주소로 갈 수 없는 id가 섞여 있으면 뺀다 */
function loadRecent(): RecentRoom[] {
  return getRecentRooms().filter((r) => ROOM_ID_PATTERN.test(r.id));
}

function Logo() {
  return (
    <svg className="home-logo" width="68" height="32" viewBox="0 0 68 32" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M18 16H26M42 16H50" />
        <rect x="2" y="9" width="16" height="14" fill="var(--bg-panel)" />
        <path d="M34 7L42 16L34 25L26 16Z" fill="var(--bg-panel)" strokeLinejoin="round" />
        <ellipse cx="58" cy="16" rx="8" ry="6" fill="var(--bg-panel)" />
      </g>
    </svg>
  );
}

export function Home() {
  const [me, setMe] = useState(getIdentity);
  const [name, setName] = useState(() => me.name.slice(0, NAME_MAX));
  const [joinValue, setJoinValue] = useState('');
  const [joinError, setJoinError] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const [now, setNow] = useState(() => Date.now());
  const joinRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const nameHintId = useId();
  const joinId = useId();
  const joinErrorId = useId();
  const recentTitleId = useId();
  const notationTitleId = useId();

  useEffect(() => {
    document.title = 'Chen ERD';
  }, []);

  // 다른 탭에서 방을 열거나 시간이 흐르면 최근 목록과 "N분 전" 표시를 맞춘다
  useEffect(() => {
    const refresh = () => {
      setRecent(loadRecent());
      setNow(Date.now());
    };
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const onNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.slice(0, NAME_MAX);
    setName(value);
    setMe(saveIdentity({ name: value.trim() }));
  };

  const createRoom = () => navigate(roomPath(newRoomId()));

  const join = () => {
    const id = extractRoomId(joinValue);
    if (!id) {
      setJoinError(true);
      joinRef.current?.focus();
      return;
    }
    navigate(roomPath(id));
  };

  const onJoinKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // 한글 조합 중의 Enter는 글자 확정이다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    join();
  };

  const openRecent = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    // 새 탭으로 열기 같은 브라우저 기본 동작은 그대로 둔다
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(roomPath(id));
  };

  const forget = (id: string) => {
    forgetRoom(id);
    setRecent(loadRecent());
  };

  return (
    <div className="home">
      <main className="home-inner">
        <header className="home-head">
          <div className="home-brand">
            <Logo />
            <h1 className="home-name">Chen ERD</h1>
          </div>
          <p className="home-intro">Chen 표기법 ER 다이어그램을 여럿이 동시에 그리는 도구입니다</p>
        </header>

        <section className="panel home-card" aria-label="내 정보">
          <label className="home-label" htmlFor={nameId}>
            내 이름
          </label>
          <div className="home-me">
            <input
              id={nameId}
              className="input home-name-input"
              type="text"
              value={name}
              maxLength={NAME_MAX}
              placeholder="이름"
              autoComplete="nickname"
              spellCheck={false}
              aria-describedby={nameHintId}
              data-testid="name-input"
              onChange={onNameChange}
            />
            <div className="home-colors" role="group" aria-label="내 색">
              {USER_COLORS.map((color, i) => {
                const active = color.toLowerCase() === me.color.toLowerCase();
                const label = COLOR_NAMES[i] ?? `색 ${i + 1}`;
                return (
                  <button
                    key={color}
                    type="button"
                    className={active ? 'home-color is-active' : 'home-color'}
                    style={{ background: color }}
                    aria-label={label}
                    aria-pressed={active}
                    title={label}
                    data-testid="color-swatch"
                    onClick={() => setMe(saveIdentity({ color }))}
                  />
                );
              })}
            </div>
          </div>
          <p id={nameHintId} className="home-hint">
            다른 팀원 화면에 이 이름과 색으로 표시됩니다
          </p>
        </section>

        <section className="panel home-card" aria-label="시작">
          <button type="button" className="btn btn-primary home-create" data-testid="create-room" onClick={createRoom}>
            새 다이어그램 만들기
          </button>
          <div className="home-join">
            <label className="home-label" htmlFor={joinId}>
              초대 링크나 방 코드로 들어가기
            </label>
            <div className="home-join-row">
              <input
                id={joinId}
                ref={joinRef}
                className={joinError ? 'input home-join-input is-invalid' : 'input home-join-input'}
                type="text"
                value={joinValue}
                placeholder="초대 링크 또는 방 코드"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={joinError}
                aria-describedby={joinError ? joinErrorId : undefined}
                data-testid="join-input"
                onChange={(e) => {
                  setJoinValue(e.target.value);
                  setJoinError(false);
                }}
                onKeyDown={onJoinKeyDown}
              />
              <button type="button" className="btn home-join-button" data-testid="join-button" onClick={join}>
                들어가기
              </button>
            </div>
            {joinError && (
              <p id={joinErrorId} className="home-error" role="alert" data-testid="join-error">
                방 코드 형식이 올바르지 않습니다
              </p>
            )}
          </div>
        </section>

        {recent.length > 0 && (
          <section className="home-section" aria-labelledby={recentTitleId} data-testid="recent-rooms">
            <h2 id={recentTitleId} className="home-section-title">
              최근에 연 다이어그램
            </h2>
            <ul className="panel home-recent">
              {recent.map((room) => {
                const title = (typeof room.title === 'string' && room.title.trim()) || UNTITLED;
                const when = relativeTime(room.visitedAt, now);
                return (
                  <li key={room.id} className="home-recent-item">
                    <a
                      className="home-recent-link"
                      href={roomPath(room.id)}
                      data-testid="recent-room"
                      onClick={(e) => openRecent(e, room.id)}
                    >
                      <span className="home-recent-title">{title}</span>
                      <span className="home-recent-meta">
                        <span className="home-recent-code">{room.id}</span>
                        {when && (
                          <time
                            className="home-recent-time"
                            dateTime={new Date(room.visitedAt).toISOString()}
                            title={new Date(room.visitedAt).toLocaleString('ko-KR')}
                          >
                            {when}
                          </time>
                        )}
                      </span>
                    </a>
                    <button
                      type="button"
                      className="btn btn-ghost home-recent-forget"
                      title="이 목록에서만 지웁니다. 다이어그램 자체는 지워지지 않습니다"
                      aria-label={`${title} 목록에서 지우기`}
                      data-testid="forget-room"
                      onClick={() => forget(room.id)}
                    >
                      목록에서 지우기
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="home-section" aria-labelledby={notationTitleId}>
          <h2 id={notationTitleId} className="home-section-title">
            지원하는 표기
          </h2>
          <div className="panel home-card">
            <ul className="home-presets">
              {PRESET_ORDER.map((id) => (
                <li key={id} className="home-preset">
                  <PresetIcon presetId={id} size={28} />
                  <span className="home-preset-label">{NODE_PRESETS[id].label}</span>
                </li>
              ))}
            </ul>
            <p className="home-hint">선 옆의 1, M, N과 단선, 이중선으로 카디널리티와 참여 제약을 나타냅니다</p>
          </div>
        </section>

        <footer className="home-foot">
          링크를 아는 사람은 누구나 편집할 수 있습니다. 변경 내용은 자동으로 저장됩니다.
        </footer>
      </main>
    </div>
  );
}
