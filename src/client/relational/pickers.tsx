/**
 * IE 그림과 SQL 컬럼 설정 표가 함께 쓰는 고르기 부품.
 *   TypeCombo: 타입 콤보박스. 고른 DBMS의 흔한 타입 목록에서 고르거나 직접 적는다. 길이가 있는 타입은 고르면
 *              괄호 안 숫자를 골라 둔 채 입력칸에 채워 바로 고치게 한다. 쓰는 것은 Enter나 칸을 떠날 때, Esc는 버린다.
 *   CellMenu:  칸 아래에 뜨는 작은 선택 메뉴(앱의 패널 메뉴와 같은 모양).
 * 펼친 목록은 body에 띄워(pane과 그림 틀에 잘리지 않게) 기준 요소를 따라다니게 한다.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SqlDialect } from '../../shared/relational/userSchema';
import { toast } from '../ui/toast';
import '../layout/PaneMenu.css';
import { stopKeys } from './common';

/** DBMS마다 흔한 타입. 괄호가 있는 것은 고르면 괄호 안을 고칠 수 있게 채운다 */
export const TYPE_OPTIONS: Record<SqlDialect, readonly string[]> = {
  mysql: ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL(10,2)', 'VARCHAR(255)', 'CHAR(10)', 'TEXT', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN'],
  postgresql: ['INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL', 'NUMERIC(10,2)', 'VARCHAR(255)', 'CHAR(10)', 'TEXT', 'DATE', 'TIMESTAMP', 'BOOLEAN', 'UUID'],
  oracle: ['NUMBER', 'NUMBER(10)', 'NUMBER(10,2)', 'VARCHAR2(255)', 'CHAR(10)', 'CLOB', 'DATE', 'TIMESTAMP'],
};

/** 적은 글자로 목록을 좁힌다. 비었거나 지금 값 그대로면 전부 */
export function filterTypes(options: readonly string[], draft: string, value: string): readonly string[] {
  const q = draft.trim().toUpperCase();
  if (q === '' || draft === value) return options;
  return options.filter((o) => o.startsWith(q) && o !== q);
}

/** 괄호 안 첫 값의 자리(고른 뒤 바로 고치게 골라 둘 곳). 괄호가 없으면 null */
export function argRange(type: string): [number, number] | null {
  const open = type.indexOf('(');
  if (open < 0) return null;
  const close = type.indexOf(')', open);
  const comma = type.indexOf(',', open);
  const end = comma > open && comma < close ? comma : close;
  return end > open + 1 ? [open + 1, end] : null;
}

/**
 * 기준 요소 바로 아래의 화면 자리. 아래가 모자라면 위로 올리고, 오른쪽 끝을 넘지 않게 당긴다.
 * 열려 있는 동안 기준 요소가 움직이면(화면 이동, 확대, 스크롤) 따라간다
 */
function useBelow(
  anchor: () => Element | null,
  open: boolean,
  popup: { current: HTMLElement | null },
): { left: number; top: number; minWidth: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const el = anchorRef.current();
      if (el) {
        const r = el.getBoundingClientRect();
        const pw = popup.current?.offsetWidth ?? 0;
        const ph = popup.current?.offsetHeight ?? 0;
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        let top = r.bottom + 2;
        if (vh > 0 && top + ph > vh - 8) top = r.top - 2 - ph >= 8 ? r.top - 2 - ph : Math.max(8, vh - 8 - ph);
        let left = r.left;
        if (vw > 0 && left + pw > vw - 8) left = Math.max(8, vw - 8 - pw);
        const next = { left: Math.round(left), top: Math.round(top), minWidth: Math.round(r.width) };
        setPos((p) => (p && p.left === next.left && p.top === next.top && p.minWidth === next.minWidth ? p : next));
      }
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(measure);
    };
    measure();
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    };
  }, [open]);
  return pos;
}

const portal = (node: ReactNode) => (typeof document === 'undefined' ? null : createPortal(node, document.body));

interface TypeComboProps {
  /** 지금 정해진 타입(없으면 '') */
  value: string;
  options: readonly string[];
  label: string;
  testId: string;
  className: string;
  placeholder?: string;
  /** 처음부터 포커스를 두고 글자를 모두 고른다(그림의 칸 입력칸) */
  autoFocus?: boolean;
  /** 쓴다. 쓸 수 없으면 이유 글자 */
  onCommit: (next: string) => string | null;
  /** 고치기를 마쳤다(enter: 썼다, blur: 칸을 떠났다, escape: 버렸다) */
  onDone?: (how: 'enter' | 'blur' | 'escape') => void;
  /** 입력칸에 더 붙일 속성 */
  attrs?: Record<string, string | boolean | undefined>;
}

