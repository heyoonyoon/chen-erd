/**
 * 내보내기와 불러오기. [담당: export 에이전트]
 *
 * 모듈 최상위에서는 DOM을 건드리지 않는다(node 테스트에서 import만 해도 안전).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type * as Y from 'yjs';
import { computeEdgeGeometry, diagramBounds, siblingInfo, unionBounds } from '../../shared/geometry';
import { STYLE, type ErdEdge, type ErdFile, type ErdNode, type NodeKind, type Point, type Rect } from '../../shared/types';
import { DiagramContent } from '../canvas/DiagramContent';
import { addEdges, addNodes, getEdges, getNodes, getTitle, newId, replaceAll, setTitle, transact } from '../collab/docOps';
import { measureText } from '../text/measure';
import { fitScale, setPngDpi } from './png';

export interface ImageOptions {
  /** 다이어그램 둘레 여백(px). 기본 24 */
  padding?: number;
  /** 배경색. 기본 '#ffffff'. null이면 투명 */
  background?: string | null;
  /** PNG 해상도 배율. 기본 2 */
  scale?: number;
}

const DEFAULT_PADDING = 24;
const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_SCALE = 2;
/** 도형 테두리 두께의 절반이 범위 밖으로 나가므로 여백이 0이어도 이만큼은 둔다 */
const STROKE_BLEED = 2;
/** 선의 글자(카디널리티, 역할 이름) 둘레 여유 */
const LABEL_MARGIN = 6;

// ───────────────────────── SVG ─────────────────────────

function isFinitePoint(p: Point | null | undefined): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function hasFiniteBox(n: ErdNode): boolean {
  return Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.w) && Number.isFinite(n.h);
}

function backgroundOf(opts: ImageOptions | undefined): string | null {
  return opts?.background === undefined ? DEFAULT_BACKGROUND : opts.background || null;
}

/** 선과 선의 글자가 차지하는 범위들. 노드 범위 밖으로 나가는 부분이 잘리지 않게 하는 데 쓴다. */
function edgeExtents(nodes: ErdNode[], edges: ErdEdge[]): Rect[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Rect[] = [];
  const around = (p: Point, halfW: number, halfH: number) => {
    out.push({ x: p.x - halfW, y: p.y - halfH, w: halfW * 2, h: halfH * 2 });
  };
  let siblings: ReturnType<typeof siblingInfo>;
  try {
    siblings = siblingInfo(edges);
  } catch {
    return out;
  }
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    try {
      const sib = siblings.get(e.id) ?? { index: 0, count: 1 };
      const g = computeEdgeGeometry(e, s, t, sib.index, sib.count);
      // 선 자체(휘어 그린 선은 노드 범위 밖으로 나갈 수 있다)
      const line = STYLE.doubleGap + STYLE.strokeWidth;
      // 꺾은선은 도형을 돌아가느라 노드 범위 밖으로 나갈 수 있으므로 지나는 점을 모두 넣는다
      for (const p of [g.start, g.end, g.mid, ...(g.points ?? [])]) if (isFinitePoint(p)) around(p, line, line);
      if (isFinitePoint(g.control) && isFinitePoint(g.start) && isFinitePoint(g.end)) {
        // 2차 베지어의 가운데 점
        around({ x: (g.start.x + 2 * g.control.x + g.end.x) / 4, y: (g.start.y + 2 * g.control.y + g.end.y) / 4 }, line, line);
      }
      // 글자는 정렬 방식(가운데, 왼쪽, 오른쪽)을 모르므로 양쪽으로 글자 너비만큼 잡는다
      const halfH = STYLE.lineHeight / 2 + LABEL_MARGIN;
      if (e.label && isFinitePoint(g.labelPos)) {
        around(g.labelPos, measureText(e.label, STYLE.labelFontSize).width + LABEL_MARGIN, halfH);
      }
      if (e.role && isFinitePoint(g.rolePos)) {
        around(g.rolePos, measureText(e.role, STYLE.labelFontSize).width + LABEL_MARGIN, halfH);
      }
    } catch {
      // 기하 계산이 실패한 선은 범위 계산에서만 뺀다
    }
  }
  return out.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h));
}

/**
 * 내보낼 그림의 범위(월드 좌표, 정수). diagramBounds(nodes, padding)을 포함하고
 * 선의 글자가 바깥으로 나가 있으면 그만큼 더 넓다. 노드가 없으면 null.
 */
