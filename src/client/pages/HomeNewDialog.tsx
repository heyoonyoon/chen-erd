/**
 * 첫 화면의 "새 다이어그램 만들기"를 누르면 뜨는 창. 빈 다이어그램으로 바로 시작할지, 다른 도구의 ERD를 AI로 옮겨 올지 고른다.
 * 옮기기를 고르면 같은 창이 단계별 안내로 바뀐다: 이미지로 저장, AI에 첨부하고 지시문 붙이기, 알려 준 주소로 들어가기.
 * 창은 첫 화면(.home) 안에 그려서 첫 화면의 색과 글자 크기를 그대로 쓴다.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { remoteMcpUrl } from '../ai';
import { useT } from '../i18n';
import { track } from '../telemetry';
import { Snippet } from './HomeAi';

type View = 'choose' | 'migrate';
type Way = 'cli' | 'chat';

const WAYS: Way[] = ['cli', 'chat'];

/** 닫힐 때 사라지는 움직임의 길이(ms). Home.css의 home-dialog-out과 같다 */
const CLOSE_MS = 140;

function reducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])';

export function NewDiagramDialog({ onClose, onBlank }: { onClose: () => void; onBlank: () => void }) {
  const t = useT();
  const [view, setView] = useState<View>('choose');
  const [way, setWay] = useState<Way>('cli');
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const blankRef = useRef<HTMLButtonElement>(null);
  const migrateRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const titleId = useId();
  const descId = useId();
  const tabsId = useId();
  /** 직전에 포커스를 맞춘 화면. 처음에는 첫 선택지에, 화면이 바뀐 뒤에는 그 화면의 제목이나 방금 나온 선택지에 포커스를 둔다 */
  const focusedView = useRef<View | null>(null);

  const close = () => {
    if (closing) return;
    if (reducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  };

  // 창 밖의 키 처리기가 항상 최신 close를 보게 한다
  const latestClose = useRef(close);
  latestClose.current = close;

  // 연 버튼으로 포커스를 돌려준다(빈 다이어그램을 골라 다른 화면으로 가면 버튼이 없으므로 돌려주지 않는다)
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const prev = focusedView.current;
    focusedView.current = view;
    if (prev === view) return;
    if (prev === null) blankRef.current?.focus();
    else if (view === 'migrate') titleRef.current?.focus();
    else migrateRef.current?.focus();
  }, [view]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        latestClose.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // 포커스가 창 밖으로 나가지 않게 처음과 끝에서 돌린다
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !panel.contains(active) || !items.includes(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const openMigrate = () => {
    track('migrate_open');
    setView('migrate');
  };

  const onTabsKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = WAYS.indexOf(way);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % WAYS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + WAYS.length) % WAYS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = WAYS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setWay(WAYS[next]);
    tabRefs.current[next]?.focus();
  };

  const closeButton = (
    <button type="button" className="home-dialog-close" aria-label={t('common.close')} title={t('common.close')} data-testid="new-dialog-close" onClick={close}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );

  return (
    <div
      className={closing ? 'home-dialog-overlay is-closing' : 'home-dialog-overlay'}
      data-testid="new-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // 바깥을 눌러도 포커스가 창 밖의 버튼으로 옮겨 가지 않게 한다
        e.preventDefault();
        close();
      }}
    >
      <div
        ref={panelRef}
        className={view === 'migrate' ? 'home-dialog is-wide' : 'home-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid={view === 'migrate' ? 'migrate-dialog' : 'new-dialog'}
      >
        {view === 'choose' ? (
          <>
            <div className="home-dialog-head">
              <div>
                <h2 id={titleId} className="home-dialog-title">
                  {t('home.new.title')}
                </h2>
                <p id={descId} className="home-dialog-lead">
                  {t('home.new.lead')}
                </p>
              </div>
              {closeButton}
            </div>
            <div className="home-dialog-body">
              <div className="home-choices">
                <button ref={blankRef} type="button" className="home-choice" data-testid="new-blank" onClick={onBlank}>
                  <span className="home-choice-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="3" width="14" height="14" rx="3" />
                      <path d="M10 7v6M7 10h6" />
                    </svg>
                  </span>
                  <span className="home-choice-title">{t('home.new.blank.title')}</span>
                  <span className="home-choice-body">{t('home.new.blank.body')}</span>
                </button>
                <button ref={migrateRef} type="button" className="home-choice" data-testid="new-migrate" onClick={openMigrate}>
                  <span className="home-choice-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2.5" y="4" width="7" height="12" rx="2" />
                      <path d="M12 10h5.5M15 7.5 17.5 10 15 12.5" />
                    </svg>
                  </span>
                  <span className="home-choice-title">{t('home.new.migrate.title')}</span>
                  <span className="home-choice-body">{t('home.new.migrate.body')}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="home-dialog-head">
              <div>
                <h2 id={titleId} ref={titleRef} tabIndex={-1} className="home-dialog-title">
                  {t('home.migrate.title')}
                </h2>
                <p id={descId} className="home-dialog-lead">
                  {t('home.migrate.lead')}
                </p>
              </div>
              {closeButton}
            </div>
            <div className="home-dialog-body">
              <ol className="home-steps">
                <li className="home-step">
                  <h3 className="home-step-title">{t('home.migrate.step1.title')}</h3>
                  <p className="home-step-body">{t('home.migrate.step1.body')}</p>
                </li>
                <li className="home-step">
                  <h3 className="home-step-title">{t('home.migrate.step2.title')}</h3>
                  <div className="home-tabs" role="tablist" aria-label={t('home.migrate.step2.title')} onKeyDown={onTabsKeyDown}>
                    {WAYS.map((w, i) => (
                      <button
                        key={w}
                        ref={(el) => {
                          tabRefs.current[i] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`${tabsId}-tab-${w}`}
                        className="home-tab"
                        data-testid={`migrate-tab-${w}`}
                        aria-selected={way === w}
                        aria-controls={`${tabsId}-panel-${w}`}
                        tabIndex={way === w ? 0 : -1}
                        onClick={() => setWay(w)}
                      >
                        {t(w === 'cli' ? 'home.migrate.cli.tab' : 'home.migrate.chat.tab')}
                      </button>
                    ))}
                  </div>
                  {way === 'cli' ? (
                    <div className="home-tab-panel" role="tabpanel" id={`${tabsId}-panel-cli`} aria-labelledby={`${tabsId}-tab-cli`} data-testid="migrate-panel-cli">
                      <p className="home-step-body">{t('home.migrate.cli.body')}</p>
                      <Snippet text={t('home.ai.migrate.prompt')} copyLabel={t('ai.cli.copy')} doneKey="toast.clipboardCopied" testId="migrate-cli" />
                    </div>
                  ) : (
                    <div className="home-tab-panel" role="tabpanel" id={`${tabsId}-panel-chat`} aria-labelledby={`${tabsId}-tab-chat`} data-testid="migrate-panel-chat">
                      <p className="home-step-body">{t('home.migrate.chat.mcp')}</p>
                      <Snippet text={remoteMcpUrl()} copyLabel={t('ai.mcp.copy')} doneKey="toast.urlCopied" testId="migrate-mcp" />
                      <p className="home-step-body">{t('home.migrate.chat.then')}</p>
                      <Snippet text={t('home.migrate.chat.prompt')} copyLabel={t('ai.cli.copy')} doneKey="toast.clipboardCopied" testId="migrate-chat" />
                    </div>
                  )}
                </li>
                <li className="home-step">
                  <h3 className="home-step-title">{t('home.migrate.step3.title')}</h3>
                  {/* 실제로 옮기는 모습. 개인 정보는 검게 가렸고 AI가 일하는 동안은 빨리 감았다 */}
                  <video
                    className="home-migrate-video"
                    src="/landing/migrate-demo.mp4"
                    poster="/landing/migrate-demo.jpg"
                    muted
                    playsInline
                    controls
                    preload="metadata"
                    aria-label={t('home.migrate.videoLabel')}
                    data-testid="migrate-video"
                  />
                </li>
              </ol>
            </div>
            <div className="home-dialog-foot">
              <button type="button" className="home-btn" data-testid="migrate-back" onClick={() => setView('choose')}>
                {t('home.migrate.back')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
