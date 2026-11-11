/**
 * 공통 타입과 상수. 클라이언트와 서버, 모든 모듈이 이 파일의 정의를 계약으로 삼는다.
 * (CORE 파일: 담당 에이전트 외에는 수정하지 않는다.)
 */

// ───────────────────────── 도형(노드) ─────────────────────────

/** 캔버스에 놓이는 도형의 종류. 세부 모양은 아래 플래그로 구분한다. */
export type NodeKind = 'entity' | 'relationship' | 'attribute' | 'spec' | 'note';

/** 속성의 식별자 표시. key = 밑줄, partial = 점선 밑줄(약한 엔티티의 부분 키). */
export type KeyType = 'none' | 'key' | 'partial';

/** EER 특수화 원 안의 글자. d = disjoint, o = overlap. */
export type SpecType = 'd' | 'o';

export interface ErdNode {
  id: string;
  kind: NodeKind;
  /** 왼쪽 위 모서리의 월드 좌표 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 도형 안의 글자. '\n'으로 줄을 나눈다. spec은 text 대신 specType을 그린다. */
  text: string;
  /** entity 전용: 약한 엔티티(이중 직사각형) */
  weak?: boolean;
  /** relationship 전용: 식별 관계(이중 마름모) */
  identifying?: boolean;
  /** attribute 전용: 다중값 속성(이중 타원) */
  multivalued?: boolean;
  /** attribute 전용: 유도 속성(점선 타원) */
  derived?: boolean;
  /** attribute 전용: 식별자 표시 */
  keyType?: KeyType;
  /** spec 전용 */
  specType?: SpecType;
}

// ───────────────────────── 연결선(엣지) ─────────────────────────

/** 도형의 네 면. 마름모와 타원, 원에서는 그 방향의 꼭짓점(끝점)을 뜻한다. */
export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** 선 모양. straight = 두 끝을 곧게 잇는 직선, elbow = 가로세로로만 꺾이는 선 */
export type EdgeShapeKind = 'straight' | 'elbow';

export interface ErdEdge {
  id: string;
  /** 연결된 두 노드의 id. 방향에 의미는 없다(그리기 시작한 쪽이 source). */
  source: string;
  target: string;
  /** 이중선. 전체 참여(total participation) 또는 전체 특수화(total specialization). */
  double: boolean;
  /** 카디널리티 글자. '', '1', 'M', 'N' 또는 사용자가 직접 입력한 글자. */
  label: string;
  /** 역할 이름(재귀 관계 등에서 사용). 없으면 ''. */
  role: string;
  /** 선이 source 도형의 어느 면(꼭짓점)에 붙는지. 없으면 자동으로 고른다. */
  sourceSide?: Side;
  /** 선이 target 도형의 어느 면(꼭짓점)에 붙는지. 없으면 자동으로 고른다. */
  targetSide?: Side;
  /**
   * 선 모양. 없으면 straight로 그린다. 붙는 면이 지정된 직선은 그 면의 고정점(마름모는 꼭짓점)끼리 곧게 잇는다.
   * elbow는 사용자가 직접 골랐을 때만 쓴다.
   */
  shape?: EdgeShapeKind;
}

export const CARDINALITY_OPTIONS = ['', '1', 'M', 'N'] as const;

// ───────────────────────── 도형 프리셋(도구 팔레트) ─────────────────────────

export type PresetId =
  | 'entity'
  | 'weak-entity'
  | 'relationship'
  | 'identifying-relationship'
  | 'attribute'
  | 'key-attribute'
  | 'partial-key-attribute'
  | 'multivalued-attribute'
  | 'derived-attribute'
  | 'spec-d'
  | 'spec-o'
  | 'note';