export function exportBounds(nodes: ErdNode[], edges: ErdEdge[], padding: number = DEFAULT_PADDING): Rect | null {
  const pad = Number.isFinite(padding) && padding >= 0 ? padding : DEFAULT_PADDING;
  const valid = nodes.filter(hasFiniteBox);
  const base = diagramBounds(valid, Math.max(pad, STROKE_BLEED));
  if (!base) return null;
  const all = unionBounds([base, ...edgeExtents(valid, edges)]) ?? base;
  const x = Math.floor(all.x);
  const y = Math.floor(all.y);
  return { x, y, w: Math.max(1, Math.ceil(all.x + all.w) - x), h: Math.max(1, Math.ceil(all.y + all.h) - y) };
}

const HIT_AREA_RE = /<(path|line|polyline|polygon|rect|circle|ellipse)\b[^>]*\sclass="(?:[^"]*\s)?edge-hit(?:\s[^"]*)?"[^>]*(?:\/>|>\s*<\/\1>)/g;
/** XML 1.0에 쓸 수 없는 제어 문자. 하나라도 섞이면 SVG 전체가 그림으로 읽히지 않는다 */
const XML_INVALID_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** 클릭 판정용 투명 선(.edge-hit)을 SVG 마크업에서 지운다. */
export function stripHitAreas(markup: string): string {
  return markup.replace(HIT_AREA_RE, '');
}

const PAINT_ORDER_TEXT_RE = /<text\b([^>]*?)\spaint-order="stroke"([^>]*)>([\s\S]*?)<\/text>/g;

/**
 * 글자 뒤에 흰 테두리를 깔려고 쓴 paint-order="stroke"를 글자 두 겹(테두리만, 채움만)으로 풀어 쓴다.
 * paint-order를 모르는 프로그램(워드 등)은 테두리를 글자 위에 덮어 그려 글자가 뭉개지기 때문이다.
 */
export function expandPaintOrder(markup: string): string {
  return markup.replace(PAINT_ORDER_TEXT_RE, (_all, before: string, after: string, body: string) => {
    const attrs = `${before}${after}`;
    const strokeOnly = `${attrs.replace(/\sfill="[^"]*"/g, '')} fill="none"`;
    const fillOnly = `${attrs.replace(/\sstroke(?:-[a-z]+)?="[^"]*"/g, '')} stroke="none"`;
    return `<text${strokeOnly}>${body}</text><text${fillOnly}>${body}</text>`;
  });
}

/**
 * bounds 범위를 그린 SVG 문자열. pixelWidth/pixelHeight를 주면 svg의 width/height 속성만 그 값으로 쓴다
 * (viewBox는 그대로). PNG로 그릴 때 브라우저가 처음부터 그 해상도로 그리게 하려는 것.
 */
function buildSvg(nodes: ErdNode[], edges: ErdEdge[], b: Rect, background: string | null, pixelWidth?: number, pixelHeight?: number): string {
  let svg = renderToStaticMarkup(
    createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `${b.x} ${b.y} ${b.w} ${b.h}`,
        width: pixelWidth ?? b.w,
        height: pixelHeight ?? b.h,
        fontFamily: STYLE.fontFamily,
        fontSize: STYLE.fontSize,
      },
      background ? createElement('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: background }) : null,
      createElement(DiagramContent, { nodes: nodes.filter(hasFiniteBox), edges }),
    ),
  );
  svg = expandPaintOrder(stripHitAreas(svg)).replace(XML_INVALID_RE, '');
  if (svg.includes('edge-hit')) {
    // 지우지 못한 형태(묶음 등)가 남았으면 스타일로 숨긴다
    svg = svg.replace(/^(<svg\b[^>]*>)/, '$1<style>.edge-hit{display:none}</style>');
  }
  return svg;
}

/** 다이어그램 전체를 담은 독립 SVG 문자열(선택 표시, 격자 없음). 노드가 없으면 null */
export function buildSvgString(nodes: ErdNode[], edges: ErdEdge[], opts?: ImageOptions): string | null {
  const b = exportBounds(nodes, edges, opts?.padding ?? DEFAULT_PADDING);
  if (!b) return null;
  return buildSvg(nodes, edges, b, backgroundOf(opts));
}

// ───────────────────────── PNG ─────────────────────────

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** SVG 문자열을 Image로 읽는다. 실패하면 null */
async function loadSvgImage(svg: string): Promise<HTMLImageElement | null> {
  // data URL이 canvas를 오염시키지 않는 가장 안전한 방법이다(일부 브라우저는 blob URL의 SVG를 그리면 toBlob을 막는다)
  try {
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    if (img) return img;
  } catch {
    // 짝이 맞지 않는 서로게이트가 있으면 encodeURIComponent가 실패한다. 아래 Blob 방식은 그런 글자도 받아 준다
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/** 한 배율로 그려 본다. 'no-image' = SVG를 읽지 못함(배율을 낮춰도 소용없다), null = canvas가 그 크기를 감당하지 못함 */
async function rasterize(nodes: ErdNode[], edges: ErdEdge[], b: Rect, background: string | null, scale: number): Promise<Blob | 'no-image' | null> {
  const pw = Math.max(1, Math.floor(b.w * scale));
  const ph = Math.max(1, Math.floor(b.h * scale));
  const img = await loadSvgImage(buildSvg(nodes, edges, b, background, pw, ph));
  if (!img) return 'no-image';

  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width !== pw || canvas.height !== ph) return null;
    // 한계를 넘은 canvas는 오류 없이 아무것도 그려지지 않는 경우가 있어 점 하나를 찍어 확인한다
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1, 1);
    if (ctx.getImageData(0, 0, 1, 1).data[3] !== 255) return null;
    ctx.clearRect(0, 0, pw, ph);

    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, pw, ph);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, pw, ph);

    const blob = await canvasToPng(canvas);
    if (!blob) return null;
    try {
      // 화면에서 보던 크기 그대로 문서에 들어가도록 해상도 정보를 적는다(96dpi x 실제 배율)
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const stamped = setPngDpi(bytes, (96 * pw) / b.w);
      return new Blob([stamped as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    } catch {
      return blob;
    }
  } catch {
    return null;
  } finally {
    // 큰 canvas의 메모리를 바로 돌려준다
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** PNG Blob으로 만든다. 노드가 없으면 null */
export async function renderPngBlob(nodes: ErdNode[], edges: ErdEdge[], opts?: ImageOptions): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const b = exportBounds(nodes, edges, opts?.padding ?? DEFAULT_PADDING);
    if (!b) return null;
    const background = backgroundOf(opts);
    let scale = fitScale(b.w, b.h, opts?.scale ?? DEFAULT_SCALE);
    // 기기에 따라 한계가 더 낮으므로(모바일 등) 실패하면 배율을 절반씩 낮춰 다시 그린다
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await rasterize(nodes, edges, b, background, scale);
      if (result === 'no-image') return null;
      if (result) return result;
      scale /= 2;
    }
    return null;
  } catch {
    return null;
  }
}

