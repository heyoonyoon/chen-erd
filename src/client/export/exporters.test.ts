import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { diagramBounds } from '../../shared/geometry';
import type { ErdEdge, ErdFile, ErdNode } from '../../shared/types';
import { addEdges, addNodes, getEdges, getNodes, getTitle, setTitle } from '../collab/docOps';
import {
  buildSvgString,
  copyPngToClipboard,
  downloadPng,
  downloadSvg,
  expandPaintOrder,
  exportBounds,
  importErdFile,
  parseErdFile,
  renderPngBlob,
  safeFilename,
  stripHitAreas,
  toErdFile,
} from './exporters';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, fitScale, readPngDpi, setPngDpi } from './png';

const student: ErdNode = { id: 'n1', kind: 'entity', x: 100, y: 100, w: 140, h: 60, text: '학생' };
const enroll: ErdNode = { id: 'n2', kind: 'relationship', x: 320, y: 90, w: 140, h: 80, text: '수강', identifying: true };
const sid: ErdNode = { id: 'n3', kind: 'attribute', x: 100, y: 0, w: 120, h: 50, text: '학번', keyType: 'key' };
const spec: ErdNode = { id: 'n4', kind: 'spec', x: 150, y: 200, w: 34, h: 34, text: '', specType: 'o' };
const nodes: ErdNode[] = [student, enroll, sid, spec];
const edges: ErdEdge[] = [
  { id: 'e1', source: 'n1', target: 'n2', double: true, label: 'N', role: '수강생' },
  { id: 'e2', source: 'n1', target: 'n3', double: false, label: '', role: '' },
];

function fileOf(over: Partial<Record<keyof ErdFile, unknown>> = {}): string {
  return JSON.stringify({ format: 'chen-erd', version: 1, title: '수강 신청', nodes, edges, ...over });
}

function docWith(ns: ErdNode[], es: ErdEdge[], title = ''): Y.Doc {
  const doc = new Y.Doc();
  addNodes(doc, ns);
  addEdges(doc, es);
  if (title) setTitle(doc, title);
  return doc;
}

describe('safeFilename', () => {
  it('한글은 그대로 두고 공백은 밑줄로 바꾼다', () => {
    expect(safeFilename('수강 신청 ERD')).toBe('수강_신청_ERD');
    expect(safeFilename('  DB   설계\t과제\n1  ')).toBe('DB_설계_과제_1');
  });
  it('파일 이름에 쓸 수 없는 문자와 제어 문자를 지운다', () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(safeFilename('과제\u0000\u0007 1')).toBe('과제_1');
    expect(safeFilename('3 / 4')).toBe('3_4');
  });
  it('비면 erd', () => {
    expect(safeFilename('')).toBe('erd');
    expect(safeFilename('   ')).toBe('erd');
    expect(safeFilename('///???')).toBe('erd');
    expect(safeFilename('...')).toBe('erd');
  });
  it('60자로 자른다', () => {
    expect(safeFilename('가'.repeat(100))).toBe('가'.repeat(60));
    expect(Array.from(safeFilename('😀'.repeat(100)))).toHaveLength(60);
  });
  it('앞뒤의 점은 뗀다', () => {
    expect(safeFilename('.숨김')).toBe('숨김');
    expect(safeFilename('v1.2.')).toBe('v1.2');
  });
  it('풀어 쓴 한글(NFD)은 합친다', () => {
    expect(safeFilename('한글'.normalize('NFD'))).toBe('한글');
  });
});

