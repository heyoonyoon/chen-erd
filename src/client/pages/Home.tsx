/**
 * 첫 화면. 새 방 만들기, 코드로 들어가기, 최근 방 목록, 내 프로필.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { NODE_PRESETS, PRESET_ORDER, ROOM_ID_PATTERN, USER_COLORS } from '../../shared/types';
import { PresetIcon } from '../canvas/PresetIcon';
import { forgetRoom, getIdentity, getRecentRooms, saveIdentity, type RecentRoom } from '../identity';
import { navigate, newRoomId, roomPath } from '../router';
import { HomePreview } from './HomePreview';
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

function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="home-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M16 7.5 25 16l-9 8.5L7 16Z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

const icon = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const FEATURES: Array<{ title: string; body: string; icon: ReactNode }> = [
  {
    title: '함께 그리기',
    body: '같은 방에 들어온 팀원의 마우스 포인터와 선택한 도형이 실시간으로 보입니다.',
    icon: icon(
      <>
        <path d="M4 3l4.2 11 1.8-4.6 4.6-1.8z" />
        <path d="M13.5 13.5l3 3" />
      </>,
    ),
  },
  {
    title: '수업 표기 그대로',
    body: '이중 사각형과 이중 마름모, 밑줄과 점선 타원, d와 o 특수화까지 Chen 표기법을 빠짐없이 지원합니다.',
    icon: icon(
      <>
        <rect x="2" y="7" width="6" height="6" />
        <path d="M14 6l4 4-4 4-4-4z" />
        <path d="M8 10h2" />
      </>,
    ),
  },
  {
    title: '표기법 검증',
    body: '식별자가 없는 엔티티나 카디널리티가 빠진 선처럼 놓치기 쉬운 부분을 찾아 알려 줍니다.',
    icon: icon(
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M6.8 10.2l2.2 2.2 4.2-4.6" />
      </>,
    ),
  },
  {
    title: '보고서용 내보내기',
    body: '선명한 PNG와 SVG로 저장하거나 클립보드에 복사해 문서에 바로 붙여 넣습니다.',
    icon: icon(
      <>
        <path d="M10 3v9" />
        <path d="M6.5 8.5L10 12l3.5-3.5" />
        <path d="M4 15.5h12" />
      </>,
    ),
  },
];

/** 최근 방 카드의 작은 그림. 방마다 조금씩 다르게 보이도록 id로 모양을 고른다 */
function Thumb({ seed }: { seed: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const v = h % 3;
  return (
    <svg className="home-thumb" viewBox="0 0 220 96" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="#fff" stroke="currentColor" strokeWidth="1.4">
        {v === 0 && (
          <>
            <path d="M62 48h28M130 48h28" />
            <rect x="26" y="34" width="36" height="28" />
            <path d="M110 30l20 18-20 18-20-18z" />
            <rect x="158" y="34" width="36" height="28" />
            <path d="M44 34V22" />
            <ellipse cx="44" cy="15" rx="16" ry="7" />
          </>
        )}
        {v === 1 && (
          <>
            <path d="M110 40v10M100 62l-34 12M120 62l34 12M80 26h-14" />
            <rect x="80" y="12" width="60" height="28" />
            <circle cx="110" cy="58" r="8" />
            <rect x="40" y="70" width="52" height="20" />
            <rect x="128" y="70" width="52" height="20" />
            <ellipse cx="46" cy="26" rx="20" ry="8" />
          </>
        )}
        {v === 2 && (
          <>
            <path d="M76 30h22M142 30h22M120 48v14" />
            <rect x="34" y="16" width="42" height="28" />
            <path d="M120 12l22 18-22 18-22-18z" />
            <rect x="164" y="16" width="42" height="28" />
            <rect x="96" y="62" width="48" height="24" />
          </>
        )}
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

  return (
    <div className="home">
      <nav className="home-nav" aria-label="상단">
        <div className="home-brand">
          <LogoMark />
          <span className="home-brand-name">Chen ERD</span>
        </div>
        <button
          type="button"
          className="home-me-chip"
          title="이름과 색 바꾸기"
          onClick={() => {
            nameRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            nameRef.current?.focus({ preventScroll: true });
          }}
        >
          <span className="home-avatar" style={{ background: me.color }}>
            {initial}
          </span>
          <span className="home-me-chip-name">{name.trim() || '이름 정하기'}</span>
        </button>
      </nav>

      <main>
        <header className="home-hero">
          <div className="home-hero-inner">
            <div className="home-hero-copy">
              <span className="home-eyebrow">실시간 협업 ERD 도구</span>
              <h1 className="home-title">
                Chen 표기법 ERD를
                <br />
                팀과 동시에 그립니다
              </h1>
              <p className="home-lead">
                링크 하나로 팀원을 초대해 같은 캔버스에서 함께 그립니다. 엔티티와 관계, 속성부터 약한 엔티티와 특수화까지 수업에서 배운 표기를
                그대로 씁니다.
              </p>

              <div className="home-start" aria-label="시작">
                <button type="button" className="btn btn-primary home-create" data-testid="create-room" onClick={createRoom}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
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
              </div>

              <ul className="home-points">
                <li>설치와 가입 없이 바로 시작</li>
                <li>변경 내용 자동 저장</li>
                <li>링크로 팀원 초대</li>
              </ul>
            </div>

            <HomePreview />
          </div>
        </header>

        <div className="home-body">
          <div className="home-columns">
            <div className="home-main-col">
              {recent.length > 0 ? (
                <section className="home-section" aria-labelledby={recentTitleId} data-testid="recent-rooms">
                  <h2 id={recentTitleId} className="home-section-title">
                    최근에 연 다이어그램
                  </h2>
                  <ul className="home-recent">
                    {recent.map((room) => {
                      const title = (typeof room.title === 'string' && room.title.trim()) || UNTITLED;
                      const when = relativeTime(room.visitedAt, now);
                      return (
                        <li key={room.id} className="home-recent-item">
                          <a className="home-recent-link" href={roomPath(room.id)} data-testid="recent-room" onClick={(e) => openRecent(e, room.id)}>
                            <Thumb seed={room.id} />
                            <span className="home-recent-text">
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
                            </span>
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
                </section>
              ) : (
                <section className="home-section">
                  <h2 className="home-section-title">최근에 연 다이어그램</h2>
                  <div className="home-empty">
                    <Thumb seed="empty" />
                    <p className="home-empty-title">아직 연 다이어그램이 없습니다</p>
                    <p className="home-empty-body">새 다이어그램을 만들면 이곳에 표시되어 다음에 바로 이어서 그릴 수 있습니다.</p>
                  </div>
                </section>
              )}
            </div>

            <aside className="home-side-col">
              <section className="home-section" aria-labelledby={profileTitleId}>
                <h2 id={profileTitleId} className="home-section-title">
                  내 프로필
                </h2>
                <div className="home-profile">
                  <div className="home-profile-preview" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 20 20">
                      <path d="M3 2l5.2 14.2 2.3-5.9 5.9-2.3z" fill={me.color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    <span style={{ background: me.color }}>{shownName}</span>
                  </div>
                  <label className="home-label" htmlFor={nameId}>
                    내 이름
                  </label>
                  <input
                    id={nameId}
                    ref={nameRef}
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
                  <p id={nameHintId} className="home-hint">
                    다른 팀원 화면에 이 이름과 색으로 표시됩니다
                  </p>
                </div>
              </section>
            </aside>
          </div>

          <section className="home-section home-features" aria-label="주요 기능">
            {FEATURES.map((f) => (
              <article key={f.title} className="home-feature">
                <span className="home-feature-icon">{f.icon}</span>
                <h3 className="home-feature-title">{f.title}</h3>
                <p className="home-feature-body">{f.body}</p>
              </article>
            ))}
          </section>

          <section className="home-section" aria-labelledby={notationTitleId}>
            <h2 id={notationTitleId} className="home-section-title">
              지원하는 표기
            </h2>
            <ul className="home-presets">
              {PRESET_ORDER.map((id) => (
                <li key={id} className="home-preset">
                  <PresetIcon presetId={id} size={24} />
                  <span className="home-preset-label">{NODE_PRESETS[id].label}</span>
                </li>
              ))}
            </ul>
            <p className="home-hint">선 옆의 1, M, N과 단선, 이중선으로 카디널리티와 참여 제약을 나타냅니다</p>
          </section>
        </div>
      </main>

      <footer className="home-foot">
        <div className="home-foot-inner">
          <span className="home-foot-brand">
            <LogoMark size={18} />
            Chen ERD
          </span>
          <span>링크를 아는 사람은 누구나 편집할 수 있습니다. 변경 내용은 자동으로 저장됩니다.</span>
        </div>
      </footer>
    </div>
  );
}