// ───────────────────────── 내려받기, 클립보드 ─────────────────────────

function withExtension(filename: string, ext: string): string {
  const name = String(filename ?? '').trim() || 'erd';
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 내려받기가 시작된 뒤에 풀어야 한다
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

/** PNG 파일로 내려받는다. 성공하면 true */
export async function downloadPng(nodes: ErdNode[], edges: ErdEdge[], filename: string, opts?: ImageOptions): Promise<boolean> {
  const blob = await renderPngBlob(nodes, edges, opts);
  if (!blob) return false;
  return triggerDownload(blob, withExtension(filename, 'png'));
}

export async function downloadSvg(nodes: ErdNode[], edges: ErdEdge[], filename: string, opts?: ImageOptions): Promise<boolean> {
  const svg = buildSvgString(nodes, edges, opts);
  if (!svg) return false;
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`], { type: 'image/svg+xml;charset=utf-8' });
  return triggerDownload(blob, withExtension(filename, 'svg'));
}

/**
 * PNG를 클립보드에 복사한다(워드에 바로 붙여넣기용). 성공하면 true
 * 클릭 같은 사용자 동작 처리 안에서 다른 await 없이 바로 불러야 한다(Safari는 동작 직후의 호출만 허용한다).
 */
export async function copyPngToClipboard(nodes: ErdNode[], edges: ErdEdge[], opts?: ImageOptions): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof ClipboardItem === 'undefined') return false;
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.write !== 'function') return false;
  if (nodes.length === 0) return false;

  const pending = renderPngBlob(nodes, edges, opts).then((blob) => {
    if (!blob) throw new Error('PNG를 만들지 못했습니다');
    return blob;
  });
  // 아래에서 따로 기다리므로 처리되지 않은 거부로 보고되지 않게 한다
  pending.catch(() => {});

  try {
    // Safari: 그리기가 끝나기 전에 Promise를 넘겨야 사용자 동작으로 인정된다
    await clipboard.write([new ClipboardItem({ 'image/png': pending })]);
    return true;
  } catch {
    // Promise를 받지 않는 브라우저: 다 그린 Blob으로 다시 시도한다
    try {
      const blob = await pending;
      await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }
}

// ───────────────────────── JSON 파일 ─────────────────────────

const NODE_KINDS: readonly NodeKind[] = ['entity', 'relationship', 'attribute', 'spec', 'note'];
const KEY_TYPES = ['none', 'key', 'partial'] as const;
const SPEC_TYPES = ['d', 'o'] as const;
const BOOLEAN_FLAGS = ['weak', 'identifying', 'multivalued', 'derived'] as const;

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 알려진 필드만 정해진 순서로 담는다. */
function pickNode(n: ErdNode): ErdNode {
  const out: ErdNode = {
    id: n.id,
    kind: n.kind,
    x: finiteOr(n.x, 0),
    y: finiteOr(n.y, 0),
    w: finiteOr(n.w, 100),
    h: finiteOr(n.h, 50),
    text: typeof n.text === 'string' ? n.text : '',
  };
  for (const flag of BOOLEAN_FLAGS) if (typeof n[flag] === 'boolean') out[flag] = n[flag];
  if (n.keyType !== undefined && (KEY_TYPES as readonly string[]).includes(n.keyType)) out.keyType = n.keyType;
  if (n.specType !== undefined && (SPEC_TYPES as readonly string[]).includes(n.specType)) out.specType = n.specType;
  return out;
}

/** 문서를 ErdFile 객체로 만든다. */
export function toErdFile(doc: Y.Doc): ErdFile {
  const nodes = getNodes(doc)
    .filter((n) => n.id !== '')
    .map(pickNode);
  const ids = new Set(nodes.map((n) => n.id));
  // 끝이 사라진 선(동시 편집 중에 생길 수 있다)은 다시 불러올 수 없으므로 담지 않는다
  const edges = getEdges(doc)
    .filter((e) => e.id !== '' && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      double: e.double,
      label: e.label,
      role: e.role,
      ...(e.sourceSide ? { sourceSide: e.sourceSide } : {}),
      ...(e.targetSide ? { targetSide: e.targetSide } : {}),
      ...(e.shape ? { shape: e.shape } : {}),
    }));
  return { format: 'chen-erd', version: 1, title: getTitle(doc), nodes, edges };
}

/** JSON 파일로 내려받는다(백업). */
export function downloadJson(doc: Y.Doc, filename: string): void {
  const text = `${JSON.stringify(toErdFile(doc), null, 2)}\n`;
  triggerDownload(new Blob([text], { type: 'application/json;charset=utf-8' }), withExtension(filename, 'json'));
}

function fail(message: string): never {
  throw new Error(message);
}

/** 오류 메시지에 넣을 값 표시 */
function show(v: unknown): string {
  if (v === undefined) return '없음';
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 글자 필드. 없으면 ''. 숫자로 적은 값(카디널리티 1 등)은 글자로 바꿔 받는다 */
function readText(v: unknown, where: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fail(`${where} 값은 글자여야 합니다. (현재 값: ${show(v)})`);
}

function readId(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    return fail(`${where} 값이 없거나 글자가 아닙니다. (현재 값: ${show(v)})`);
  }
  return v;
}

function parseNode(raw: unknown, index: number, seen: Set<string>): ErdNode {
  const at = `nodes[${index}]`;
  if (!isRecord(raw)) return fail(`${at} 항목이 객체가 아닙니다. (현재 값: ${show(raw)})`);
  const id = readId(raw.id, `${at}의 id`);
  if (seen.has(id)) fail(`${at}의 id ${show(id)}가 다른 항목과 겹칩니다. id는 파일 안에서 하나뿐이어야 합니다.`);

  if (typeof raw.kind !== 'string' || !(NODE_KINDS as readonly string[]).includes(raw.kind)) {
    fail(`${at}의 kind 값 ${show(raw.kind)}은 쓸 수 없습니다. (${NODE_KINDS.join(', ')} 중 하나여야 합니다.)`);
  }
  const kind = raw.kind as NodeKind;

  const num = (key: 'x' | 'y' | 'w' | 'h'): number => {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return fail(`${at}의 ${key} 값이 숫자가 아닙니다. (현재 값: ${show(v)})`);
    }
    return v;
  };
  const node: ErdNode = { id, kind, x: num('x'), y: num('y'), w: num('w'), h: num('h'), text: readText(raw.text, `${at}의 text`) };
  if (node.w <= 0 || node.h <= 0) fail(`${at}의 크기(w, h)는 0보다 커야 합니다. (현재 값: ${node.w} x ${node.h})`);

  for (const flag of BOOLEAN_FLAGS) {
    const v = raw[flag];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'boolean') fail(`${at}의 ${flag} 값은 true 또는 false여야 합니다. (현재 값: ${show(v)})`);
    node[flag] = v as boolean;
  }
  if (raw.keyType !== undefined && raw.keyType !== null) {
    if (!(KEY_TYPES as readonly unknown[]).includes(raw.keyType)) {
      fail(`${at}의 keyType 값 ${show(raw.keyType)}은 쓸 수 없습니다. (${KEY_TYPES.join(', ')} 중 하나여야 합니다.)`);
    }
    node.keyType = raw.keyType as ErdNode['keyType'];
  }
  if (raw.specType !== undefined && raw.specType !== null) {
    if (!(SPEC_TYPES as readonly unknown[]).includes(raw.specType)) {
      fail(`${at}의 specType 값 ${show(raw.specType)}은 쓸 수 없습니다. (${SPEC_TYPES.join(', ')} 중 하나여야 합니다.)`);
    }
    node.specType = raw.specType as ErdNode['specType'];
  } else if (kind === 'spec') {
    node.specType = 'd';
  }
  return node;
}

function parseEdge(raw: unknown, index: number, seen: Set<string>, nodeIds: Set<string>): ErdEdge {
  const at = `edges[${index}]`;
  if (!isRecord(raw)) return fail(`${at} 항목이 객체가 아닙니다. (현재 값: ${show(raw)})`);
  const id = readId(raw.id, `${at}의 id`);
  if (seen.has(id)) fail(`${at}의 id ${show(id)}가 다른 항목과 겹칩니다. id는 파일 안에서 하나뿐이어야 합니다.`);

  const end = (key: 'source' | 'target'): string => {
    const v = readId(raw[key], `${at}의 ${key}`);
    if (!nodeIds.has(v)) fail(`${at}의 ${key} ${show(v)}에 해당하는 도형이 nodes에 없습니다.`);
    return v;
  };
  const source = end('source');
  const target = end('target');

  let double = false;
  if (raw.double !== undefined && raw.double !== null) {
    if (typeof raw.double !== 'boolean') fail(`${at}의 double 값은 true 또는 false여야 합니다. (현재 값: ${show(raw.double)})`);
    double = raw.double as boolean;
  }
  const edge: ErdEdge = { id, source, target, double, label: readText(raw.label, `${at}의 label`), role: readText(raw.role, `${at}의 role`) };
  // 선이 붙는 면과 선 모양은 선택 항목이다. 모르는 값은 버리고 자동으로 둔다
  if (isSideValue(raw.sourceSide)) edge.sourceSide = raw.sourceSide;
  if (isSideValue(raw.targetSide)) edge.targetSide = raw.targetSide;
  if (raw.shape === 'straight' || raw.shape === 'elbow') edge.shape = raw.shape;
  return edge;
}

function isSideValue(v: unknown): v is NonNullable<ErdEdge['sourceSide']> {
  return v === 'top' || v === 'right' || v === 'bottom' || v === 'left';
}

/** 텍스트를 ErdFile로 해석하고 검사한다. 형식이 틀리면 한국어 메시지와 함께 Error를 던진다. */
export function parseErdFile(text: string): ErdFile {
  const source = typeof text === 'string' ? text.replace(/^﻿/, '') : '';
  if (source.trim() === '') fail('파일이 비어 있습니다.');

  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    fail('JSON 형식이 아닙니다. Chen ERD에서 내보낸 JSON 파일인지 확인해 주세요.');
  }
  if (!isRecord(data)) return fail('Chen ERD 파일이 아닙니다. 파일의 가장 바깥이 객체여야 합니다.');
  if (data.format !== 'chen-erd') {
    fail(`Chen ERD 파일이 아닙니다. format 값이 "chen-erd"여야 합니다. (현재 값: ${show(data.format)})`);
  }
  if (data.version !== 1) {
    fail(`지원하지 않는 파일 버전입니다. version 1만 읽을 수 있습니다. (현재 값: ${show(data.version)})`);
  }
  if (!Array.isArray(data.nodes)) fail(`nodes 항목이 배열이 아닙니다. (현재 값: ${show(data.nodes)})`);
  if (!Array.isArray(data.edges)) fail(`edges 항목이 배열이 아닙니다. (현재 값: ${show(data.edges)})`);

  // 노드와 선의 id는 선택, 삭제에서 함께 쓰이므로 서로도 겹치면 안 된다
  const seen = new Set<string>();
  const nodes: ErdNode[] = [];
  (data.nodes as unknown[]).forEach((raw, i) => {
    const node = parseNode(raw, i, seen);
    seen.add(node.id);
    nodes.push(node);
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: ErdEdge[] = [];
  (data.edges as unknown[]).forEach((raw, i) => {
    const edge = parseEdge(raw, i, seen, nodeIds);
    seen.add(edge.id);
    edges.push(edge);
  });

  return { format: 'chen-erd', version: 1, title: typeof data.title === 'string' ? data.title : '', nodes, edges };
}

/** merge로 넣을 때 기존 다이어그램과의 간격 */
const MERGE_GAP = 80;

/**
 * 파일 내용을 문서에 넣는다. replace = 기존 내용을 지우고 넣기, merge = 새 id를 붙여 기존 내용 옆에 추가.
 * 넣은 노드 id 목록을 돌려준다.
 */
export function importErdFile(doc: Y.Doc, file: ErdFile, mode: 'replace' | 'merge'): string[] {
  if (mode === 'replace') {
    const nodeIds = new Set(file.nodes.map((n) => n.id));
    const edges = file.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    transact(doc, () => {
      replaceAll(doc, file.nodes, edges);
      if (typeof file.title === 'string' && file.title.trim() !== '') setTitle(doc, file.title);
    });
    return file.nodes.map((n) => n.id);
  }

  // 기존 그림의 오른쪽에, 위쪽 끝을 맞춰 놓는다
  const existing = diagramBounds(getNodes(doc));
  const incoming = diagramBounds(file.nodes);
  const dx = existing && incoming ? Math.round(existing.x + existing.w + MERGE_GAP - incoming.x) : 0;
  const dy = existing && incoming ? Math.round(existing.y - incoming.y) : 0;

  const idMap = new Map<string, string>();
  const nodes = file.nodes.map((n) => {
    const id = newId();
    idMap.set(n.id, id);
    return { ...n, id, x: n.x + dx, y: n.y + dy };
  });
  const edges: ErdEdge[] = [];
  for (const e of file.edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (source && target) edges.push({ ...e, id: newId(), source, target });
  }
  transact(doc, () => {
    addNodes(doc, nodes);
    addEdges(doc, edges);
  });
  return nodes.map((n) => n.id);
}

/** 파일 이름으로 쓸 수 있게 제목을 다듬는다. 비어 있으면 'erd' */
export function safeFilename(title: string): string {
  const cleaned = String(title ?? '')
    .normalize('NFC')
    .replace(/\s/g, ' ')
    .replace(/[/\\:*?"<>|\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .replace(/ +/g, '_');
  // 글자 단위로 자른다(두 칸짜리 글자가 반으로 잘리지 않게)
  const limited = Array.from(cleaned).slice(0, 60).join('');
  // 앞의 점은 숨김 파일이 되고 뒤의 점은 윈도우에서 문제가 된다
  const trimmed = limited.replace(/^[._]+|[._]+$/g, '');
  return trimmed === '' ? 'erd' : trimmed;
}