describe('parseErdFile', () => {
  it('정상 파일을 읽는다', () => {
    const file = parseErdFile(fileOf());
    expect(file.format).toBe('chen-erd');
    expect(file.version).toBe(1);
    expect(file.title).toBe('수강 신청');
    expect(file.nodes).toEqual(nodes);
    expect(file.edges).toEqual(edges);
  });

  it('BOM이 붙어 있어도 읽는다', () => {
    expect(parseErdFile(`﻿${fileOf()}`).nodes).toHaveLength(4);
  });

  it('모르는 필드는 버리고 빠진 선택 필드는 기본값으로 채운다', () => {
    const file = parseErdFile(
      JSON.stringify({
        format: 'chen-erd',
        version: 1,
        extra: true,
        nodes: [
          { id: 'a', kind: 'entity', x: 0, y: 0, w: 10, h: 10, color: 'red', selected: true },
          { id: 'b', kind: 'spec', x: 0, y: 0, w: 34, h: 34 },
        ],
        edges: [{ id: 'e', source: 'a', target: 'b', label: 1, bend: 3 }],
      }),
    );
    expect(file.title).toBe('');
    expect(file.nodes[0]).toEqual({ id: 'a', kind: 'entity', x: 0, y: 0, w: 10, h: 10, text: '' });
    expect(file.nodes[1]).toEqual({ id: 'b', kind: 'spec', x: 0, y: 0, w: 34, h: 34, text: '', specType: 'd' });
    expect(file.edges[0]).toEqual({ id: 'e', source: 'a', target: 'b', double: false, label: '1', role: '' });
    expect(Object.keys(file)).toEqual(['format', 'version', 'title', 'nodes', 'edges']);
  });

  it('JSON이 아니면 알려 준다', () => {
    expect(() => parseErdFile('')).toThrow('비어');
    expect(() => parseErdFile('{ nodes: ')).toThrow('JSON 형식이 아닙니다');
    expect(() => parseErdFile('[]')).toThrow('Chen ERD 파일이 아닙니다');
    expect(() => parseErdFile('null')).toThrow('Chen ERD 파일이 아닙니다');
  });

  it('format과 version을 검사한다', () => {
    expect(() => parseErdFile(fileOf({ format: 'drawio' }))).toThrow(/format.*"drawio"/);
    expect(() => parseErdFile(fileOf({ format: undefined }))).toThrow(/format/);
    expect(() => parseErdFile(fileOf({ version: 2 }))).toThrow(/버전.*2/);
    expect(() => parseErdFile(fileOf({ version: '1' }))).toThrow(/버전/);
  });

  it('nodes와 edges가 배열이어야 한다', () => {
    expect(() => parseErdFile(fileOf({ nodes: {} }))).toThrow(/nodes.*배열/);
    expect(() => parseErdFile(fileOf({ edges: undefined }))).toThrow(/edges.*배열/);
    expect(() => parseErdFile(fileOf({ nodes: [null], edges: [] }))).toThrow(/nodes\[0\].*객체/);
  });

  it('노드의 필수 필드와 kind를 검사하고 어느 항목인지 알려 준다', () => {
    const bad = (patch: object) => fileOf({ nodes: [student, { ...enroll, ...patch }], edges: [] });
    expect(() => parseErdFile(bad({ id: '' }))).toThrow(/nodes\[1\].*id/);
    expect(() => parseErdFile(bad({ id: 7 }))).toThrow(/nodes\[1\].*id/);
    expect(() => parseErdFile(bad({ kind: 'table' }))).toThrow(/nodes\[1\].*kind.*"table"/);
    expect(() => parseErdFile(bad({ kind: undefined }))).toThrow(/nodes\[1\].*kind/);
    expect(() => parseErdFile(bad({ x: '10' }))).toThrow(/nodes\[1\].*x.*숫자/);
    expect(() => parseErdFile(bad({ y: undefined }))).toThrow(/nodes\[1\].*y.*숫자/);
    expect(() => parseErdFile(bad({ w: 0 }))).toThrow(/nodes\[1\].*크기/);
    expect(() => parseErdFile(bad({ h: -5 }))).toThrow(/nodes\[1\].*크기/);
    expect(() => parseErdFile(bad({ text: {} }))).toThrow(/nodes\[1\].*text/);
    expect(() => parseErdFile(bad({ identifying: 'yes' }))).toThrow(/nodes\[1\].*identifying/);
    expect(() => parseErdFile(bad({ keyType: 'primary' }))).toThrow(/nodes\[1\].*keyType/);
    expect(() => parseErdFile(bad({ specType: 'x' }))).toThrow(/nodes\[1\].*specType/);
  });

  it('유한하지 않은 숫자를 거른다', () => {
    // JSON에는 NaN, Infinity가 없어 null이나 1e999로 들어온다
    const withH = (h: string) => `{"format":"chen-erd","version":1,"nodes":[{"id":"a","kind":"entity","x":0,"y":0,"w":10,"h":${h}}],"edges":[]}`;
    expect(() => parseErdFile(withH('1e999'))).toThrow(/nodes\[0\].*h.*숫자/);
    expect(() => parseErdFile(withH('null'))).toThrow(/nodes\[0\].*h.*숫자/);
  });

  it('겹치는 id를 거른다', () => {
    expect(() => parseErdFile(fileOf({ nodes: [student, { ...enroll, id: 'n1' }], edges: [] }))).toThrow(/nodes\[1\].*"n1".*겹칩니다/);
    expect(() => parseErdFile(fileOf({ edges: [edges[0], { ...edges[1], id: 'e1' }] }))).toThrow(/edges\[1\].*"e1".*겹칩니다/);
    expect(() => parseErdFile(fileOf({ edges: [{ ...edges[0], id: 'n2' }] }))).toThrow(/edges\[0\].*"n2".*겹칩니다/);
  });

  it('선의 양 끝이 nodes에 있어야 한다', () => {
    expect(() => parseErdFile(fileOf({ edges: [{ ...edges[0], target: 'ghost' }] }))).toThrow(/edges\[0\].*target.*"ghost"/);
    expect(() => parseErdFile(fileOf({ edges: [{ ...edges[0], source: undefined }] }))).toThrow(/edges\[0\].*source/);
    expect(() => parseErdFile(fileOf({ edges: [{ ...edges[0], double: 1 }] }))).toThrow(/edges\[0\].*double/);
    expect(() => parseErdFile(fileOf({ edges: [{ ...edges[0], role: [] }] }))).toThrow(/edges\[0\].*role/);
    expect(() => parseErdFile(fileOf({ edges: ['e1'] }))).toThrow(/edges\[0\].*객체/);
  });
});

