/**
 * 상단 바. [담당: topbar 에이전트]
 * 왼쪽: 홈, 제목, 연결 상태, 실행 취소/다시 실행. 오른쪽: 검증, 표기법, 내보내기, AI로 편집, 공유, 도움말, 접속자.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { ErdEdge, ErdFile, ErdNode, Rect } from '../../shared/types';
import { redo, undo } from '../actions';
import { LOCAL_MCP_COMMAND, copyText, remoteMcpUrl } from '../ai';
import { zoomToRect } from '../canvas/ViewportControls';
import { setTitle } from '../collab/docOps';
import { useConnectionStatus, useNodes, useRoom, useSynced, useTitle, useUndoState } from '../collab/hooks';
import {
  copyPngToClipboard,
  downloadJson,
  downloadPng,
  downloadSvg,
  importErdFile,
  parseErdFile,
  safeFilename,
} from '../export/exporters';
import { APP_NAME, useT, type MessageKey } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { UserAvatars } from '../presence/Presence';
import { navigate, roomUrl } from '../router';
import { ui, useUi } from '../state/ui';
import { useIssueCount } from './IssuesPanel';
import { Toaster, toast } from './toast';
import './TopBar.css';

export const TITLE_MAX_LENGTH = 80;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = IS_MAC ? '⌘Z' : 'Ctrl+Z';
const REDO_KEYS = IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z';

// ───────────── 아이콘 ─────────────

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="topbar-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 사각형(엔티티), 마름모(관계), 타원(속성)을 선으로 이은 로고 */
function Logo() {
  return (
    <svg
      className="topbar-logo"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 14.5 9.5 9.5M18 14 14.5 9.5" />
      <path d="M12 2.5 17 7.25 12 12 7 7.25Z" fill="#fff" />
      <rect x="2" y="14.5" width="8" height="6.5" rx="0.5" fill="#fff" />
      <ellipse cx="18" cy="17.5" rx="4.5" ry="3.5" fill="#fff" />
    </svg>
  );
}

const icons = {
  undo: (
    <Icon>
      <path d="M4 6h6a3.5 3.5 0 0 1 0 7H6.5" />
      <path d="M6.5 3.5 4 6l2.5 2.5" />
    </Icon>
  ),
  redo: (
    <Icon>
      <path d="M12 6H6a3.5 3.5 0 0 0 0 7h3.5" />
      <path d="M9.5 3.5 12 6 9.5 8.5" />
    </Icon>
  ),
  check: (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.4 8.2 1.8 1.8 3.4-3.7" />
    </Icon>
  ),
  legend: (
    <Icon>
      <rect x="1.75" y="2.5" width="5.25" height="3.75" />
      <ellipse cx="11.5" cy="4.4" rx="2.75" ry="1.9" />
      <path d="M8 8.75 11.5 11.5 8 14.25 4.5 11.5Z" />
    </Icon>
  ),
  export: (
    <Icon>
      <path d="M8 2.5v7.5" />
      <path d="M5 7.25 8 10.25l3-3" />
      <path d="M2.75 10.5v1.75a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10.5" />
    </Icon>
  ),
  chevron: (
    <Icon size={12}>
      <path d="M4 6.25 8 10l4-3.75" />
    </Icon>
  ),
  link: (
    <Icon>
      <path d="M6.9 9.1a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.75.75" />
      <path d="M9.1 6.9a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.75-.75" />
    </Icon>
  ),
  help: (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.4a1.75 1.75 0 1 1 2.6 1.5c-.6.35-.9.7-.9 1.3" />
      <path d="M8 11.4v.05" />
    </Icon>
  ),
  image: (
    <Icon>
      <rect x="2.25" y="3" width="11.5" height="10" rx="1.25" />
      <circle cx="5.6" cy="6.2" r="1" />
      <path d="m2.5 11.5 3-3 2.25 2.25L9.75 8.75l3.75 3.75" />
    </Icon>
  ),
  copy: (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.25" />
      <path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5A1.25 1.25 0 0 0 3.75 10.5H5.5" />
    </Icon>
  ),
  vector: (
    <Icon>
      <path d="M3.75 10.75c0-4 3-7 7-7" />
      <rect x="2.25" y="10.75" width="3" height="3" />
      <rect x="10.75" y="2.25" width="3" height="3" />
    </Icon>
  ),
  fileDown: (
    <Icon>
      <path d="M4 2.5h5l3 3v8H4Z" />
      <path d="M9 2.5v3h3" />
      <path d="M8 7.75v3.5M6.5 9.9 8 11.4l1.5-1.5" />
    </Icon>
  ),
  fileUp: (
    <Icon>
      <path d="M4 2.5h5l3 3v8H4Z" />
      <path d="M9 2.5v3h3" />
      <path d="M8 11.4V7.9M6.5 9.4 8 7.9l1.5 1.5" />
    </Icon>
  ),
  ai: (
    <Icon>
      <path d="M7 2.25 8.3 5.7l3.45 1.3L8.3 8.3 7 11.75 5.7 8.3 2.25 7 5.7 5.7Z" />
      <path d="M12.25 10.5v3M10.75 12h3" />
    </Icon>
  ),
};

