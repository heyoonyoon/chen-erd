/**
 * 관계 모델, IE, SQL 화면이 함께 쓰는 작은 부품(아이콘, 메시지 글자, 내려받기).
 */
import type { KeyboardEvent, ReactNode } from 'react';
import type { Message } from '../../shared/messages';
import { tm, type MessageKey } from '../i18n';

/** 엔진이 돌려준 메시지를 현재 언어의 글자로 바꾼다(엔진의 키는 사전에 들어 있다). */
export function msgText(message: Message): string {
  return tm(message as Message<MessageKey>);
}

/** 화면 안의 키 입력이 캔버스 단축키(window의 keydown)로 새지 않게 한다. */
export function stopKeys(e: KeyboardEvent): void {
  e.stopPropagation();
}

export function Icon({ children, size = 16, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      className={className ?? 'rel-icon'}
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

export const icons = {
  copy: (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.25" />
      <path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5A1.25 1.25 0 0 0 3.75 10.5H5.5" />
    </Icon>
  ),
  download: (
    <Icon>
      <path d="M8 2.5v7.5" />
      <path d="M5 7.25 8 10.25l3-3" />
      <path d="M2.75 10.5v1.75a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10.5" />
    </Icon>
  ),
  plus: (
    <Icon>
      <path d="M8 3.5v9M3.5 8h9" />
    </Icon>
  ),
  minus: (
    <Icon>
      <path d="M3.5 8h9" />
    </Icon>
  ),
  underline: (
    <Icon>
      <path d="M4.75 2.5v4.25a3.25 3.25 0 0 0 6.5 0V2.5" />
      <path d="M3.5 13.5h9" />
    </Icon>
  ),
  info: (
    <Icon>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.25v3.5" />
      <path d="M8 5.1v.01" />
    </Icon>
  ),
  fit: (
    <Icon>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </Icon>
  ),
};

/** 편집기식 문제 아이콘: 오류는 원 안의 X, 경고는 삼각형 안의 느낌표. 색은 CSS(.rel-sev-icon)가 정한다 */
export function ProblemIcon({ severity, size = 14 }: { severity: 'error' | 'warning'; size?: number }) {
  return severity === 'error' ? (
    <Icon size={size} className="rel-icon rel-sev-icon is-error">
      <circle cx="8" cy="8" r="6" />
      <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
    </Icon>
  ) : (
    <Icon size={size} className="rel-icon rel-sev-icon is-warning">
      <path d="M8 2.25 14.25 13.25H1.75Z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.4v.01" />
    </Icon>
  );
}

/** 글자를 파일로 내려받는다. 성공하면 true */
export function downloadText(text: string, filename: string, type = 'text/plain'): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