describe('toErdFile', () => {
  it('문서 내용을 담는다', () => {
    const file = toErdFile(docWith(nodes, edges, '수강 신청'));
    expect(file).toEqual({ format: 'chen-erd', version: 1, title: '수강 신청', nodes, edges });
  });

  it('parseErdFile과 왕복해도 그대로다', () => {
    const file = toErdFile(docWith(nodes, edges, '왕복'));
    expect(parseErdFile(JSON.stringify(file))).toEqual(file);
    expect(parseErdFile(JSON.stringify(file, null, 2))).toEqual(file);

    const doc2 = new Y.Doc();
    importErdFile(doc2, parseErdFile(JSON.stringify(file)), 'replace');
    expect(toErdFile(doc2)).toEqual(file);
  });

  it('끝이 사라진 선과 모르는 필드는 담지 않는다', () => {
    const doc = docWith([{ ...student, junk: 1 } as ErdNode], [{ id: 'e9', source: 'n1', target: 'gone', double: false, label: '', role: '' }]);
    const file = toErdFile(doc);
    expect(file.nodes).toEqual([student]);
    expect(file.edges).toEqual([]);
    expect(() => parseErdFile(JSON.stringify(file))).not.toThrow();
  });

  it('빈 문서', () => {
    const file = toErdFile(new Y.Doc());
    expect(file).toEqual({ format: 'chen-erd', version: 1, title: '', nodes: [], edges: [] });
    expect(parseErdFile(JSON.stringify(file))).toEqual(file);
  });
});

