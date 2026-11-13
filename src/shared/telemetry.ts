/**
 * 서비스 지표용 클라이언트 이벤트의 약속. 브라우저(src/client/telemetry.ts)가 보내고 서버(src/server/stats.ts)가 센다.
 * 개인정보는 싣지 않는다: 사람 구분은 브라우저가 만든 무작위 익명 ID뿐이고, 서버는 그 ID를 비밀 솔트로 해시한 값만 저장한다.
 */

/** 이벤트를 받는 자리(POST, sendBeacon) */
export const TELEMETRY_PATH = '/api/t';
/** 이벤트 하나의 최대 크기(바이트) */
export const MAX_TELEMETRY_BYTES = 2048;
/** 익명 ID: 128비트를 16진수 32자로 */
export const ANON_ID_PATTERN = /^[0-9a-f]{32}$/;

export const TELEMETRY_EVENTS = [
  /** 첫 화면을 열었다 */
  'home_view',
  /** 방 화면에 들어왔다. entry로 어떻게 들어왔는지 */
  'room_enter',
  /** 첫 화면의 새 다이어그램 만들기 */
  'create_click',
  /** 이 방에서 처음으로 도형을 추가했다 */
  'shape_add',
  /** 관계 모델 글을 고쳤다 */
  'rel_write',
  /** IE 그림이나 SQL의 컬럼 설정에서 타입, NULL, 키, 이름을 고쳤다 */
  'ie_edit',
  /** SQL pane이 보였다 */
  'sql_view',
  'sql_copy',
  'sql_download',
  /** 그림이나 파일 내보내기. kind */
  'export',
  /** DBMS 고르기. v */
  'dbms',
  /** 검증 패널, 표기 안내, 도움말 열기 */
  'validate_open',
  'legend_open',
  'help_open',
  /** pane 배치를 바꿨다(열기, 닫기, 옮기기, 최대화) */
  'layout_change',
  /** 방 링크 복사(초대) */
  'share_link',
] as const;
export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];

export const EXPORT_KINDS = ['png', 'copy_png', 'svg', 'json'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/**
 * 방에 들어온 경로.
 * new = 첫 화면에서 새로 만듦, home = 첫 화면에서 코드나 최근 목록으로, recent = 이 브라우저에서 전에 연 방의 주소로 바로,
 * link = 처음 보는 방의 주소로 바로(남이 보낸 초대 링크)
 */
export const ENTRY_KINDS = ['new', 'home', 'recent', 'link'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const DIALECTS = ['postgresql', 'mysql', 'oracle'] as const;

/** 브라우저가 보내는 이벤트 하나. 필드 이름을 짧게 해 크기를 줄인다 */
export interface TelemetryPayload {
  /** 익명 ID */
  a: string;
  /** 이벤트 이름 */
  e: TelemetryEvent;
  /** 방 id(서버가 해시해서 센다) */
  r?: string;
  /** 페이지를 처음 연 이벤트면 1. 유입(ref, utm)은 이때만 싣는다 */
  land?: 1;
  /** 들어온 곳의 도메인. 같은 사이트 안이거나 없으면 'direct' */
  ref?: string;
  /** utm_source */
  utm?: string;
  /** 화면 언어 */
  lang?: string;
  /** 기기: m = 모바일, d = 데스크톱 */
  dev?: 'm' | 'd';
  entry?: EntryKind;
  kind?: ExportKind;
  /** dbms 값 */
  v?: string;
}