// ───────────── 공통 ─────────────

/** 열려 있는 동안 ref 바깥을 누르거나 Esc를 누르면 닫는다. onClose는 어느 쪽으로 닫혔는지를 받는다. */
function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: (reason: 'outside' | 'escape') => void,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) closeRef.current('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 이 Esc는 메뉴를 닫는 데만 쓴다(선택 해제 같은 전역 단축키로 넘기지 않는다)
      e.stopPropagation();
      closeRef.current('escape');
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, ref]);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function boundsOf(nodes: ErdNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w);
    y2 = Math.max(y2, n.y + n.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** 입력창 안의 키 입력이 전역 단축키로 새지 않게 한다. */
function stopKeys(e: ReactKeyboardEvent): void {
  e.stopPropagation();
}

// ───────────── 제목 ─────────────

function TitleInput() {
  const t = useT();
  const room = useRoom();
  const title = useTitle();
  // 입력 중일 때만 값이 있다. null이면 문서의 제목을 그대로 보여 준다(다른 사람이 바꾸면 바로 반영).
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const value = draft ?? title;

  const commit = (raw: string) => {
    const next = raw.trim().slice(0, TITLE_MAX_LENGTH);
    if (next !== title) setTitle(room.doc, next);
  };

  return (
    <label className="topbar-title">
      {/* 글자 길이만큼 입력창 너비를 맞추기 위한 보이지 않는 복사본 */}
      <span className="topbar-title-mirror" aria-hidden="true">
        {value || t('doc.untitled')}
      </span>
      <input
        className="topbar-title-input"
        data-testid="title-input"
        type="text"
        value={value}
        placeholder={t('doc.untitled')}
        maxLength={TITLE_MAX_LENGTH}
        spellCheck={false}
        autoComplete="off"
        aria-label={t('doc.titleLabel')}
        onFocus={() => {
          cancelled.current = false;
          setDraft(title);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (!cancelled.current) commit(e.currentTarget.value);
          cancelled.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'Enter') {
            // 한글 조합 중의 Enter는 글자 확정이다
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onKeyUp={stopKeys}
      />
    </label>
  );
}

// ───────────── 연결 상태 ─────────────

type ShownStatus = 'connected' | 'connecting' | 'disconnected';

function ConnectionBadge() {
  const t = useT();
  const status = useConnectionStatus();
  const synced = useSynced();
  // 연결은 됐지만 서버 문서를 아직 다 받지 못한 동안은 '연결 중'으로 보여 준다
  const shown: ShownStatus = status === 'connected' ? (synced ? 'connected' : 'connecting') : status;
  const text = { label: t(`status.${shown}.label`), hint: t(`status.${shown}.hint`) };
  return (
    <span
      className={`topbar-status topbar-status-${shown}`}
      data-testid="connection-status"
      data-status={shown}
      title={text.hint}
      role="status"
    >
      <span className="topbar-status-dot" />
      <span className="topbar-status-label">{text.label}</span>
    </span>
  );
}

// ───────────── 내보내기 ─────────────

function MenuItem(props: {
  icon: ReactNode;
  label: string;
  hint?: string;
  testId: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="topbar-menu-item"
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      {props.icon}
      <span className="topbar-menu-text">{props.label}</span>
      {props.hint && <span className="topbar-menu-hint">{props.hint}</span>}
    </button>
  );
}

function ExportMenu() {
  const t = useT();
  const room = useRoom();
  const title = useTitle();
  const hasNodes = useNodes().length > 0;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: ErdFile; name: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDismiss(open, wrapRef, () => setOpen(false));

  /** 그림 내보내기 하나를 실행하고 결과를 알린다. */
  const runImage = async (
    job: (nodes: ErdNode[], edges: ErdEdge[]) => Promise<boolean>,
    doneKey: MessageKey,
    failedKey: MessageKey,
  ) => {
    setOpen(false);
    if (busy) return;
    setBusy(true);
    try {
      const ok = await job(room.nodes.getSnapshot(), room.edges.getSnapshot());
      if (ok) toast(t(doneKey));
      else toast(t(failedKey), 'error');
    } catch (err) {
      toast(errorMessage(err, t(failedKey)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const name = () => safeFilename(title);

  const saveJson = () => {
    setOpen(false);
    try {
      downloadJson(room.doc, `${name()}.json`);
      toast(t('toast.jsonSaved'));
    } catch (err) {
      toast(errorMessage(err, t('toast.jsonFailed')), 'error');
    }
  };

  const doImport = (file: ErdFile, mode: 'replace' | 'merge') => {
    setPending(null);
    try {
      const ids = importErdFile(room.doc, file, mode);
      const added = ids.map((id) => room.nodes.get(id)).filter((n): n is ErdNode => Boolean(n));
      ui().setSelection(added.map((n) => n.id));
      const rect = boundsOf(added);
      if (rect) zoomToRect(rect);
      toast(t('toast.imported', { count: file.nodes.length }));
    } catch (err) {
      toast(errorMessage(err, t('toast.importFailed')), 'error');
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const picked = input.files?.[0];
    // 같은 파일을 다시 골라도 change가 나도록 비워 둔다
    input.value = '';
    if (!picked) return;
    let file: ErdFile;
    try {
      file = parseErdFile(await picked.text());
    } catch (err) {
      toast(errorMessage(err, t('toast.readFailed')), 'error');
      return;
    }
    if (file.nodes.length === 0) {
      toast(t('toast.fileEmpty'), 'error');
      return;
    }
    const empty = room.nodes.getSnapshot().length === 0 && room.edges.getSnapshot().length === 0;
    if (empty) doImport(file, 'replace');
    else setPending({ file, name: picked.name });
  };

  return (
    <div className="topbar-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn btn-ghost topbar-btn${open ? ' is-active' : ''}`}
        data-testid="export-button"
        title={t('topbar.export')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icons.export}
        <span className="topbar-label">{t('topbar.export')}</span>
        {icons.chevron}
      </button>
      {open && (
        <div className="panel topbar-menu" role="menu" data-testid="export-menu">
          <MenuItem
            icon={icons.image}
            label={t('export.savePng')}
            testId="export-png"
            disabled={!hasNodes || busy}
            onSelect={() =>
              runImage((n, ed) => downloadPng(n, ed, `${name()}.png`), 'toast.pngSaved', 'toast.pngFailed')
            }
          />
          <MenuItem
            icon={icons.copy}
            label={t('export.copyPng')}
            hint={t('export.copyPngHint')}
            testId="export-copy-png"
            disabled={!hasNodes || busy}
            onSelect={() =>
              runImage((n, ed) => copyPngToClipboard(n, ed), 'toast.clipboardCopied', 'toast.clipboardFailed')
            }
          />
          <MenuItem
            icon={icons.vector}
            label={t('export.saveSvg')}
            testId="export-svg"
            disabled={!hasNodes || busy}
            onSelect={() =>
              runImage((n, ed) => downloadSvg(n, ed, `${name()}.svg`), 'toast.svgSaved', 'toast.svgFailed')
            }
          />
          <div className="topbar-menu-sep" role="separator" />
          <MenuItem icon={icons.fileDown} label={t('export.saveJson')} testId="export-json" onSelect={saveJson} />
          <MenuItem
            icon={icons.fileUp}
            label={t('export.importJson')}
            testId="import-json"
            onSelect={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
          />
          {!hasNodes && <p className="topbar-menu-note">{t('export.needShapes')}</p>}
        </div>
      )}
      <input
        ref={fileRef}
        className="topbar-file"
        data-testid="import-file-input"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
      />
      {pending && (
        <ImportDialog
          fileName={pending.name}
          file={pending.file}
          onChoose={(mode) => doImport(pending.file, mode)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

/** 번역된 문장에서 파일 이름이 들어갈 자리를 찾기 위한 표시(화면에는 보이지 않는다) */
const FILE_SLOT = '\u0000';

/** 문서에 이미 내용이 있을 때 어떻게 불러올지 묻는 작은 확인 창 */
function ImportDialog(props: {
  fileName: string;
  file: ErdFile;
  onChoose: (mode: 'replace' | 'merge') => void;
  onCancel: () => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  useDismiss(true, boxRef, props.onCancel);
  // 파일 이름만 굵게 보이도록, 문장에서 이름이 들어갈 자리를 기준으로 앞뒤를 나눈다
  const [before, after = ''] = t('import.confirm', {
    file: FILE_SLOT,
    shapes: { key: 'count.shapes', params: { count: props.file.nodes.length } },
    lines: { key: 'count.lines', params: { count: props.file.edges.length } },
  }).split(FILE_SLOT);
  return createPortal(
    <div className="topbar-modal-backdrop" onKeyDown={stopKeys} onKeyUp={stopKeys}>
      <div
        className="panel topbar-modal"
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="topbar-import-title"
        data-testid="import-dialog"
      >
        <h2 id="topbar-import-title" className="topbar-modal-title">
          {t('import.title')}
        </h2>
        <p className="topbar-modal-text">
          {before}
          <strong className="topbar-modal-file">{props.fileName}</strong>
          {after}
        </p>
        <div className="topbar-modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="import-merge"
            autoFocus
            onClick={() => props.onChoose('merge')}
          >
            {t('import.merge')}
          </button>
          <button
            type="button"
            className="btn topbar-btn-danger"
            data-testid="import-replace"
            onClick={() => props.onChoose('replace')}
          >
            {t('import.replace')}
          </button>
          <button type="button" className="btn btn-ghost" data-testid="import-cancel" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────────── AI로 편집 ─────────────

/** 명령이나 주소 한 줄과 복사 버튼 */
function AiSnippet(props: { text: string; copyLabel: string; testId: string; onCopy: () => void }) {
  const t = useT();
  return (
    <div className="topbar-ai-row">
      <code className="topbar-ai-code" data-testid={`${props.testId}-text`}>
        {props.text}
      </code>
      <button
        type="button"
        className="btn"
        data-testid={`${props.testId}-copy`}
        aria-label={props.copyLabel}
        title={props.copyLabel}
        onClick={props.onCopy}
      >
        {t('common.copy')}
      </button>
    </div>
  );
}

/**
 * AI에게 이 다이어그램을 맡기는 세 가지 방법을 보여 주는 팝오버.
 * 터미널을 쓰는 AI에게 줄 지시문(이 방의 주소가 들어 있다), 로컬 MCP 서버 등록 명령, 원격 MCP 서버 주소를 복사할 수 있다.
 */
function AiButton() {
  const t = useT();
  const room = useRoom();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  // Esc로 닫으면 포커스를 버튼으로 돌려준다. 바깥을 눌러 닫을 때는 누른 곳이 포커스를 가져가게 둔다
  useDismiss(open, wrapRef, (reason) => {
    setOpen(false);
    if (reason === 'escape') buttonRef.current?.focus();
  });

  // 열리면 가장 많이 쓰는 지시문 복사 버튼이 키를 받는다
  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  const prompt = t('ai.cli.promptRoom', { url: roomUrl(room.id) });
  const remoteUrl = remoteMcpUrl();

  const copy = async (text: string, doneKey: MessageKey) => {
    if (await copyText(text)) toast(t(doneKey));
    else toast(t('toast.clipboardFailed'), 'error');
  };

  return (
    <div
      className="topbar-pop-wrap"
      ref={wrapRef}
      onBlur={(e) => {
        // Tab으로 팝오버 밖으로 나가면 닫는다
        const next = e.relatedTarget;
        if (open && next instanceof Node && !e.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost topbar-btn${open ? ' is-active' : ''}`}
        data-testid="ai-button"
        title={t('topbar.aiTitle')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // 방 화면의 전역 단축키(글자 키로 도구 고르기)로 새지 않게 한다
        onKeyDown={stopKeys}
        onKeyUp={stopKeys}
      >
        {icons.ai}
        <span className="topbar-label topbar-ai-label">{t('topbar.ai')}</span>
      </button>
      {open && (
        <div
          className="panel topbar-ai"
          role="dialog"
          aria-labelledby={titleId}
          data-testid="ai-popover"
          onKeyDown={stopKeys}
          onKeyUp={stopKeys}
        >
          <h2 id={titleId} className="topbar-ai-title">
            {t('ai.title')}
          </h2>
          <p className="topbar-ai-text">{t('ai.intro')}</p>

          <section className="topbar-ai-way" data-testid="ai-way-cli">
            <h3 className="topbar-ai-name">{t('ai.cli.title')}</h3>
            <p className="topbar-ai-text">{t('ai.cli.descRoom')}</p>
            <pre className="topbar-ai-code topbar-ai-prompt" data-testid="ai-prompt-text">
              {prompt}
            </pre>
            <button
              ref={primaryRef}
              type="button"
              className="btn btn-primary topbar-ai-primary"
              data-testid="ai-prompt-copy"
              onClick={() => copy(prompt, 'toast.promptCopied')}
            >
              {icons.copy}
              {t('ai.cli.copy')}
            </button>
          </section>

          <section className="topbar-ai-way" data-testid="ai-way-local">
            <h3 className="topbar-ai-name">{t('ai.local.title')}</h3>
            <p className="topbar-ai-text">{t('ai.local.desc')}</p>
            <AiSnippet
              text={LOCAL_MCP_COMMAND}
              copyLabel={t('ai.local.copy')}
              testId="ai-local"
              onCopy={() => copy(LOCAL_MCP_COMMAND, 'toast.commandCopied')}
            />
          </section>

          <section className="topbar-ai-way" data-testid="ai-way-remote">
            <h3 className="topbar-ai-name">{t('ai.remote.title')}</h3>
            <p className="topbar-ai-text">{t('ai.remote.desc')}</p>
            <AiSnippet
              text={remoteUrl}
              copyLabel={t('ai.remote.copy')}
              testId="ai-remote"
              onCopy={() => copy(remoteUrl, 'toast.urlCopied')}
            />
          </section>
        </div>
      )}
    </div>
  );
}

// ───────────── 공유 ─────────────

function ShareButton() {
  const t = useT();
  const room = useRoom();
  // 클립보드를 쓸 수 없을 때만 링크를 직접 보여 준다
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDismiss(fallbackUrl !== null, wrapRef, () => setFallbackUrl(null));

  useEffect(() => {
    const input = inputRef.current;
    if (fallbackUrl === null || !input) return;
    input.focus();
    input.select();
    // 전체 선택하면 끝쪽으로 밀려 보이므로 링크의 앞부분이 보이게 되돌린다
    input.scrollLeft = 0;
  }, [fallbackUrl]);

  const share = async () => {
    if (fallbackUrl !== null) {
      setFallbackUrl(null);
      return;
    }
    const url = roomUrl(room.id);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      toast(t('toast.linkCopied'));
    } catch {
      setFallbackUrl(url);
    }
  };

  /** 보안 연결이 아니어서 클립보드 API가 없을 때 쓰는 옛 방식 */
  const copyFromInput = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    if (ok) {
      toast(t('toast.linkCopied'));
      setFallbackUrl(null);
    } else {
      toast(t('toast.linkCopyFailed'), 'error');
    }
  };

  return (
    <div className="topbar-pop-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-primary topbar-btn"
        data-testid="share-button"
        title={t('topbar.shareTitle')}
        onClick={share}
      >
        {icons.link}
        <span className="topbar-label">{t('topbar.share')}</span>
      </button>
      {fallbackUrl !== null && (
        <div className="panel topbar-share" role="dialog" aria-label={t('share.linkLabel')} data-testid="share-popover">
          <p className="topbar-share-text">{t('share.fallback')}</p>
          <div className="topbar-share-row">
            <input
              ref={inputRef}
              className="input topbar-share-input"
              data-testid="share-link-input"
              type="text"
              readOnly
              value={fallbackUrl}
              aria-label={t('share.linkLabel')}
              onKeyDown={stopKeys}
              onKeyUp={stopKeys}
            />
            <button type="button" className="btn" data-testid="share-copy" onClick={copyFromInput}>
              {t('common.copy')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────── 상단 바 ─────────────

export function TopBar() {
  const t = useT();
  const room = useRoom();
  const { canUndo, canRedo } = useUndoState();
  const { errors, warnings } = useIssueCount();
  const issuesOpen = useUi((s) => s.panels.issues);
  const legendOpen = useUi((s) => s.panels.legend);
  const helpOpen = useUi((s) => s.panels.help);
  const togglePanel = useUi((s) => s.togglePanel);

  const errorCount = t('count.errors', { count: errors });
  const warningCount = t('count.warnings', { count: warnings });
  const issueSummary =
    errors + warnings === 0
      ? t('issues.summaryOk')
      : t('issues.summary', {
          summary: [errors > 0 ? errorCount : '', warnings > 0 ? warningCount : ''].filter(Boolean).join(t('list.separator')),
        });

  return (
    <div className="topbar">
      <div className="topbar-group topbar-left">
        <button
          type="button"
          className="btn btn-ghost topbar-home"
          data-testid="home-button"
          title={t('common.home')}
          onClick={() => navigate('/')}
        >
          <Logo />
          <span className="topbar-brand">{APP_NAME}</span>
        </button>
        <span className="topbar-divider" aria-hidden="true" />
        <TitleInput />
        <ConnectionBadge />
        <div className="topbar-history">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            data-testid="undo-button"
            title={t('common.withShortcut', { label: t('common.undo'), keys: UNDO_KEYS })}
            aria-label={t('common.undo')}
            disabled={!canUndo}
            onClick={() => undo(room)}
          >
            {icons.undo}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            data-testid="redo-button"
            title={t('common.withShortcut', { label: t('common.redo'), keys: REDO_KEYS })}
            aria-label={t('common.redo')}
            disabled={!canRedo}
            onClick={() => redo(room)}
          >
            {icons.redo}
          </button>
        </div>
      </div>

      <div className="topbar-group topbar-right">
        <button
          type="button"
          className={`btn btn-ghost topbar-btn${issuesOpen ? ' is-active' : ''}`}
          data-testid="issues-button"
          title={issueSummary}
          aria-pressed={issuesOpen}
          onClick={() => togglePanel('issues')}
        >
          {icons.check}
          <span className="topbar-label">{t('issues.title')}</span>
          {errors > 0 && (
            <span className="topbar-badge topbar-badge-error" data-testid="issues-badge-error" aria-label={errorCount}>
              {errors > 99 ? '99+' : errors}
            </span>
          )}
          {warnings > 0 && (
            <span
              className="topbar-badge topbar-badge-warning"
              data-testid="issues-badge-warning"
              aria-label={warningCount}
            >
              {warnings > 99 ? '99+' : warnings}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`btn btn-ghost topbar-btn${legendOpen ? ' is-active' : ''}`}
          data-testid="legend-button"
          title={t('topbar.legendTitle')}
          aria-pressed={legendOpen}
          onClick={() => togglePanel('legend')}
        >
          {icons.legend}
          <span className="topbar-label">{t('topbar.legend')}</span>
        </button>
        <ExportMenu />
        <AiButton />
        <ShareButton />
        <LanguageSelect variant="compact" className="topbar-language" />
        <button
          type="button"
          className={`btn btn-ghost btn-icon topbar-help${helpOpen ? ' is-active' : ''}`}
          data-testid="help-button"
          title={t('topbar.helpTitle')}
          aria-label={t('topbar.help')}
          aria-pressed={helpOpen}
          onClick={() => togglePanel('help')}
        >
          {icons.help}
        </button>
        <div className="topbar-avatars">
          <UserAvatars />
        </div>
      </div>
      <Toaster />
    </div>
  );
}
