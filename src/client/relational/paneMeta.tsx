/**
 * pane 탭에 붙는 제목과 아이콘. 탭 줄은 처음 화면에서 바로 그려지므로 이 파일은 변환 엔진을 가져오지 않는다
 * (pane 본문은 panes.tsx 를 따로 내려받는다).
 */
import type { PaneId } from '../layout/types';
import type { MessageKey } from '../i18n';

const TITLE: Record<PaneId, MessageKey> = {
  erd: 'relPane.title.erd',
  relational: 'relPane.title.relational',
  ie: 'relPane.title.ie',
  sql: 'relPane.title.sql',
};

/** 탭에 적을 제목의 사전 키. t(paneTitleKey(pane)) 로 쓴다 */
export function paneTitleKey(pane: PaneId): MessageKey {
  return TITLE[pane];
}

export function PaneIcon({ pane, size = 16, className }: { pane: PaneId; size?: number; className?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: className ?? 'pane-icon',
    'data-pane-icon': pane,
  };
  switch (pane) {
    case 'erd':
      // 엔티티 사각형과 관계 마름모
      return (
        <svg {...common}>
          <rect x="1.5" y="5.5" width="5" height="5" />
          <path d="M12 4.5 15 8l-3 3.5L9 8Z" />
          <path d="M6.5 8H9" />
        </svg>
      );
    case 'relational':
      // 표 하나(머리 줄과 기본키 칸)
      return (
        <svg {...common}>
          <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
          <path d="M2 6h12M6.5 6v7.5" />
        </svg>
      );
    case 'ie':
      // 상자 둘을 잇는 까마귀발
      return (
        <svg {...common}>
          <rect x="1.5" y="2" width="5" height="4.5" rx="0.8" />
          <rect x="9.5" y="9.5" width="5" height="4.5" rx="0.8" />
          <path d="M4 6.5v5h5.5M7.5 9.5l2 2-2 2" />
        </svg>
      );
    case 'sql':
      return (
        <svg {...common}>
          <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
        </svg>
      );
  }
}
