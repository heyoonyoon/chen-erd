/**
 * 관계 모델 글 편집기. 방의 Y.Text를 팀원과 함께 고친다(yTextBinding.ts).
 * 줄 번호 칸에 문제가 있는 줄을 빨간색(오류)이나 주황색(경고) 점으로 표시하고, 그 자리에 물결 밑줄을 긋는다.
 * 표시된 줄 번호에 마우스를 올리거나 캐럿이 그 줄에 있으면 문제 문장을 줄 바로 아래에 띄운다.
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import type * as Y from 'yjs';
import type { RelProblem } from '../../shared/relational/userSchema';
import { msgText, ProblemIcon } from './common';
import { lineSegments, splitLines, type Segment } from './mirror';
import { useRelPanes } from './paneStore';
import type { RelationalSource } from './richText';
import { TextareaBinding, lineAt, offsetAt, readSource } from './yTextBinding';

/** 줄 높이와 위 여백(px). panes.css의 .rel-editor와 같아야 한다 */
export const LINE_PX = 21;
const PAD_TOP = 10;

/** Y.Text의 지금 글. 누가 고치든 바뀔 때마다 다시 그린다 */
export function useYText(ytext: Y.Text): string {
  return useSyncExternalStore(
    (notify) => {
      ytext.observe(notify);
      return () => ytext.unobserve(notify);
    },
    () => ytext.toString(),
  );
}

/** Y.Text마다 지금 글과 밑줄을 한 번만 읽어 둔다(바뀌면 다시 읽는다) */
const sources = new WeakMap<Y.Text, { value: RelationalSource | null }>();
function sourceSlot(ytext: Y.Text): { value: RelationalSource | null } {
  let slot = sources.get(ytext);
  if (!slot) {
    const made: { value: RelationalSource | null } = { value: null };
    // 글이 바뀌면(서식 바꾸기 포함) 읽어 둔 것을 버린다. 구독보다 먼저 불려도 늦은 값을 주지 않게 따로 건다
    ytext.observe(() => {
      made.value = null;
    });
    sources.set(ytext, made);
    slot = made;
  }
  return slot;
}

/** Y.Text의 지금 글과 밑줄 구간. 누가 고치든(밑줄만 바꿔도) 바뀔 때마다 다시 그린다 */
export function useYSource(ytext: Y.Text): RelationalSource {
  return useSyncExternalStore(
    (notify) => {
      ytext.observe(notify);
      return () => ytext.unobserve(notify);
    },
    () => {
      const slot = sourceSlot(ytext);
      if (!slot.value) slot.value = readSource(ytext);
      return slot.value;
    },
  );
}

type Severity = RelProblem['severity'];

/** 줄마다의 문제(1부터). 문제의 줄이 글보다 뒤면 마지막 줄로 모은다 */
function problemsByLine(problems: readonly RelProblem[], lineCount: number): Map<number, RelProblem[]> {
  const out = new Map<number, RelProblem[]>();
  for (const p of problems) {
    const line = Math.max(1, Math.min(lineCount, p.line));
    const list = out.get(line) ?? [];
    list.push(p);
    out.set(line, list);
  }
  return out;
}

const worst = (list: readonly RelProblem[]): Severity => (list.some((p) => p.severity === 'error') ? 'error' : 'warning');

/** 거울의 한 줄: 글자는 투명하고 밑줄(기본키)과 물결 밑줄(문제)만 보인다. 글자는 하나도 빼거나 더하지 않는다 */
function MirrorLine({ segments }: { segments: Segment[] }): ReactNode {
  if (segments.length === 0) return '\u200b';
  return segments.map((seg, i) => {
    if (seg.empty) {
      // 빈 구간(줄 끝, 빠진 글자): 폭을 차지하지 않는 한 칸짜리 물결 밑줄
      return (
        <span key={i} className={`rel-squiggle is-${seg.squiggle} is-empty`}>
          {'\u00a0'}
        </span>
      );
    }
    let node: ReactNode = seg.text;
    if (seg.squiggle) node = <span className={`rel-squiggle is-${seg.squiggle}`}>{node}</span>;
    if (seg.underline) node = <span className="rel-ul">{node}</span>;
    return <span key={i}>{node}</span>;
  });
}

/** 편집기 밖(도구 버튼)에서 부르는 일 */
export interface EditorHandle {
  toggleUnderline(): void;
}

interface Props {
  ytext: Y.Text;
  /** 지금 글과 밑줄(useYSource). 줄 번호와 표시를 그리는 데 쓴다 */
  source: RelationalSource;
  problems: readonly RelProblem[];
  placeholder: string;
  label: string;
  handle?: Ref<EditorHandle>;
  /** 캐럿 자리(또는 고른 구간)의 밑줄 상태가 바뀌면 알린다 */
  onUnderlineState?: (on: boolean) => void;
}

