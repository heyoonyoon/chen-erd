/**
 * 첫 화면. 새 방 만들기, 코드로 들어가기, 최근 방 목록, 내 프로필.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { ROOM_ID_PATTERN, USER_COLORS } from '../../shared/types';
import { forgetRoom, getIdentity, getRecentRooms, saveIdentity, type RecentRoom } from '../identity';
import { navigate, newRoomId, roomPath } from '../router';
import { HomeNotation } from './HomeNotation';
import { HomePreview, NamedCursor } from './HomePreview';
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

/** 마름모 하나로 된 표식. 한 가지 색의 선으로만 그린다 */
function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="home-logo" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5 18 10l-8 7.5L2 10Z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

const FACTS: Array<{ title: string; body: string }> = [
  { title: '한 캔버스, 여러 포인터', body: '같은 방에 들어온 팀원의 포인터와 선택한 도형이 이름표와 함께 보입니다' },
  { title: '표기법 검증', body: '식별자가 없는 엔티티와 카디널리티가 빠진 선을 찾아 알려 줍니다' },
  { title: '보고서에 넣는 그림', body: 'PNG와 SVG로 저장하거나 클립보드로 복사해 문서에 붙여 넣습니다' },
];

export function Home() {
  const [me, setMe] = useState(getIdentity);
  const [name, setName] = useState(() => me.name.slice(0, NAME_MAX));
  const [joinValue, setJoinValue] = useState('');
  const [joinError, setJoinError] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const [now, setNow] = useState(() => Date.now());
  const joinRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const nameHintId = useId();
  const joinId = useId();
  const joinErrorId = useId();
  const recentTitleId = useId();
  const profileTitleId = useId();
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

  const shownName = name.trim() || '익명';
  const initial = name.trim().slice(0, 1) || '?';

  const focusField = (el: HTMLInputElement | null) => {
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };
  const focusName = () => focusField(nameRef.current);

  return (
    <div className="home">
      <nav className="home-nav" aria-label="상단">
        <div className="home-nav-inner">
          <div className="home-brand">
            <LogoMark />
            <span className="home-brand-name">Chen ERD</span>
          </div>
          <button type="button" className="home-me-chip" title="이름과 색 바꾸기" onClick={focusName}>
            <span className="home-avatar" style={{ background: me.color }}>
              {initial}
            </span>
            <span className="home-me-chip-name">{name.trim() || '이름 정하기'}</span>
          </button>
        </div>
      </nav>

      <main>
        <header className="home-hero">
          <div className="home-hero-inner">
            <div className="home-hero-copy">
              <h1 className="home-title">
                팀원과 함께 그리는
                <br />
                Chen ERD
              </h1>
              <p className="home-lead">
                링크만 공유하면 팀원이 바로 들어와 같은 화면에서 함께 그립니다. 수업에서 배운 Chen 표기법을 모두 지원합니다.
              </p>
              <div className="home-actions">
                <button type="button" className="home-create" data-testid="create-room" onClick={createRoom}>
                  새 다이어그램 만들기
                </button>
                <button type="button" className="home-link" onClick={() => focusField(joinRef.current)}>
                  초대 링크로 들어가기
                </button>
              </div>
            </div>
            <HomePreview />
          </div>
        </header>

        <div className="home-wrap">
          <div className="home-start">
            <section aria-labelledby={recentTitleId} data-testid={recent.length > 0 ? 'recent-rooms' : undefined}>
              <h2 id={recentTitleId} className="home-section-title">
                최근에 연 다이어그램
              </h2>
              {recent.length > 0 ? (
                <ul className="home-recent">
                  {recent.map((room) => {
                    const title = (typeof room.title === 'string' && room.title.trim()) || UNTITLED;
                    const when = relativeTime(room.visitedAt, now);
                    return (
                      <li key={room.id} className="home-recent-item">
                        <a className="home-recent-link" href={roomPath(room.id)} data-testid="recent-room" onClick={(e) => openRecent(e, room.id)}>
                          <span className="home-recent-main">
                            <span className="home-recent-title">{title}</span>
                            <span className="home-recent-code">{room.id}</span>
                          </span>
                          {when && (
                            <time
                              className="home-recent-time"
                              dateTime={new Date(room.visitedAt).toISOString()}
                              title={new Date(room.visitedAt).toLocaleString('ko-KR')}
                            >
                              {when}
                            </time>
                          )}
                        </a>
                        <button
                          type="button"
                          className="home-recent-forget"
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
              ) : (
                <div className="home-empty">
                  <p className="home-empty-title">아직 연 다이어그램이 없습니다</p>
                  <p className="home-empty-body">새로 만들거나 초대 링크로 들어간 다이어그램이 여기에 쌓입니다</p>
                </div>
              )}
            </section>

            <aside className="home-side">
              <section className="home-join" aria-label="초대 링크로 들어가기">
                <label className="home-label" htmlFor={joinId}>
                  초대 링크나 방 코드로 들어가기
                </label>
                <div className="home-join-row">
                  <input
                    id={joinId}
                    ref={joinRef}
                    className={joinError ? 'home-input is-invalid' : 'home-input'}
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
                  <button type="button" className="home-btn" data-testid="join-button" onClick={join}>
                    들어가기
                  </button>
                </div>
                {joinError && (
                  <p id={joinErrorId} className="home-error" role="alert" data-testid="join-error">
                    방 코드 형식이 올바르지 않습니다
                  </p>
                )}
              </section>

              <section className="home-profile" aria-labelledby={profileTitleId}>
                <h2 id={profileTitleId} className="home-section-title">
                  내 프로필
                </h2>
                <div className="home-profile-preview" aria-hidden="true">
                  <NamedCursor name={shownName} color={me.color} />
                </div>
                <label className="home-label" htmlFor={nameId}>
                  내 이름
                </label>
                <input
                  id={nameId}
                  ref={nameRef}
                  className="home-input"
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
                <p id={nameHintId} className="home-hint">
                  다른 팀원 화면에 이 이름과 색으로 표시됩니다
                </p>
              </section>
            </aside>
          </div>

          <section className="home-facts" aria-label="주요 기능">
            {FACTS.map((f) => (
              <div key={f.title} className="home-fact">
                <h3 className="home-fact-title">{f.title}</h3>
                <p className="home-fact-body">{f.body}</p>
              </div>
            ))}
          </section>

          <section className="home-notation" aria-labelledby={notationTitleId}>
            <h2 id={notationTitleId} className="home-section-title">
              지원하는 표기
            </h2>
            <p className="home-section-sub">선 옆의 1, M, N과 단선, 이중선으로 카디널리티와 참여 제약을 나타냅니다</p>
            <HomeNotation />
          </section>
        </div>
      </main>

      <footer className="home-foot">
        <div className="home-foot-inner">
          <span className="home-foot-brand">
            <LogoMark size={16} />
            Chen ERD
          </span>
          <span>링크를 아는 사람은 누구나 편집할 수 있습니다. 변경 내용은 자동으로 저장됩니다.</span>
        </div>
      </footer>
    </div>
  );
}
