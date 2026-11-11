/**
 * 첫 화면. 새 방 만들기, 코드로 들어가기, 최근 방 목록, 내 프로필.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { ROOM_ID_PATTERN, USER_COLORS } from '../../shared/types';
import { APP_NAME, formatDateTime, formatNumber, useT, type MessageKey } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { forgetRoom, getIdentity, getRecentRooms, saveIdentity, type RecentRoom } from '../identity';
import { navigate, newRoomId, roomPath } from '../router';
import { REPO_URL, formatStars, useGithubStars } from './githubStars';
import { HomeNotation } from './HomeNotation';
import { HomePreview, NamedCursor } from './HomePreview';
import { extractRoomId, relativeTime } from './homeUtils';
import { Reveal } from './motion';
import './Home.css';

const NAME_MAX = 20;
/** USER_COLORS와 같은 순서의 색 이름(화면 낭독기용) */
const COLOR_NAMES: MessageKey[] = [
  'color.red',
  'color.orange',
  'color.yellow',
  'color.green',
  'color.teal',
  'color.sky',
  'color.blue',
  'color.purple',
  'color.pink',
  'color.brown',
];

/** 주소로 갈 수 없는 id가 섞여 있으면 뺀다 */
function loadRecent(): RecentRoom[] {
  return getRecentRooms().filter((r) => ROOM_ID_PATTERN.test(r.id));
}

