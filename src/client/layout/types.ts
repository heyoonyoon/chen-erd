/**
 * 방 화면의 pane 배치(VS Code의 편집기 그룹처럼). 이 파일은 계약이다: 배치 틀을 만드는 쪽과
 * 방 화면에 끼워 넣는 쪽이 이 정의를 함께 쓴다. 바꿀 때는 추가만 한다.
 *
 * 배치는 나눔(split)과 탭 그룹(group)으로 된 나무다. 잎은 언제나 탭 그룹이고, 그룹은 pane을 하나 이상 가진다.
 * 배치는 사람마다 다르다(팀원과 나누지 않는다). 이 브라우저의 localStorage에만 저장한다.
 */

/**
 * pane 종류. 한 종류는 화면에 최대 하나만 열린다.
 * (예전에 있던 'steps'는 없어졌다. 저장된 배치에 남아 있으면 읽을 때 뺀다)
 */
export type PaneId = 'erd' | 'relational' | 'ie' | 'sql';

export const PANE_IDS: readonly PaneId[] = ['erd', 'relational', 'ie', 'sql'];

export interface GroupNode {
  type: 'group';
  /** 배치 안에서 유일한 id */
  id: string;
  /** 탭 순서대로. 비어 있으면 안 된다(빈 그룹은 정리하면서 없앤다) */
  panes: PaneId[];
  /** 지금 보이는 탭. panes 안에 있어야 한다 */
  active: PaneId;
}

export interface SplitNode {
  type: 'split';
  id: string;
  /** row는 왼쪽에서 오른쪽으로, column은 위에서 아래로 나눈다 */
  direction: 'row' | 'column';
  /** 둘 이상 */
  children: LayoutNode[];
  /** children과 같은 길이. 합이 1인 비율 */
  sizes: number[];
}

export type LayoutNode = GroupNode | SplitNode;

export interface LayoutState {
  /** 저장 형식이 바뀌면 올린다. 다르면 기본 배치로 돌아간다 */
  version: 1;
  root: LayoutNode;
  /** 잠시 크게 보는 그룹 id. 없으면 null */
  maximized: string | null;
  /**
   * (추가) 가장 최근에 쓴 그룹 id. openPane이 닫힌 pane을 넣을 그룹을 고르고,
   * 좁은 화면에서 보일 pane(이 그룹의 active)을 정하는 데 쓴다. 없거나 사라진 그룹이면 가장 넓은 그룹을 쓴다
   */
  lastGroup?: string;
}

/** 탭을 끌어다 놓는 자리. center는 그 그룹의 탭으로 넣기, 나머지는 그 쪽으로 새 그룹을 만들어 나누기 */
export type DropEdge = 'center' | 'left' | 'right' | 'top' | 'bottom';

/*
 * src/client/layout/model.ts (배치 틀 쪽이 구현한다). 모두 순수 함수이고 결과는 정리된 상태다
 * (빈 그룹 없음, 자식이 하나인 split 없음, 같은 방향 split의 중첩 없음, sizes 합 1).
 *
 *   defaultLayout(): LayoutState
 *       왼쪽 ERD(넓게), 오른쪽 위 그룹에 relational, 오른쪽 아래 그룹에 ie, sql 탭(ie가 보임)
 *   movePane(state, pane, targetGroupId, edge: DropEdge, index?: number): LayoutState
 *   openPane(state, pane): LayoutState        이미 열려 있으면 그 탭을 보이게만 한다
 *   closePane(state, pane): LayoutState
 *   activatePane(state, pane): LayoutState
 *   resizeSplit(state, splitId, sizes: number[]): LayoutState
 *   toggleMaximize(state, groupId): LayoutState
 *   openPanes(state): PaneId[]
 *   loadLayout(): LayoutState / saveLayout(state): void   키 'modelll.layout'. 모르는 pane은 빼고 읽고, 깨진 값이면 기본 배치
 *
 * src/client/layout/DockLayout.tsx
 *
 *   <DockLayout
 *     state={LayoutState}
 *     onChange={(next: LayoutState) => void}
 *     renderPane={(pane: PaneId) => ReactNode}      pane 내용. 옮기거나 숨겨도 다시 마운트하지 않는다
 *     paneTitle={(pane: PaneId) => string}
 *     paneIcon={(pane: PaneId) => ReactNode}
 *     narrow={boolean}                               좁은 화면: 나누지 않고 탭 한 줄로 모든 pane을 보여 준다
 *   />
 *   각 pane의 바깥 요소에는 data-pane="<PaneId>" 속성이 붙는다(키보드 단축키를 어디에 적용할지 가리는 데 쓴다).
 *
 * src/client/layout/PaneMenu.tsx
 *
 *   <PaneMenu state onChange paneTitle />   네 pane의 열기 닫기(열린 것에 체크)와 레이아웃 초기화
 */