export function TypeCombo({ value, options, label, testId, className, placeholder, autoFocus, onCommit, onDone, attrs }: TypeComboProps) {
  const ref = useRef<HTMLInputElement>(null);
  const listId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-types`;
  const [draft, setDraft] = useState<string | null>(autoFocus ? value : null);
  const [open, setOpen] = useState(Boolean(autoFocus));
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  /** 이번 고치기를 이미 마쳤다(Enter 뒤의 blur, Esc 뒤의 blur는 무시) */
  const done = useRef(false);
  /** 다음 그리기 뒤에 고를 글자 구간 */
  const pendingSelect = useRef<[number, number] | null>(null);
  const editing = draft !== null;
  const shown = editing ? filterTypes(options, draft, value) : [];
  const listOpen = open && editing && shown.length > 0;
  const listRef = useRef<HTMLUListElement>(null);
  const pos = useBelow(() => ref.current, listOpen, listRef);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const r = pendingSelect.current;
    if (!r || !ref.current) return;
    pendingSelect.current = null;
    ref.current.setSelectionRange(r[0], r[1]);
  });

  const finish = (how: 'enter' | 'blur' | 'escape') => {
    done.current = true;
    setDraft(null);
    setOpen(false);
    setActive(-1);
    onDone?.(how);
  };
  /** 쓰고 마친다. 쓸 수 없으면 Enter일 때는 열어 두고, 칸을 떠날 때는 버리고 알린다 */
  const commit = (raw: string, how: 'enter' | 'blur') => {
    if (done.current) return;
    const next = raw.replace(/\s+/g, ' ').trim();
    if (next !== value) {
      const problem = onCommit(next);
      if (problem !== null) {
        setError(problem);
        if (how === 'enter') {
          setOpen(false);
          return;
        }
        toast(problem, 'error');
      }
    }
    setError(null);
    finish(how);
    if (how === 'enter' && !autoFocus) ref.current?.blur();
  };
  const pick = (opt: string) => {
    const range = argRange(opt);
    if (!range) {
      commit(opt, 'enter');
      return;
    }
    // 길이가 있는 타입: 채워 두고 괄호 안 숫자를 골라 둔다(Enter로 쓴다)
    setDraft(opt);
    setError(null);
    setOpen(false);
    setActive(-1);
    pendingSelect.current = range;
    ref.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    stopKeys(e);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!editing) setDraft(value);
      if (!listOpen) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : shown.length - 1);
        return;
      }
      const n = shown.length;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (listOpen && active >= 0 && active < shown.length) pick(shown[active]);
      else commit(e.currentTarget.value, 'enter');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setError(null);
      finish('escape');
      if (!autoFocus) ref.current?.blur();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const activeId = listOpen && active >= 0 ? `${listId}-${active}` : undefined;
  return (
    <>
      <input
        ref={ref}
        className={`input ${className}${error ? ' is-invalid' : ''}`}
        data-testid={testId}
        value={draft ?? value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={activeId}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        {...attrs}
        onFocus={() => {
          done.current = false;
          if (draft === null) setDraft(value);
          setOpen(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={(e) => {
          if (!done.current) commit(e.currentTarget.value, 'blur');
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={stopKeys}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {listOpen &&
        portal(
          <ul
            ref={listRef}
            id={listId}
            className="panel panemenu-menu rel-menu rel-type-list"
            role="listbox"
            aria-label={label}
            data-testid={`${testId}-options`}
            style={pos ? { left: pos.left, top: pos.top, minWidth: pos.minWidth } : { visibility: 'hidden' }}
            // 목록을 눌러도 입력칸의 포커스를 잃지 않는다. React에서는 포털 안의 이벤트도 부모(그림)로 올라가므로 끊는다
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {shown.map((opt, i) => (
              <li
                key={opt}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`panemenu-item rel-menu-item${i === active ? ' is-active' : ''}`}
                data-value={opt}
                onClick={() => pick(opt)}
              >
                <span className="rel-menu-mono">{opt}</span>
              </li>
            ))}
          </ul>,
        )}
    </>
  );
}

export interface MenuChoice {
  value: string;
  label: string;
}

/**
 * 기준 칸 아래의 선택 메뉴. 지금 값에 체크가 있다. 방향키로 옮기고 Enter로 고르며, Esc나 바깥 누르기로 닫는다.
 * children이 있으면 목록 대신 그것을 보인다(외래키가 가리킬 곳 고르기).
 */
export function CellMenu({
  anchor,
  label,
  choices,
  current,
  testId,
  onPick,
  onClose,
  children,
}: {
  anchor: () => Element | null;
  label: string;
  choices: readonly MenuChoice[];
  current: string | null;
  testId: string;
  onPick: (value: string) => void;
  /** refocus면 기준 칸으로 포커스를 돌린다 */
  onClose: (refocus: boolean) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useBelow(anchor, true, ref);
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useEffect(() => {
    if (children) return;
    const list = items();
    (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus({ preventScroll: true });
  }, [children]);
  useEffect(() => {
    // 바깥을 누르면 닫는다. 기준 칸을 누른 것은 칸이 직접 닫는다(다시 열리지 않게)
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current()?.contains(target)) return;
      closeRef.current(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    stopKeys(e);
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose(true);
      return;
    }
    if (children) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') to = i <= 0 ? list.length - 1 : i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    else if (e.key === 'Tab') {
      onClose(false);
      return;
    } else return;
    e.preventDefault();
    list[to]?.focus();
  };

  return portal(
    <div
      ref={ref}
      className={`panel panemenu-menu rel-menu${children ? ' rel-menu-form' : ''}`}
      role={children ? 'dialog' : 'menu'}
      aria-label={label}
      data-testid={testId}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onKeyUp={stopKeys}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children ??
        choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="menuitemradio"
            aria-checked={c.value === current}
            className="panemenu-item rel-menu-item"
            data-testid={`${testId}-${c.value}`}
            onClick={() => onPick(c.value)}
          >
            <span className="panemenu-check" aria-hidden="true">
              {c.value === current && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="panemenu-text">{c.label}</span>
          </button>
        ))}
    </div>,
  );
}
