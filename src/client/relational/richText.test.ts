// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RelProblem } from '../../shared/relational/userSchema';
import { lineSegments, splitLines } from './mirror';
import {
  clipboardSource,
  fromRuns,
  htmlToSource,
  insertionRuns,
  isAllUnderlined,
  normalizeRanges,
  rangesFromDelta,
  shiftRanges,
  sliceSource,
  sourceToHtml,
  toRuns,
  underlineFromStyle,
} from './richText';

describe('밑줄 구간', () => {
  it('Y.Text의 delta에서 밑줄 구간을 읽고 맞닿은 구간을 합친다', () => {
    const delta = [{ insert: 'Player (' }, { insert: 'SS', attributes: { underline: true } }, { insert: 'N', attributes: { underline: true, x: 1 } }, { insert: ', Name)' }];
    expect(rangesFromDelta(delta)).toEqual([{ from: 8, to: 11 }]);
    expect(normalizeRanges([{ from: 5, to: 7 }, { from: 0, to: 2 }, { from: 6, to: 9 }, { from: 3, to: 3 }])).toEqual([
      { from: 0, to: 2 },
      { from: 5, to: 9 },
    ]);
  });

  it('덩어리로 나누고 다시 모은다. 줄바꿈에는 밑줄을 두지 않는다', () => {
    const src = { text: 'Player (SSN, Name)', underlines: [{ from: 8, to: 11 }] };
    expect(toRuns(src)).toEqual([
      { text: 'Player (', underline: false },
      { text: 'SSN', underline: true },
      { text: ', Name)', underline: false },
    ]);
    expect(fromRuns(toRuns(src))).toEqual(src);
    expect(fromRuns([{ text: 'a\nb', underline: true }])).toEqual({ text: 'a\nb', underlines: [{ from: 0, to: 1 }, { from: 2, to: 3 }] });
  });

  it('부분 잘라 내기와 모두 밑줄인지', () => {
    const src = { text: '학생 (학번, 이름)', underlines: [{ from: 4, to: 6 }] };
    expect(sliceSource(src, 3, 10)).toEqual({ text: '(학번, 이름', underlines: [{ from: 1, to: 3 }] });
    expect(isAllUnderlined(src, 4, 6)).toBe(true);
    expect(isAllUnderlined(src, 4, 7)).toBe(false);
    expect(isAllUnderlined({ text: 'a\nb', underlines: [{ from: 0, to: 1 }, { from: 2, to: 3 }] }, 0, 3)).toBe(true);
    expect(isAllUnderlined({ text: '\n', underlines: [] }, 0, 1)).toBe(false);
  });

  it('이어 치는 밑줄은 쉼표, 괄호, 줄바꿈에서 끝난다', () => {
    expect(insertionRuns('ID', true)).toEqual({ runs: [{ text: 'ID', underline: true }], ended: false });
    expect(insertionRuns(', Name', true)).toEqual({ runs: [{ text: ', Name', underline: false }], ended: true });
    expect(insertionRuns('번호)', true)).toEqual({
      runs: [
        { text: '번호', underline: true },
        { text: ')', underline: false },
      ],
      ended: true,
    });
    expect(insertionRuns('x', false)).toEqual({ runs: [{ text: 'x', underline: false }], ended: false });
  });

  it('바뀐 구간만큼 밑줄을 옮긴다. 둘레의 밑줄은 넣은 글을 덮지 않는다', () => {
    const ranges = [{ from: 2, to: 5 }, { from: 8, to: 10 }];
    // 밑줄 끝 바로 뒤에 넣기: 넣은 글의 밑줄은 inserted가 정한다
    expect(shiftRanges(ranges, 5, 0, { text: 'XY', underlines: [{ from: 0, to: 2 }] })).toEqual([{ from: 2, to: 7 }, { from: 10, to: 12 }]);
    expect(shiftRanges(ranges, 5, 0, { text: 'XY', underlines: [] })).toEqual([{ from: 2, to: 5 }, { from: 10, to: 12 }]);
    // 밑줄 가운데에 밑줄 없는 글을 넣으면 둘로 나뉜다
    expect(shiftRanges(ranges, 3, 1, { text: ',', underlines: [] })).toEqual([{ from: 2, to: 3 }, { from: 4, to: 5 }, { from: 8, to: 10 }]);
    // 밑줄을 통째로 지운다
    expect(shiftRanges(ranges, 1, 5, { text: '', underlines: [] })).toEqual([{ from: 3, to: 5 }]);
  });
});