export interface NodePreset {
  id: PresetId;
  /** 한국어 이름 (툴바, 도움말에 표시) */
  label: string;
  /** 영어 이름 (수업 용어) */
  labelEn: string;
  kind: NodeKind;
  /** kind 외에 미리 켜 둘 플래그 */
  props: Partial<ErdNode>;
  w: number;
  h: number;
  /** 새로 놓을 때의 기본 글자 */
  defaultText: string;
  /** 단축키. KeyboardEvent.code 값 (한글 입력 상태에서도 동작하도록 code를 쓴다). 없으면 null. */
  shortcut: string | null;
}

export const NODE_PRESETS: Record<PresetId, NodePreset> = {
  entity: { id: 'entity', label: '엔티티', labelEn: 'Entity type', kind: 'entity', props: {}, w: 140, h: 60, defaultText: '엔티티', shortcut: 'KeyE' },
  'weak-entity': { id: 'weak-entity', label: '약한 엔티티', labelEn: 'Weak entity type', kind: 'entity', props: { weak: true }, w: 150, h: 66, defaultText: '약한 엔티티', shortcut: 'KeyW' },
  relationship: { id: 'relationship', label: '관계', labelEn: 'Relationship type', kind: 'relationship', props: {}, w: 140, h: 80, defaultText: '관계', shortcut: 'KeyR' },
  'identifying-relationship': { id: 'identifying-relationship', label: '식별 관계', labelEn: 'Identifying relationship type', kind: 'relationship', props: { identifying: true }, w: 156, h: 92, defaultText: '식별 관계', shortcut: 'KeyI' },
  attribute: { id: 'attribute', label: '속성', labelEn: 'Attribute', kind: 'attribute', props: {}, w: 120, h: 50, defaultText: '속성', shortcut: 'KeyA' },
  'key-attribute': { id: 'key-attribute', label: '식별자(키)', labelEn: 'Identifier', kind: 'attribute', props: { keyType: 'key' }, w: 120, h: 50, defaultText: '식별자', shortcut: 'KeyK' },
  'partial-key-attribute': { id: 'partial-key-attribute', label: '부분 키', labelEn: 'Partial key', kind: 'attribute', props: { keyType: 'partial' }, w: 120, h: 50, defaultText: '부분 키', shortcut: 'KeyP' },
  'multivalued-attribute': { id: 'multivalued-attribute', label: '다중값 속성', labelEn: 'Multivalued attribute', kind: 'attribute', props: { multivalued: true }, w: 130, h: 56, defaultText: '다중값', shortcut: 'KeyM' },
  'derived-attribute': { id: 'derived-attribute', label: '유도 속성', labelEn: 'Derived attribute', kind: 'attribute', props: { derived: true }, w: 120, h: 50, defaultText: '유도 속성', shortcut: 'KeyD' },
  'spec-d': { id: 'spec-d', label: '특수화 d', labelEn: 'Disjoint specialization', kind: 'spec', props: { specType: 'd' }, w: 34, h: 34, defaultText: '', shortcut: null },
  'spec-o': { id: 'spec-o', label: '특수화 o', labelEn: 'Overlap specialization', kind: 'spec', props: { specType: 'o' }, w: 34, h: 34, defaultText: '', shortcut: null },
  note: { id: 'note', label: '메모', labelEn: 'Note', kind: 'note', props: {}, w: 160, h: 50, defaultText: '메모', shortcut: 'KeyT' },
};

export const PRESET_ORDER: PresetId[] = [
  'entity',
  'weak-entity',
  'relationship',
  'identifying-relationship',
  'attribute',
  'key-attribute',
  'partial-key-attribute',
  'multivalued-attribute',
  'derived-attribute',
  'spec-d',
  'spec-o',
  'note',
];

