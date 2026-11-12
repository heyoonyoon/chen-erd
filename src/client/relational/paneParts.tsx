/**
 * 관계 모델 쪽 pane들이 함께 쓰는 틀과 훅: pane의 바깥 틀(머리 줄, 스크롤되는 본문, 키 처리),
 * 틀의 너비 재기(창 너비가 아니라 pane 너비로 배치를 바꾼다).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PaneId } from '../layout/types';
import './panes.css';

/** 요소의 너비(px)를 잰다. 아직 재지 못했으면 0 */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (w: number) => setWidth((cur) => (cur === Math.round(w) ? cur : Math.round(w)));
    set(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) set(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** 너비를 재지 못했을 때(0)는 넓은 배치로 본다 */
export const isNarrow = (width: number, below: number) => width > 0 && width < below;

interface FrameProps {
  pane: Exclude<PaneId, 'erd'>;
  frameRef: RefObject<HTMLDivElement | null>;
  /** 머리 줄의 조작. 없으면 머리 줄을 그리지 않는다 */
  tools?: ReactNode;
  toolsLabel?: string;
  /** 틀의 너비(px). 머리 줄이 좁으면 버튼 글자를 숨긴다 */
  width: number;
  /** 이 pane의 좁은 배치를 쓰는지 */
  narrow: boolean;
  bodyClass?: string;
  children: ReactNode;
  attrs?: Record<string, string | undefined>;
}

/** 머리 줄의 버튼 글자를 숨기는 너비 */
const TIGHT_HEAD = 460;

/**
 * pane의 바깥 틀. 부모를 가득 채우고 본문만 스크롤한다. 안의 키 입력은 캔버스 단축키로 넘기지 않는다
 * (window에 걸린 캔버스 단축키까지 올라가지 않게 여기서 멈춘다).
 */
export function PaneFrame({ pane, frameRef, tools, toolsLabel, width, narrow, bodyClass, children, attrs }: FrameProps) {
  return (
    <div
      ref={frameRef}
      className={`rp rp-${pane}`}
      data-testid={`pane-${pane}`}
      data-narrow={narrow || undefined}
      data-tight={isNarrow(width, TIGHT_HEAD) || undefined}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      {...attrs}
    >
      {tools && (
        <div className="rp-head" role="toolbar" aria-label={toolsLabel}>
          {tools}
        </div>
      )}
      <div className={`rp-body${bodyClass ? ` ${bodyClass}` : ''}`}>{children}</div>
    </div>
  );
}

/** pane 틀과 그 너비를 함께 준비한다 */
export function useFrame(): { frameRef: RefObject<HTMLDivElement | null>; width: number } {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useWidth(frameRef);
  return { frameRef, width };
}