describe('클립보드', () => {
  it('복사할 HTML은 밑줄을 <u>로 싸고 글자를 이스케이프한다. 읽으면 같은 글과 밑줄이 나온다', () => {
    const src = { text: 'Player (SSN, Name)\n\nT (<a>  &b)', underlines: [{ from: 8, to: 11 }, { from: 23, to: 26 }] };
    const html = sourceToHtml(src);
    expect(html).toContain('<u>SSN</u>');
    expect(html).toContain('&lt;a&gt;');
    expect(html).not.toContain('<a>');
    expect(htmlToSource(html)).toEqual(src);
  });

  it('Word의 HTML: <u>, text-decoration, mso 밑줄, 문단', () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0cm;font-size:11pt}</style></head>
<body lang=KO><!--StartFragment--><p class=MsoNormal><span lang=EN-US>Player (<u>SSN</u>, Name,
DOB)<o:p></o:p></span></p>
<p class=MsoNormal><span lang=EN-US style='text-decoration:underline'>Performer_ID</span><span lang=EN-US>, <span style='text-underline:single'>Film_ID</span>, Role</span></p>
<p class=MsoNormal><span lang=EN-US>Foreign&nbsp;Key (Performer_ID) references Performer (ID)</span></p><!--EndFragment--></body></html>`;
    const src = htmlToSource(html)!;
    expect(src.text).toBe('Player (SSN, Name, DOB)\nPerformer_ID, Film_ID, Role\nForeign Key (Performer_ID) references Performer (ID)');
    const words = src.underlines.map((r) => src.text.slice(r.from, r.to));
    expect(words).toEqual(['SSN', 'Performer_ID', 'Film_ID']);
  });

  it('Google 문서의 HTML: 밖은 굵게 표시가 아닌 <b>, 밑줄 없는 칸은 text-decoration:none', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;"><span style="font-size:11pt;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">학생 (</span><span style="font-size:11pt;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;white-space:pre-wrap;">학번</span><span style="text-decoration:none;white-space:pre-wrap;">, 이름)</span></p></b>';
    const src = htmlToSource(html)!;
    expect(src).toEqual({ text: '학생 (학번, 이름)', underlines: [{ from: 4, to: 6 }] });
  });

  it('<style>의 클래스 규칙으로 정한 밑줄도 읽는다(한글 같은 편집기)', () => {
    const html = '<html><head><style><!-- .u1 { text-decoration: underline } P.HStyle0 { margin: 0 } --></style></head><body><P CLASS=HStyle0><SPAN CLASS=u1>학번</SPAN>, 이름</P></body></html>';
    expect(htmlToSource(html)).toEqual({ text: '학번, 이름', underlines: [{ from: 0, to: 2 }] });
  });

  it('글과 밑줄만 꺼낸다. 스크립트와 그림은 읽지도 돌리지도 않는다', () => {
    const w = window as unknown as { pwned?: boolean };
    const before = document.body.innerHTML;
    const src = htmlToSource('<p>A<script>window.pwned = true; document.write("x")</script><img src="x" onerror="window.pwned = true"><style>p{}</style>B</p>')!;
    expect(src.text).toBe('AB');
    expect(w.pwned).toBeUndefined();
    expect(document.body.innerHTML).toBe(before);
  });

  it('style 글에서 밑줄 여부', () => {
    expect(underlineFromStyle('text-decoration: underline wavy red')).toBe(true);
    expect(underlineFromStyle('TEXT-DECORATION-LINE:UNDERLINE')).toBe(true);
    expect(underlineFromStyle('text-decoration:none')).toBe(false);
    expect(underlineFromStyle('text-underline:none')).toBe(false);
    expect(underlineFromStyle('color:red')).toBeNull();
  });

  it('HTML이 없으면 일반 텍스트를 친 그대로 쓴다(_이름_ 을 밑줄로 바꾸지 않는다)', () => {
    expect(clipboardSource('', '학생(_학번_, 이름)\r\n과목')).toEqual({ text: '학생(_학번_, 이름)\n과목', underlines: [] });
    expect(clipboardSource('<p>A <u>B</u></p>', 'A B')).toEqual({ text: 'A B', underlines: [{ from: 2, to: 3 }] });
    // 글이 없는 HTML(그림만)이면 일반 텍스트
    expect(clipboardSource('<img src="x">', 'plain')).toEqual({ text: 'plain', underlines: [] });
  });
});

// ───────────────────────── 겹쳐 그리기 ─────────────────────────

const problem = (column: number, endColumn: number | undefined, severity: RelProblem['severity'] = 'error'): RelProblem =>
  ({ line: 1, column, endColumn, severity, message: { key: 'x' } }) as unknown as RelProblem;

describe('거울(겹쳐 그리는 층)', () => {
  it('줄과 줄의 시작 자리', () => {
    expect(splitLines('ab\n\n학생')).toEqual([
      { text: 'ab', start: 0 },
      { text: '', start: 3 },
      { text: '학생', start: 4 },
    ]);
  });

  it('잇댄 글은 원래 줄과 같다(한글, 긴 줄, 탭). 밑줄은 글 전체 기준 구간을 그 줄로 자른다', () => {
    const text = 'Player (SSN, Name)\n학생\t(학번, 이름, 학과코드)\n' + 'Long_' + 'x'.repeat(300) + ' (Key_Column)';
    const ranges = [{ from: 8, to: 11 }, { from: 23, to: 25 }, { from: text.lastIndexOf('Key_Column'), to: text.lastIndexOf('Key_Column') + 10 }];
    for (const line of splitLines(text)) {
      const segs = lineSegments(line.text, line.start, ranges, [problem(2, 4)]);
      expect(segs.map((s) => s.text).join('')).toBe(line.text);
    }
    const [, korean, long] = splitLines(text);
    const k = lineSegments(korean.text, korean.start, ranges);
    expect(k.filter((s) => s.underline).map((s) => s.text)).toEqual(['학번']);
    const l = lineSegments(long.text, long.start, ranges);
    expect(l.filter((s) => s.underline).map((s) => s.text)).toEqual(['Key_Column']);
  });

  it('밑줄과 문제 구간이 겹치면 겹친 칸만 둘 다 표시하고, 오류가 경고보다 앞선다', () => {
    const segs = lineSegments('Player (SSN, Name)', 0, [{ from: 8, to: 11 }], [problem(10, 15, 'warning'), problem(11, 13, 'error')]);
    expect(segs).toEqual([
      { text: 'Player (', underline: false, squiggle: null },
      { text: 'S', underline: true, squiggle: null },
      { text: 'S', underline: true, squiggle: 'warning' },
      { text: 'N', underline: true, squiggle: 'error' },
      { text: ',', underline: false, squiggle: 'error' },
      { text: ' N', underline: false, squiggle: 'warning' },
      { text: 'ame)', underline: false, squiggle: null },
    ]);
  });

  it('빈 구간의 문제는 폭이 없는 표시 하나(뒤 글자를 밀지 않는다)', () => {
    const segs = lineSegments('T (a', 0, [], [problem(5, 5), problem(5, undefined, 'warning'), problem(2, 2, 'warning')]);
    expect(segs.map((s) => s.text).join('')).toBe('T (a');
    expect(segs.filter((s) => s.empty)).toEqual([
      { text: '', underline: false, squiggle: 'warning', empty: true },
      { text: '', underline: false, squiggle: 'error', empty: true },
    ]);
    expect(lineSegments('', 0, [])).toEqual([]);
  });
});