/** 노드가 어느 프리셋에 해당하는지 되짚는다(인스펙터, 범례 표시용). */
export function presetOf(node: ErdNode): PresetId {
  switch (node.kind) {
    case 'entity':
      return node.weak ? 'weak-entity' : 'entity';
    case 'relationship':
      return node.identifying ? 'identifying-relationship' : 'relationship';
    case 'attribute':
      if (node.multivalued) return 'multivalued-attribute';
      if (node.derived) return 'derived-attribute';
      if (node.keyType === 'key') return 'key-attribute';
      if (node.keyType === 'partial') return 'partial-key-attribute';
      return 'attribute';
    case 'spec':
      return node.specType === 'o' ? 'spec-o' : 'spec-d';
    case 'note':
      return 'note';
  }
}

// ───────────────────────── 도구 ─────────────────────────

/**
 * select: 선택과 이동 / pan: 화면 이동 / connect: 단선 연결 / connect-double: 이중선 연결
 * place:<PresetId>: 캔버스를 클릭한 자리에 해당 도형을 놓는다.
 */
export type Tool = 'select' | 'pan' | 'connect' | 'connect-double' | `place:${PresetId}`;

export function placeTool(id: PresetId): Tool {
  return `place:${id}`;
}
export function presetOfTool(tool: Tool): PresetId | null {
  return tool.startsWith('place:') ? (tool.slice(6) as PresetId) : null;
}

// ───────────────────────── 화면, 기하 ─────────────────────────

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** screen = world * zoom + (x, y) */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
/** 정렬 안내선. orientation 'v'는 세로선(x = pos), 'h'는 가로선(y = pos). from~to는 선의 범위(월드 좌표). */
export interface Guide {
  orientation: 'v' | 'h';
  pos: number;
  from: number;
  to: number;
}

// ───────────────────────── 협업(접속자) ─────────────────────────

export interface UserInfo {
  /** 브라우저마다 고정된 임의 id */
  id: string;
  name: string;
  color: string;
}

/** Yjs awareness에 올리는 내 상태 */
export interface Presence {
  user: UserInfo;
  /** 월드 좌표의 마우스 위치. 캔버스 밖이면 null */
  cursor: Point | null;
  /** 내가 선택한 노드/엣지 id */
  selection: string[];
  /** 내가 글자를 편집 중인 노드 id */
  editing: string | null;
}

/** 다른 접속자 한 명 */
export interface Peer extends Presence {
  clientId: number;
}

export const USER_COLORS = [
  '#E5484D', '#F76B15', '#FFB224', '#46A758', '#12A594',
  '#0090FF', '#3E63DD', '#8E4EC6', '#D6409F', '#978365',
];

// ───────────────────────── 그리기 상수 ─────────────────────────

export const STYLE = {
  /** 도형과 선의 기본 색 */
  stroke: '#1a1a1a',
  fill: '#ffffff',
  strokeWidth: 1.5,
  /** 이중 직사각형/마름모/타원의 안쪽 도형까지 간격, 이중선의 두 선 사이 간격 */
  doubleGap: 5,
  fontSize: 14,
  lineHeight: 18,
  fontFamily: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif",
  /** 선택 표시 색 */
  accent: '#0d6efd',
  /** 카디널리티 글자 크기 */
  labelFontSize: 14,
  /** 글자와 도형 테두리 사이 여백(글자에 맞춰 크기를 키울 때 사용) */
  textPaddingX: 16,
  textPaddingY: 10,
} as const;

export const GRID_SIZE = 10;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const MIN_NODE_SIZE = { w: 40, h: 28 };

// ───────────────────────── 검증 결과 ─────────────────────────

export interface Issue {
  /** 같은 문제를 구분하는 안정적인 키 */
  id: string;
  severity: 'error' | 'warning';
  /** 한국어 설명 */
  message: string;
  /** 관련된 노드/엣지 id (클릭하면 화면에서 강조) */
  elementIds: string[];
}

// ───────────────────────── 파일 형식 ─────────────────────────

export interface ErdFile {
  format: 'chen-erd';
  version: 1;
  title: string;
  nodes: ErdNode[];
  edges: ErdEdge[];
}

/** 방 id 형식. 서버와 클라이언트가 같은 규칙으로 검사한다. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
