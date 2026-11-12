/**
 * 관계 모델 쪽 pane(관계 모델, IE 다이어그램, SQL)이 함께 읽는 화면 상태. 내 브라우저에만 있다.
 * pane은 서로 형제라서 둘 이상이 읽는 값은 여기에 둔다. 이 파일은 엔진을 가져오지 않는다
 * (방 화면이 처음부터 불러도 가볍다).
 */
import { create } from 'zustand';
import type { SqlDialect } from '../../shared/relational/userSchema';
import { DIALECT_KEY, readDialect, writeLocal } from './storage';

/** 관계 모델 편집기에서 고를 자리(줄과 칸은 1부터, endColumn은 끝 바로 다음 칸) */
export interface EditorSpot {
  line: number;
  column: number;
  endColumn?: number;
}

export interface RelPaneState {
  /** SQL pane의 방언. 이 브라우저에 기억한다 */
  dialect: SqlDialect;
  /** 다른 pane이 편집기에 "이 자리를 보여 달라"고 한 것. 요청할 때마다 token이 오른다. 배치 쪽은 이것을 보고 관계 모델 pane을 연다 */
  reveal: (EditorSpot & { token: number }) | null;
}

const initial = (): RelPaneState => ({ dialect: readDialect(), reveal: null });

export const useRelPanes = create<RelPaneState>(initial);

export function setDialect(dialect: SqlDialect): void {
  useRelPanes.setState({ dialect });
  writeLocal(DIALECT_KEY, dialect);
}

/** 관계 모델 편집기를 보이게 하고 그 자리를 고른다(IE의 오류 배지, 테이블 누르기) */
export function revealInEditor(spot: EditorSpot): void {
  useRelPanes.setState((s) => ({ reveal: { ...spot, token: (s.reveal?.token ?? 0) + 1 } }));
}

/** 처음 상태로(테스트) */
export function resetRelPanes(): void {
  useRelPanes.setState(initial());
}