export function RelationalEditor({ ytext, source, problems, placeholder, label, handle, onUnderlineState }: Props) {
  const text = source.text;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const bindingRef = useRef<TextareaBinding | null>(null);
  /** 한글 조합 중에 거울이 그릴 글(아직 문서에 쓰지 않은 글자 포함) */
  const [preview, setPreview] = useState<RelationalSource | null>(null);
  const stateRef = useRef(onUnderlineState);
  stateRef.current = onUnderlineState;

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    let last: boolean | null = null;
    const report = () => {
      const on = binding.underlineActive();
      if (on === last) return;
      last = on;
      stateRef.current?.(on);
    };
    const binding = new TextareaBinding(ytext, el, { onFormatState: () => report() });
    bindingRef.current = binding;
    report();
    return () => {
      bindingRef.current = null;
      binding.destroy();
    };
  }, [ytext]);

  useImperativeHandle(
    handle,
    () => ({
      toggleUnderline: () => {
        const binding = bindingRef.current;
        if (!binding) return;
        binding.toggleUnderline();
        areaRef.current?.focus({ preventScroll: true });
      },
    }),
    [],
  );

  const lines = useMemo(() => text.split('\n'), [text]);
  const shownSource = preview ?? source;
  const mirror = useMemo(() => splitLines(shownSource.text), [shownSource.text]);
  const byLine = useMemo(() => problemsByLine(problems, lines.length), [problems, lines.length]);

  const syncScroll = () => {
    const el = areaRef.current;
    if (!el) return;
    setScroll((s) => (s.top === el.scrollTop && s.left === el.scrollLeft ? s : { top: el.scrollTop, left: el.scrollLeft }));
    setHeight(el.clientHeight);
  };
  const syncCaret = () => {
    const el = areaRef.current;
    if (!el) return;
    setCaretLine(document.activeElement === el ? lineAt(el.value, el.selectionStart) : null);
    const binding = bindingRef.current;
    if (binding) stateRef.current?.(binding.underlineActive());
  };
  const syncPreview = () => {
    const binding = bindingRef.current;
    setPreview(binding && binding.isComposing ? binding.previewSource() : null);
  };

  // 남의 입력으로 글이 바뀌면 캐럿 줄과 스크롤도 다시 잰다
  useEffect(() => {
    syncScroll();
    syncCaret();
  }, [text]);

  // 다른 pane이 이 편집기의 한 자리를 보여 달라고 했을 때(IE의 오류 배지, 테이블 누르기)
  const reveal = useRelPanes((s) => s.reveal);
  useEffect(() => {
    if (!reveal) return;
    let frame = 0;
    let tries = 0;
    const go = () => {
      const el = areaRef.current;
      // 탭이 막 열린 참이면 보일 때까지 몇 번 기다린다
      if (!el || (el.offsetParent === null && el.getClientRects().length === 0 && tries++ < 10)) {
        frame = requestAnimationFrame(go);
        return;
      }
      const start = offsetAt(el.value, reveal.line, reveal.column);
      const end = reveal.endColumn !== undefined ? offsetAt(el.value, reveal.line, reveal.endColumn) : start;
      el.focus({ preventScroll: true });
      el.setSelectionRange(start, Math.max(start, end));
      el.scrollTop = Math.max(0, (reveal.line - 1) * LINE_PX - el.clientHeight / 3);
      syncScroll();
      syncCaret();
    };
    frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  const shownLine = hoverLine ?? caretLine;
  const shown = shownLine !== null ? byLine.get(shownLine) : undefined;
  const popTop = shownLine !== null ? PAD_TOP + shownLine * LINE_PX - scroll.top + 2 : 0;
  const popAbove = height > 0 && popTop + 48 > height;
  const errorCount = problems.filter((p) => p.severity === 'error').length;

  return (
    <div className="rel-editor-frame" data-testid="relational-editor-frame">
      <div ref={gutterRef} className="rel-gutter" aria-hidden="true">
        <div style={{ transform: `translateY(${-scroll.top}px)` }}>
          {lines.map((_, i) => {
            const list = byLine.get(i + 1);
            const sev = list ? worst(list) : null;
            return (
              <span
                key={i}
                className={sev ? `is-${sev}` : undefined}
                data-line={i + 1}
                data-problem={sev ?? undefined}
                onMouseEnter={list ? () => setHoverLine(i + 1) : undefined}
                onMouseLeave={list ? () => setHoverLine(null) : undefined}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      </div>
      <div className="rel-editor-area">
        <div ref={marksRef} className="rel-editor-marks" aria-hidden="true" data-testid="relational-marks">
          <div style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
            {mirror.map((line, i) => (
              <div key={i} className="rel-editor-markline" data-line={i + 1}>
                <MirrorLine segments={lineSegments(line.text, line.start, shownSource.underlines, byLine.get(i + 1))} />
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={areaRef}
          className="rel-editor"
          data-testid="relational-editor"
          aria-label={label}
          aria-invalid={errorCount > 0 || undefined}
          aria-describedby={shown ? 'rel-problem-pop' : undefined}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          onScroll={syncScroll}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onMouseUp={syncCaret}
          onFocus={syncCaret}
          onBlur={() => setCaretLine(null)}
          onInput={syncPreview}
          onCompositionEnd={() => setPreview(null)}
        />
        {shown && (
          <div
            id="rel-problem-pop"
            className={`rel-problem-pop is-${worst(shown)}${popAbove ? ' is-above' : ''}`}
            role="status"
            data-testid="relational-problem"
            style={{ top: popAbove ? popTop - LINE_PX - 4 : popTop }}
          >
            {shown.map((p, i) => (
              <p key={i} className={`is-${p.severity}`}>
                <ProblemIcon severity={p.severity} />
                <span className="rel-problem-msg">{msgText(p.message)}</span>
                <span className="rel-problem-at">
                  {label} {p.line}:{p.column}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
