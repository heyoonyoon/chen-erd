/**
 * pane 사이의 강조. 다른 pane이 "이 Chen 도형을 보라"고 알리면(지금은 관계 모델 쪽 pane이 쓰지 않는다)
 * ERD pane이 그 도형을 강조한다. 선택이나 문서는 바꾸지 않는 표시일 뿐이고 내 브라우저에만 있다.
 * (계약 파일: 관계 모델 쪽이 쓰고 캔버스 쪽이 읽는다.)
 */
import { create } from 'zustand';

export interface ErdHighlightState {
  /** 강조할 Chen 노드와 엣지 id. 비어 있으면 강조 없음 */
  ids: readonly string[];
  /** 강조를 건 쪽. 같은 쪽이 다시 걸거나 지울 때 구분하는 데 쓴다 */
  source: 'steps' | 'choice' | 'table' | 'note' | null;
  /**
   * 강조한 도형이 화면 밖에 있으면 보이게 옮겨 달라는 요청. 요청할 때마다 1씩 오른다.
   * 캔버스는 이 값이 바뀌었을 때만 화면을 옮긴다(강조만 바꿀 때는 화면을 움직이지 않는다).
   */
  revealToken: number;
}

export const useErdHighlight = create<ErdHighlightState>(() => ({ ids: [], source: null, revealToken: 0 }));

const EMPTY: readonly string[] = [];

/** 강조를 건다. reveal이면 ERD가 그 도형을 화면 안으로 옮긴다 */
export function setErdHighlight(ids: readonly string[], source: ErdHighlightState['source'], reveal = false): void {
  useErdHighlight.setState((s) => ({
    ids: ids.length > 0 ? ids : EMPTY,
    source: ids.length > 0 ? source : null,
    revealToken: reveal && ids.length > 0 ? s.revealToken + 1 : s.revealToken,
  }));
}

/** source가 주어지면 그쪽이 건 강조일 때만 지운다 */
export function clearErdHighlight(source?: ErdHighlightState['source']): void {
  useErdHighlight.setState((s) => (source && s.source !== source ? s : { ids: EMPTY, source: null }));
}
