/**
 * 캔버스 단축키를 어디에 적용할지 가린다. [담당: canvas 에이전트]
 *
 * 방 화면은 여러 pane(ERD, 관계 모델, IE, SQL)으로 나뉘고, 각 pane의 바깥 요소에는
 * data-pane="<종류>"가 붙는다(src/client/layout/types.ts). 캔버스 단축키는 ERD pane 안에서 일어난 키에만 반응한다.
 *
 * 규칙
 * - 문서에 [data-pane]이 하나도 없으면(옛 화면, 테스트) 언제나 적용한다.
 * - 대상이 [data-pane="erd"] 안이면 적용한다.
 * - 대상이 body(아무것도 포커스 안 됨)거나 요소가 아니면, ERD 캔버스가 화면에 보일 때만 적용한다.
 * - 그 밖(다른 pane 안, pane 밖의 상단 바 등)은 적용하지 않는다.
 * 입력창 판정(input, textarea, contenteditable)은 shortcuts.ts가 따로 한다.
 */
import { ui } from '../state/ui';

export const ERD_PANE = 'erd';
const PANE_ATTR = 'data-pane';

/** 떠 있는 캔버스 루트들. 숨김/분리 판정에 쓴다 */
const roots = new Set<Element>();

/** Canvas가 뜰 때 자기 루트를 알린다. 돌려준 함수로 해제한다 */
export function registerCanvasRoot(el: Element): () => void {
  roots.add(el);
  return () => {
    roots.delete(el);
  };
}

/**
 * 캔버스 루트 하나가 보이는지. 배치 틀은 비활성 탭의 pane을 크기를 지닌 채로 숨김 보관함
 * (inert, visibility:hidden)에 두므로, 크기나 문서에 붙어 있는지만으로는 가릴 수 없다.
 */
function rootShown(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.closest('[inert]') !== null) return false;
  const check = (el as Element & { checkVisibility?: (o?: { visibilityProperty?: boolean }) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(el, { visibilityProperty: true })) return false;
  return true;
}

/** ERD 캔버스가 지금 화면에 보이는지(크기가 0이 아니고, 문서에 붙어 있고, 숨김 보관함 안이 아니다) */
export function isErdCanvasShown(): boolean {
  const { w, h } = ui().canvasSize;
  if (!(w > 0 && h > 0)) return false;
  if (roots.size === 0) return true;
  for (const el of roots) if (rootShown(el)) return true;
  return false;
}

/** 문서에 pane 배치가 있는지 */
function hasPanes(doc: Document): boolean {
  return doc.querySelector(`[${PANE_ATTR}]`) !== null;
}

/** 이 이벤트 대상에서 캔버스 단축키, 복사/붙여넣기, 스페이스 화면 이동을 처리해도 되는지 */
export function isInErdScope(target: EventTarget | null): boolean {
  if (typeof document === 'undefined') return true;
  if (!hasPanes(document)) return true;
  const el = target instanceof Element ? target : null;
  if (!el || el === document.body || el === document.documentElement) return isErdCanvasShown();
  const pane = el.closest(`[${PANE_ATTR}]`);
  if (!pane) return false;
  return pane.getAttribute(PANE_ATTR) === ERD_PANE;
}
