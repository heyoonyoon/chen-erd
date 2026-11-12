/**
 * 네 pane의 열기 닫기(열린 것에 체크)와 레이아웃 초기화를 고르는 작은 메뉴.
 * 마지막으로 열린 pane은 닫을 수 없어서 흐리게 보인다.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../i18n';
import { closePane, defaultLayout, openPane, openPanes } from './model';
import { PANE_IDS, type LayoutState, type PaneId } from './types';
import './PaneMenu.css';

export interface PaneMenuProps {
  state: LayoutState;
  onChange: (next: LayoutState) => void;
  paneTitle: (pane: PaneId) => string;
  paneIcon?: (pane: PaneId) => ReactNode;
  className?: string;
}

export function PaneMenu({ state, onChange, paneTitle, paneIcon, className }: PaneMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-panes`;
  const opened = new Set(openPanes(state));
  const onlyOne = opened.size <= 1;

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  // 열면 첫 항목에 포커스, 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') to = i <= 0 ? list.length - 1 : i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    } else if (e.key === 'Tab') {
      close(false);
      return;
    } else return;
    e.preventDefault();
    list[to]?.focus();
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };

  const toggle = (pane: PaneId) => {
    onChange(opened.has(pane) ? closePane(state, pane) : openPane(state, pane));
  };

  return (
    <div
      className={`panemenu${className ? ` ${className}` : ''}`}
      ref={wrapRef}
      // 메뉴의 키 입력은 캔버스 단축키로 넘기지 않는다
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost panemenu-button${open ? ' is-active' : ''}`}
        data-testid="pane-menu-button"
        title={t('dock.panesMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
      >
        <LayoutIcon />
        <span className="panemenu-label">{t('dock.panes')}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="panel panemenu-menu"
          role="menu"
          aria-label={t('dock.panesMenu')}
          data-testid="pane-menu"
          onKeyDown={onMenuKeyDown}
        >
          {PANE_IDS.map((pane) => {
            const checked = opened.has(pane);
            const locked = checked && onlyOne;
            return (
              <button
                key={pane}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                className="panemenu-item"
                data-testid={`pane-menu-${pane}`}
                disabled={locked}
                title={locked ? t('dock.lastPane') : undefined}
                onClick={() => toggle(pane)}
              >
                <span className="panemenu-check" aria-hidden="true">
                  {checked && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {paneIcon && <span className="panemenu-icon">{paneIcon(pane)}</span>}
                <span className="panemenu-text">{paneTitle(pane)}</span>
              </button>
            );
          })}
          <div className="panemenu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="panemenu-item"
            data-testid="pane-menu-reset"
            onClick={() => {
              onChange(defaultLayout());
              close(true);
            }}
          >
            <span className="panemenu-check" aria-hidden="true" />
            <span className="panemenu-text">{t('dock.resetLayout')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function LayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M8 2.5v11M8 9h6.5" />
    </svg>
  );
}