/** 마름모 하나로 된 표식. 한 가지 색의 선으로만 그린다 */
function LogoMark() {
  return (
    <svg className="home-logo" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5 18 10l-8 7.5L2 10Z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

/** GitHub 저장소로 가는 링크. 별 수를 알면 숫자를, 모르면 이름을 로고 옆에 적는다 */
function GithubLink() {
  const t = useT();
  const stars = useGithubStars();
  return (
    <a
      className="home-gh"
      href={REPO_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={stars === null ? t('home.github.open') : t('home.github.openWithStars', { count: stars, stars: formatNumber(stars) })}
      data-testid="github-link"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      <span className="home-gh-count">{stars === null ? 'GitHub' : formatStars(stars)}</span>
    </a>
  );
}

const FACTS: Array<{ title: MessageKey; body: MessageKey }> = [
  { title: 'home.fact.pointers.title', body: 'home.fact.pointers.body' },
  { title: 'home.fact.validation.title', body: 'home.fact.validation.body' },
  { title: 'home.fact.export.title', body: 'home.fact.export.body' },
];

export function Home() {
  const t = useT();
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

  // 검색 엔진이 그린 뒤의 제목을 쓰므로 이름만이 아니라 무엇을 하는 곳인지까지 적는다
  const pageTitle = t('home.pageTitle');
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

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

  const shownName = name.trim() || t('presence.anonymous');
  const initial = name.trim().slice(0, 1) || '?';

  const focusField = (el: HTMLInputElement | null) => {
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };
  const focusName = () => focusField(nameRef.current);

  return (
    <div className="home">
      <nav className="home-nav" aria-label={t('home.nav.label')}>
        <div className="home-nav-inner">
          <div className="home-nav-start">
            <div className="home-brand">
              <LogoMark />
              <span className="home-brand-name">{APP_NAME}</span>
            </div>
            <GithubLink />
          </div>
          <div className="home-nav-end">
            <LanguageSelect className="home-lang" />
            <button type="button" className="home-me-chip" title={t('home.profile.edit')} onClick={focusName}>
              <span className="home-avatar" style={{ background: me.color }}>
                {initial}
              </span>
              <span className="home-me-chip-name">{name.trim() || t('home.profile.setName')}</span>
            </button>
          </div>
        </div>
      </nav>

      <main>
        <header className="home-hero">
          <div className="home-hero-inner">
            <div className="home-hero-copy">
              {/* 줄을 나누는 자리는 언어마다 다르므로 두 줄을 따로 번역한다 */}
              <h1 className="home-title">
                {t('home.hero.title1')}
                <br />
                {t('home.hero.title2')}
              </h1>
              <p className="home-lead">{t('home.hero.lead')}</p>
              <div className="home-actions">
                <button type="button" className="home-create" data-testid="create-room" onClick={createRoom}>
                  {t('home.hero.create')}
                </button>
                <button type="button" className="home-link" onClick={() => focusField(joinRef.current)}>
                  {t('home.hero.join')}
                </button>
              </div>
            </div>
            <HomePreview />
          </div>
        </header>

        <div className="home-wrap">
          <div className="home-start">
            <Reveal as="section" aria-labelledby={recentTitleId} data-testid={recent.length > 0 ? 'recent-rooms' : undefined}>
              <h2 id={recentTitleId} className="home-section-title">
                {t('home.recent.title')}
              </h2>
              {recent.length > 0 ? (
                <ul className="home-recent">
                  {recent.map((room) => {
                    const title = (typeof room.title === 'string' && room.title.trim()) || t('doc.untitled');
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
                              title={formatDateTime(room.visitedAt)}
                            >
                              {when}
                            </time>
                          )}
                        </a>
                        <button
                          type="button"
                          className="home-recent-forget"
                          title={t('home.recent.forgetTitle')}
                          aria-label={t('home.recent.forgetLabel', { title })}
                          data-testid="forget-room"
                          onClick={() => forget(room.id)}
                        >
                          {t('home.recent.forget')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="home-empty">
                  <p className="home-empty-title">{t('home.recent.emptyTitle')}</p>
                  <p className="home-empty-body">{t('home.recent.emptyBody')}</p>
                </div>
              )}
              <p className="home-hint" data-testid="recent-expiry">
                {t('home.recent.expiry')}
              </p>
            </Reveal>

            <Reveal as="aside" className="home-side" delay={80}>
              <section className="home-join" aria-label={t('home.hero.join')}>
                <label className="home-label" htmlFor={joinId}>
                  {t('home.join.label')}
                </label>
                <div className="home-join-row">
                  <input
                    id={joinId}
                    ref={joinRef}
                    className={joinError ? 'home-input is-invalid' : 'home-input'}
                    type="text"
                    value={joinValue}
                    placeholder={t('home.join.placeholder')}
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
                    {t('home.join.submit')}
                  </button>
                </div>
                {joinError && (
                  <p id={joinErrorId} className="home-error" role="alert" data-testid="join-error">
                    {t('home.join.error')}
                  </p>
                )}
              </section>

              <section className="home-profile" aria-labelledby={profileTitleId}>
                <h2 id={profileTitleId} className="home-section-title">
                  {t('home.profile.title')}
                </h2>
                <div className="home-profile-preview" aria-hidden="true">
                  <NamedCursor name={shownName} color={me.color} />
                </div>
                <label className="home-label" htmlFor={nameId}>
                  {t('home.profile.name')}
                </label>
                <input
                  id={nameId}
                  ref={nameRef}
                  className="home-input"
                  type="text"
                  value={name}
                  maxLength={NAME_MAX}
                  placeholder={t('nickname.name')}
                  autoComplete="nickname"
                  spellCheck={false}
                  aria-describedby={nameHintId}
                  data-testid="name-input"
                  onChange={onNameChange}
                />
                <div className="home-colors" role="group" aria-label={t('home.profile.color')}>
                  {USER_COLORS.map((color, i) => {
                    const active = color.toLowerCase() === me.color.toLowerCase();
                    const label = COLOR_NAMES[i] ? t(COLOR_NAMES[i]) : t('home.profile.colorN', { n: i + 1 });
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
                  {t('home.profile.hint')}
                </p>
              </section>
            </Reveal>
          </div>

          <section className="home-facts" aria-label={t('home.facts.label')}>
            {FACTS.map((f, i) => (
              <Reveal key={f.title} className="home-fact" delay={i * 80}>
                <h3 className="home-fact-title">{t(f.title)}</h3>
                <p className="home-fact-body">{t(f.body)}</p>
              </Reveal>
            ))}
          </section>

          <section className="home-notation" aria-labelledby={notationTitleId}>
            <Reveal>
              <h2 id={notationTitleId} className="home-section-title">
                {t('home.notation.title')}
              </h2>
              <p className="home-section-sub">{t('home.notation.sub')}</p>
            </Reveal>
            <HomeNotation />
          </section>
        </div>
      </main>
    </div>
  );
}