describe('importErdFile', () => {
  const file: ErdFile = { format: 'chen-erd', version: 1, title: '불러온 그림', nodes, edges };
  const old: ErdNode = { id: 'old', kind: 'entity', x: -200, y: 40, w: 100, h: 50, text: '기존' };
  const oldEdgeTarget: ErdNode = { id: 'old2', kind: 'attribute', x: -50, y: 300, w: 120, h: 50, text: '기존 속성' };
  const oldEdge: ErdEdge = { id: 'olde', source: 'old', target: 'old2', double: false, label: '', role: '' };

  it('replace: 기존 내용을 지우고 파일 내용과 제목으로 바꾼다', () => {
    const doc = docWith([old, oldEdgeTarget], [oldEdge], '예전 제목');
    const ids = importErdFile(doc, file, 'replace');
    expect(ids).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(getNodes(doc)).toEqual(nodes);
    expect(getEdges(doc)).toEqual(edges);
    expect(getTitle(doc)).toBe('불러온 그림');
  });

  it('replace: 파일에 제목이 없으면 기존 제목을 둔다', () => {
    const doc = docWith([old], [], '예전 제목');
    importErdFile(doc, { ...file, title: '' }, 'replace');
    expect(getTitle(doc)).toBe('예전 제목');
    expect(getNodes(doc)).toHaveLength(4);
  });

  it('replace: 실행 취소 한 번으로 되돌아간다', () => {
    const doc = docWith([old], [], '예전 제목');
    const undo = new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges'), doc.getMap('meta')], { trackedOrigins: new Set(['local']) });
    importErdFile(doc, file, 'replace');
    undo.undo();
    expect(getNodes(doc)).toEqual([old]);
    expect(getEdges(doc)).toEqual([]);
    expect(getTitle(doc)).toBe('예전 제목');
  });

  it('merge: 새 id를 붙이고 선의 연결을 유지한다', () => {
    const doc = docWith([old, oldEdgeTarget], [oldEdge], '예전 제목');
    const ids = importErdFile(doc, file, 'merge');

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(['n1', 'n2', 'n3', 'n4', 'old', 'old2']).not.toContain(id);

    const after = getNodes(doc);
    const afterEdges = getEdges(doc);
    expect(after).toHaveLength(6);
    expect(afterEdges).toHaveLength(3);
    // 기존 내용과 제목은 그대로
    expect(after.find((n) => n.id === 'old')).toEqual(old);
    expect(afterEdges.find((e) => e.id === 'olde')).toEqual(oldEdge);
    expect(getTitle(doc)).toBe('예전 제목');

    // 넣은 순서대로 원본과 짝지어 내용과 연결을 확인한다
    const added = ids.map((id) => after.find((n) => n.id === id)!);
    added.forEach((n, i) => {
      const { id: _a, x: _b, y: _c, ...rest } = n;
      const { id: _d, x: _e, y: _f, ...orig } = nodes[i];
      expect(rest).toEqual(orig);
    });
    const newIdOf = new Map(nodes.map((n, i) => [n.id, ids[i]]));
    const newEdges = afterEdges.filter((e) => e.id !== 'olde');
    expect(newEdges.map((e) => e.id)).not.toContain('e1');
    for (const orig of edges) {
      const copy = newEdges.find((e) => e.source === newIdOf.get(orig.source) && e.target === newIdOf.get(orig.target));
      expect(copy).toBeDefined();
      expect({ double: copy!.double, label: copy!.label, role: copy!.role }).toEqual({ double: orig.double, label: orig.label, role: orig.role });
    }
  });

  it('merge: 기존 그림의 오른쪽 끝에서 80 떨어진 곳에 모양을 유지한 채 놓는다', () => {
    const doc = docWith([old, oldEdgeTarget], [oldEdge]);
    const before = diagramBounds([old, oldEdgeTarget])!;
    const ids = importErdFile(doc, file, 'merge');
    const added = ids.map((id) => getNodes(doc).find((n) => n.id === id)!);
    const b = diagramBounds(added)!;
    const orig = diagramBounds(nodes)!;
    expect(b.x).toBe(before.x + before.w + 80);
    expect(b.y).toBe(before.y);
    expect(b.w).toBe(orig.w);
    expect(b.h).toBe(orig.h);
    // 서로의 상대 위치가 같다
    expect(added[1].x - added[0].x).toBe(enroll.x - student.x);
    expect(added[2].y - added[0].y).toBe(sid.y - student.y);
  });

  it('merge: 빈 문서에는 원래 자리에 넣는다', () => {
    const doc = new Y.Doc();
    const ids = importErdFile(doc, file, 'merge');
    const added = ids.map((id) => getNodes(doc).find((n) => n.id === id)!);
    expect(added.map((n) => [n.x, n.y])).toEqual(nodes.map((n) => [n.x, n.y]));
    expect(getEdges(doc)).toHaveLength(2);
  });

  it('merge: 같은 파일을 두 번 넣어도 겹치지 않고 실행 취소 한 번에 하나씩 빠진다', () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges')], { trackedOrigins: new Set(['local']), captureTimeout: 0 });
    const first = importErdFile(doc, file, 'merge');
    const second = importErdFile(doc, file, 'merge');
    expect(getNodes(doc)).toHaveLength(8);
    expect(getEdges(doc)).toHaveLength(4);
    const a = diagramBounds(first.map((id) => getNodes(doc).find((n) => n.id === id)!))!;
    const b = diagramBounds(second.map((id) => getNodes(doc).find((n) => n.id === id)!))!;
    expect(b.x).toBe(a.x + a.w + 80);
    undo.undo();
    expect(getNodes(doc).map((n) => n.id).sort()).toEqual([...first].sort());
    expect(getEdges(doc)).toHaveLength(2);
  });
});

