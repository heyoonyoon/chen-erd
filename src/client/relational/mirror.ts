/**
 * 편집기 뒤에 겹쳐 그리는 층(거울)의 내용을 나눈다. 거울은 textarea와 같은 글꼴, 같은 여백, 같은 줄 높이로
 * 같은 글자를 투명하게 그리고 밑줄(기본키)과 물결 밑줄(문제)만 보이게 한다. 글자는 textarea가 그린다.
 * 그래서 거울의 각 줄은 원래 줄의 글자를 하나도 빼거나 더하지 않고 그대로 담아야 자리가 맞는다.
 */
import type { RelProblem } from '../../shared/relational/userSchema';
import type { TextRange } from './richText';

type Severity = RelProblem['severity'];

export interface Segment {
  text: string;
  underline: boolean;
  squiggle: Severity | null;
  /** 줄 끝이나 빠진 글자처럼 빈 구간의 문제 표시. 글자 폭을 차지하지 않는다(text는 빈 글) */
  empty?: boolean;
}

/** 글을 줄로 나누고 각 줄의 시작 자리(글 전체 기준)를 함께 준다 */
export function splitLines(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (const line of text.split('\n')) {
    out.push({ text: line, start });
    start += line.length + 1;
  }
  return out;
}

/**
 * 한 줄을 밑줄과 문제 구간의 경계로 나눈다. 이어 붙인 text는 원래 줄과 똑같다(빈 표시는 빈 글).
 * underlines는 글 전체 기준 구간, problems는 이 줄의 문제(칸은 1부터, endColumn은 끝 다음 칸).
 */
export function lineSegments(line: string, lineStart: number, underlines: readonly TextRange[], problems: readonly RelProblem[] = []): Segment[] {
  const len = line.length;
  const ul: TextRange[] = [];
  for (const r of underlines) {
    const a = Math.max(0, r.from - lineStart);
    const b = Math.min(len, r.to - lineStart);
    if (b > a) ul.push({ from: a, to: b });
  }
  const squiggles: Array<{ from: number; to: number; severity: Severity }> = [];
  const empties: Array<{ at: number; severity: Severity }> = [];
  for (const p of problems) {
    const from = Math.max(0, Math.min(len, p.column - 1));
    const rawEnd = p.endColumn !== undefined ? p.endColumn - 1 : len;
    const to = Math.max(from, Math.min(len, rawEnd));
    if (to > from) squiggles.push({ from, to, severity: p.severity });
    else empties.push({ at: from, severity: p.severity });
  }
  const cuts = new Set<number>([0, len]);
  for (const r of ul) cuts.add(r.from).add(r.to);
  for (const s of squiggles) cuts.add(s.from).add(s.to);
  for (const e of empties) cuts.add(e.at);
  const points = [...cuts].sort((a, b) => a - b);

  const out: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const at = points[i];
    // 같은 자리의 빈 표시는 하나만(오류가 경고보다 앞선다)
    const here = empties.filter((e) => e.at === at);
    if (here.length > 0) out.push({ text: '', underline: false, squiggle: here.some((e) => e.severity === 'error') ? 'error' : 'warning', empty: true });
    const next = points[i + 1];
    if (next === undefined || next <= at) continue;
    const underline = ul.some((r) => r.from <= at && at < r.to);
    const cover = squiggles.filter((s) => s.from <= at && at < s.to);
    const squiggle: Severity | null = cover.length === 0 ? null : cover.some((s) => s.severity === 'error') ? 'error' : 'warning';
    const last = out[out.length - 1];
    if (last && !last.empty && last.underline === underline && last.squiggle === squiggle) last.text += line.slice(at, next);
    else out.push({ text: line.slice(at, next), underline, squiggle });
  }
  return out;
}
