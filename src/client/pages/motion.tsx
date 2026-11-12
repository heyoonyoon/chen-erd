/**
 * 첫 화면의 움직임. 화면에 들어올 때 한 번 나타나는 효과와, 움직임을 줄이도록 설정한 사용자를 위한 판단.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { SKIP_ATTR, runMosaic } from './mosaic';

/** 움직임을 써도 되는 환경인지. 움직임 줄이기를 켠 사용자와 테스트 환경에서는 처음부터 완성된 화면을 보여 준다 */
export function canAnimate(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function' || typeof window.IntersectionObserver !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 요소가 화면에 처음 들어왔는지. 한 번 들어오면 계속 true다 */
export function useInView<T extends Element>(rootMargin = '0px 0px -12% 0px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(() => !canAnimate());
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

/** 화면에 들어오면 아래에서 조금 올라오며 나타나는 구역. delay는 같은 줄의 요소를 차례로 띄울 때 쓴다(ms) */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'aside';
  [attr: `aria-${string}`]: string | undefined;
  'data-testid'?: string;
}) {
  const [ref, inView] = useInView<HTMLElement>();
  const names = ['home-reveal', inView ? 'is-in' : '', className ?? ''].filter(Boolean).join(' ');
  const style = delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined;
  return (
    <Tag ref={ref as RefObject<HTMLDivElement>} className={names} style={style} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * 화면에 들어오면 모자이크가 풀리며 드러나는 카드. ref는 덮을 요소(position: relative)에 달고 overlay는 그 안에 넣는다.
 * 움직임을 쓸 수 없는 환경에서는 overlay가 없고 처음부터 원래 모습이다.
 */
export function useMosaic<T extends HTMLElement>(options: { delay?: number; duration?: number } = {}): {
  ref: RefObject<T | null>;
  overlay: ReactNode;
  /** 모자이크가 다 풀렸는지. 움직임을 쓸 수 없는 환경에서는 처음부터 true다 */
  done: boolean;
} {
  const ref = useRef<T | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [on, setOn] = useState(canAnimate);
  const { delay, duration } = options;
  useLayoutEffect(() => {
    const host = ref.current;
    const canvas = canvasRef.current;
    if (!on || !host || !canvas) return;
    return runMosaic(host, canvas, { delay, duration, onDone: () => setOn(false) });
  }, [on, delay, duration]);
  const overlay = on ? <canvas ref={canvasRef} className="home-mosaic" aria-hidden="true" {...{ [SKIP_ATTR]: '' }} /> : null;
  return { ref, overlay, done: !on };
}