describe('buildSvgString', () => {
  function viewBoxOf(svg: string): number[] {
    const m = /viewBox="([^"]+)"/.exec(svg);
    expect(m).not.toBeNull();
    return m![1].split(/\s+/).map(Number);
  }

  it('노드가 없으면 null', () => {
    expect(buildSvgString([], [])).toBeNull();
    expect(buildSvgString([], edges)).toBeNull();
    expect(exportBounds([], [])).toBeNull();
  });

  it('독립 svg를 만든다', () => {
    const svg = buildSvgString(nodes, edges)!;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain('edge-hit');
    const [x, y, w, h] = viewBoxOf(svg);
    expect(/\swidth="(\d+)"/.exec(svg)![1]).toBe(String(w));
    expect(/\sheight="(\d+)"/.exec(svg)![1]).toBe(String(h));
    for (const v of [x, y, w, h]) expect(Number.isInteger(v)).toBe(true);
  });

  it('viewBox가 여백을 포함한 다이어그램 범위를 담는다', () => {
    for (const padding of [0, 24, 100]) {
      const [x, y, w, h] = viewBoxOf(buildSvgString(nodes, edges, { padding })!);
      const b = diagramBounds(nodes, padding)!;
      expect(x).toBeLessThanOrEqual(b.x);
      expect(y).toBeLessThanOrEqual(b.y);
      expect(x + w).toBeGreaterThanOrEqual(b.x + b.w);
      expect(y + h).toBeGreaterThanOrEqual(b.y + b.h);
      // 터무니없이 넓어지지도 않는다
      expect(w).toBeLessThan(b.w + 400);
      expect(h).toBeLessThan(b.h + 400);
    }
  });

  it('배경을 그리거나 뺀다', () => {
    expect(buildSvgString(nodes, edges, { background: '#abcdef' })).toMatch(/^<svg[^>]*><rect[^>]*fill="#abcdef"/);
    expect(buildSvgString(nodes, edges)).toMatch(/^<svg[^>]*><rect[^>]*fill="#ffffff"/);
    expect(buildSvgString(nodes, edges, { background: null })).not.toMatch(/^<svg[^>]*><rect/);
  });

  it('XML에 쓸 수 없는 문자가 섞이지 않는다', () => {
    const svg = buildSvgString([{ ...student, text: '학\u0000생\u0008 <A&B>' }], [])!;
    expect(svg).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(svg).not.toContain('<A&B>');
  });

  it('좌표가 깨진 노드가 있어도 나머지로 그린다', () => {
    const svg = buildSvgString([student, { ...enroll, x: Number.NaN }], edges)!;
    expect(viewBoxOf(svg).every(Number.isFinite)).toBe(true);
  });
});

describe('stripHitAreas', () => {
  it('클릭 판정용 선만 지운다', () => {
    const g =
      '<g data-edge-id="e1"><path class="edge-hit" d="M 0 0 L 1 1" stroke="transparent" stroke-width="14"></path>' +
      '<path d="M 0 0 L 1 1" stroke="#1a1a1a"></path><line x1="0" class="x edge-hit y" y1="0"/>' +
      '<path class="edge-hit-keep" d="M 2 2"></path><text class="edge-label">N</text></g>';
    expect(stripHitAreas(g)).toBe(
      '<g data-edge-id="e1"><path d="M 0 0 L 1 1" stroke="#1a1a1a"></path><path class="edge-hit-keep" d="M 2 2"></path><text class="edge-label">N</text></g>',
    );
  });
});

