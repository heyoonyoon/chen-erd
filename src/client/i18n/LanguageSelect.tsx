/**
 * 언어 선택. 방 화면의 상단 바와 첫 화면이 같은 컴포넌트를 쓴다.
 * 브라우저의 select를 쓰지 않고 버튼과 목록을 직접 그린다. 목록의 각 줄에는 국기와 그 언어의 이름이 나온다.
 * 키보드: 버튼에서 Enter, Space, 화살표로 열고, 목록에서 화살표와 Home/End로 옮기고 Enter로 고르고 Esc로 닫는다.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { LOCALES, LOCALE_NAMES, setLocale, useLocale, useT, type Locale } from './index';
import './LanguageSelect.css';

/** 좁은 자리에서 언어 이름 대신 보이는 짧은 표기 */
const SHORT_NAMES: Record<Locale, string> = {
  ko: 'KO',
  en: 'EN',
  ja: 'JA',
  'zh-CN': '简',
  'zh-TW': '繁',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  'pt-BR': 'PT',
  vi: 'VI',
};

/** 언어마다 붙이는 국기. 국기 글자가 없는 환경(Windows)에서는 나라 코드 두 글자로 보인다 */
export const LOCALE_FLAGS: Record<Locale, string> = {
  ko: '🇰🇷',
  en: '🇺🇸',
  ja: '🇯🇵',
  'zh-CN': '🇨🇳',
  'zh-TW': '🇹🇼',
  es: '🇪🇸',
  fr: '🇫🇷',
  de: '🇩🇪',
  'pt-BR': '🇧🇷',
  vi: '🇻🇳',
};

export interface LanguageSelectProps {
  /** compact는 짧은 표기(KO, EN), full은 언어 이름 전체를 보여 준다. 기본은 full */
  variant?: 'compact' | 'full';
  className?: string;
  testId?: string;
}

export function LanguageSelect({ variant = 'full', className, testId = 'language-select' }: LanguageSelectProps) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (code: Locale) => `${listId}-${code}`;

  const openList = () => {
    setActive(Math.max(0, LOCALES.indexOf(locale)));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const choose = (code: Locale) => {
    close(true);
    if (code !== locale) void setLocale(code);
  };

  // 열리면 목록이 키를 받는다
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // 지금 가리키는 줄이 보이게 한다
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('.is-active');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // 방 화면의 전역 단축키(글자 키로 도구 고르기)로 새지 않게 한다
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    e.stopPropagation();
    const last = LOCALES.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(LOCALES[active]);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
    }
  };

  const label = `${t('language.label')}: ${LOCALE_NAMES[locale]}`;
  return (
    <div
      ref={rootRef}
      className={`language-select language-select-${variant}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="language-select-button"
        data-testid={testId}
        data-locale={locale}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <span className="language-select-flag" aria-hidden="true">
          {LOCALE_FLAGS[locale]}
        </span>
        <span className="language-select-value" aria-hidden="true">
          {variant === 'compact' ? SHORT_NAMES[locale] : LOCALE_NAMES[locale]}
        </span>
        <svg className="language-select-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6.25 8 10l4-3.75" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="language-select-list"
          role="listbox"
          tabIndex={-1}
          aria-label={t('language.label')}
          aria-activedescendant={optionId(LOCALES[active])}
          data-testid={`${testId}-list`}
          onKeyDown={onListKeyDown}
          onKeyUp={(e) => e.stopPropagation()}
        >
          {LOCALES.map((code, i) => (
            <li
              key={code}
              id={optionId(code)}
              role="option"
              lang={code}
              aria-selected={code === locale}
              className={`language-select-option${i === active ? ' is-active' : ''}${code === locale ? ' is-selected' : ''}`}
              data-testid={`${testId}-option-${code}`}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(code)}
            >
              <span className="language-select-flag" aria-hidden="true">
                {LOCALE_FLAGS[code]}
              </span>
              <span className="language-select-name">{LOCALE_NAMES[code]}</span>
              {code === locale && (
                <svg className="language-select-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