describe('expandPaintOrder', () => {
  it('흰 테두리 글자를 테두리 겹과 채움 겹으로 나눈다', () => {
    const text =
      '<text x="1" y="2" dy="0.35em" text-anchor="middle" fill="#1a1a1a" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke" style="user-select:none">N</text>';
    expect(expandPaintOrder(`<g>${text}<text x="3" fill="#1a1a1a" stroke="none">학생</text></g>`)).toBe(
      '<g><text x="1" y="2" dy="0.35em" text-anchor="middle" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" style="user-select:none" fill="none">N</text>' +
        '<text x="1" y="2" dy="0.35em" text-anchor="middle" fill="#1a1a1a" style="user-select:none" stroke="none">N</text>' +
        '<text x="3" fill="#1a1a1a" stroke="none">학생</text></g>',
    );
  });
  it('내보낸 svg에는 paint-order가 남지 않는다', () => {
    expect(buildSvgString(nodes, edges)).not.toContain('paint-order');
  });
});

describe('DOM이 없는 환경', () => {
  it('그림 내보내기는 예외 없이 실패를 돌려준다', async () => {
    expect(await renderPngBlob(nodes, edges)).toBeNull();
    expect(await downloadPng(nodes, edges, 'erd.png')).toBe(false);
    expect(await downloadSvg(nodes, edges, 'erd.svg')).toBe(false);
    expect(await copyPngToClipboard(nodes, edges)).toBe(false);
  });
});

describe('png 보조 함수', () => {
  // 1x1 투명 PNG
  const tiny = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );

  it('fitScale: 한계 안이면 그대로, 넘으면 낮춘다', () => {
    expect(fitScale(1000, 800, 2)).toBe(2);
    expect(fitScale(1000, 800, Number.NaN)).toBe(2);
    const wide = fitScale(20000, 100, 2);
    expect(wide * 20000).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    const big = fitScale(9000, 9000, 2);
    expect(big).toBeLessThan(2);
    expect(big * 9000 * big * 9000).toBeLessThanOrEqual(MAX_CANVAS_AREA * 1.0001);
  });

  it('setPngDpi: 해상도 정보를 넣고 나머지는 건드리지 않는다', () => {
    expect(readPngDpi(tiny)).toBeNull();
    const out = setPngDpi(tiny, 192);
    expect(out.length).toBe(tiny.length + 21);
    expect(readPngDpi(out)).toBe(192);
    // IHDR 바로 뒤에 들어가고 앞뒤 바이트는 같다
    expect(Array.from(out.slice(0, 33))).toEqual(Array.from(tiny.slice(0, 33)));
    expect(String.fromCharCode(...out.slice(37, 41))).toBe('pHYs');
    expect(Array.from(out.slice(54))).toEqual(Array.from(tiny.slice(33)));
    // 192dpi = 7559 px/m(0x1d87), 단위 1(미터), CRC는 종류 + 내용에 대한 값
    expect(Array.from(out.slice(33, 37))).toEqual([0, 0, 0, 9]);
    expect(Array.from(out.slice(41, 50))).toEqual([0, 0, 0x1d, 0x87, 0, 0, 0x1d, 0x87, 1]);
    expect(new DataView(out.buffer).getUint32(50)).toBe(crc32(out.slice(37, 50)));
    // 다시 넣으면 바꿔 쓴다(두 번 들어가지 않는다)
    const again = setPngDpi(out, 96);
    expect(again.length).toBe(out.length);
    expect(readPngDpi(again)).toBe(96);
  });

  it('setPngDpi: PNG가 아니면 그대로 돌려준다', () => {
    const junk = new Uint8Array(64).fill(7);
    expect(setPngDpi(junk, 192)).toBe(junk);
    expect(setPngDpi(tiny, 0)).toBe(tiny);
  });
});
