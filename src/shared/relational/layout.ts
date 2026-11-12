/**
 * IE 그림의 테이블 상자 배치. DOM 없이 글자 너비를 어림하므로 서버와 테스트에서도 같은 결과가 나온다.
 *
 * 상자 크기: 머리 40px, 컬럼 한 줄 28px. 기본키 묶음과 나머지 묶음이 각각 비면 반 줄(14px)을 둔다.
 * 각 행은 [키 표시 | 이름 | 타입 | NULL] 네 칸이고, 칸 폭은 테이블 안에서 모두 같다(ieColumnGrid).
 * 너비는 네 칸의 합과 테이블 이름 중 넓은 쪽(최소 180px). 타입 칸은 정한 타입(없으면 물려받은 타입) 중 가장 긴 것에 맞추고,
 * 타입이 하나도 없어도 눌러서 적을 수 있게 최소 폭을 둔다.
 * 키는 테이블 이름(IeTable.name)이다.
 * 배치: 외래키 깊이로 층을 나눈다(참조당하는 부모가 위, 자식이 아래). 층 안의 순서는 위아래로 이어진 상자들의 평균 위치(barycenter)로
 * 몇 번 다시 정렬해 선이 덜 엇갈리게 하고, 층마다 가운데 정렬한다. 한 층이 너무 넓으면 여러 줄로 나눈다.
 * 상자 사이는 가로 100px, 세로 100px 띄워 선 끝 기호(까마귀발 등)가 들어갈 자리를 둔다. 좌표는 모두 정수다.
 */
import { approximateLineWidth } from '../measure';
import type { IeLayout, IeModel, IeTable } from './userSchema';

export const IE_BOX = {
  headerHeight: 40,
  rowHeight: 28,
  minWidth: 180,
  /** 머리(테이블 이름) 좌우 여백 */
  paddingX: 12,
  /** 칸 안 좌우 여백 */
  cellPadX: 8,
  /** 기본키, 외래키 표시 칸(고정 폭) */
  keyWidth: 34,
  /** 이름 칸의 최소 폭 */
  minNameWidth: 56,
  /** 타입 칸의 최소 폭(타입이 없어도 눌러서 적을 자리) */
  minTypeWidth: 56,
  /** NULL 칸(고정 폭, 'NOT NULL'이 들어간다) */
  nullWidth: 72,
  fontSize: 13,
  /** 타입 글자(고정폭 글꼴) */
  typeFontSize: 12,
  headerFontSize: 14,
  gapX: 100,
  gapY: 100,
  /** 이보다 넓은 층은 여러 줄로 나눈다 */
  maxRowWidth: 1600,
} as const;

/** 고정폭 글꼴 글자의 너비 어림(비례 글꼴 어림보다 한 글자가 조금 넓다) */
function monoWidth(text: string, fontSize: number): number {
  return approximateLineWidth(text, fontSize * 1.1);
}

/** 상자 안 네 칸(키 | 이름 | 타입 | NULL)의 폭. 모든 행이 같은 칸 경계를 쓴다 */
export interface IeColumnGrid {
  key: number;
  name: number;
  type: number;
  nullable: number;
  /** 네 칸의 합 = 상자 너비 */
  w: number;
}

/**
 * 테이블 하나의 칸 폭. width를 주면(배치가 더 넓은 상자를 줬을 때) 남는 폭은 이름 칸이 갖는다.
 * 타입 칸은 사람이 정한 타입, 없으면 물려받은 타입 중 가장 긴 것에 맞춘다.
 */
export function ieColumnGrid(table: IeTable, width?: number): IeColumnGrid {
  const B = IE_BOX;
  let name: number = B.minNameWidth;
  let type: number = B.minTypeWidth;
  for (const c of table.columns) {
    name = Math.max(name, Math.ceil(approximateLineWidth(c.name, B.fontSize) + B.cellPadX * 2));
    const shown = c.type ?? c.inheritedType;
    if (shown) type = Math.max(type, Math.ceil(monoWidth(shown, B.typeFontSize) + B.cellPadX * 2));
  }
  const header = Math.ceil(approximateLineWidth(table.name, B.headerFontSize) * 1.1 + B.paddingX * 2);
  const base = B.keyWidth + name + type + B.nullWidth;
  const w = Math.max(base, header, B.minWidth, Math.ceil(width ?? 0));
  return { key: B.keyWidth, name: name + (w - base), type, nullable: B.nullWidth, w };
}

/** 기본키 묶음이나 나머지 묶음의 높이. 비면 반 줄만 남겨 구분선 위아래가 보이게 한다 */
export function ieSectionHeight(rows: number): number {
  return rows > 0 ? rows * IE_BOX.rowHeight : IE_BOX.rowHeight / 2;
}

export function ieBoxSize(table: IeTable): { w: number; h: number } {
  const pk = table.columns.filter((c) => c.primaryKey).length;
  return { w: ieColumnGrid(table).w, h: IE_BOX.headerHeight + ieSectionHeight(pk) + ieSectionHeight(table.columns.length - pk) };
}

export function layoutIe(model: IeModel): IeLayout {
  const B = IE_BOX;
  // 같은 이름이 둘이면 처음 것만(deriveIe는 이미 중복을 뺀다)
  const tables = model.tables.filter((t, i) => model.tables.findIndex((x) => x.name === t.name) === i);
  const ids = tables.map((t) => t.name);
  const known = new Set(ids);
  const size = new Map(tables.map((t) => [t.name, ieBoxSize(t)]));
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]));
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const link of model.links) {
    const child = link.child.table;
    const parent = link.parent.table;
    if (child === parent || !known.has(child) || !known.has(parent)) continue;
    if (parents.get(child)!.includes(parent)) continue;
    parents.get(child)!.push(parent);
    children.get(parent)!.push(child);
  }

  // 깊이: 부모 중 가장 깊은 것 + 1. 고리는 지금 보고 있는 길의 선을 무시해서 끊는다
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    visiting.add(id);
    let d = 0;
    for (const p of parents.get(id) ?? []) {
      if (visiting.has(p)) continue;
      d = Math.max(d, depthOf(p) + 1);
    }
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) depthOf(id);

  const layerCount = Math.max(0, ...ids.map((id) => depth.get(id)! + 1));
  let layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) layers[depth.get(id)!].push(id);

  // 층 안의 x 위치(가운데 정렬로 쌓았을 때의 중심)
  const centers = new Map<string, number>();
  const place = () => {
    const widths = layers.map((layer) => layer.reduce((sum, id) => sum + size.get(id)!.w, 0) + B.gapX * Math.max(0, layer.length - 1));
    const full = Math.max(0, ...widths);
    layers.forEach((layer, i) => {
      let x = (full - widths[i]) / 2;
      for (const id of layer) {
        centers.set(id, x + size.get(id)!.w / 2);
        x += size.get(id)!.w + B.gapX;
      }
    });
  };
  place();
  const order = new Map(ids.map((id, i) => [id, i]));
  const reorder = (layer: string[], neighbors: (id: string) => string[]) => {
    const key = new Map<string, number>();
    for (const id of layer) {
      const ns = neighbors(id).filter((n) => centers.has(n));
      key.set(id, ns.length > 0 ? ns.reduce((s, n) => s + centers.get(n)!, 0) / ns.length : centers.get(id)!);
    }
    layer.sort((a, b) => key.get(a)! - key.get(b)! || order.get(a)! - order.get(b)!);
  };
  for (let round = 0; round < 4; round++) {
    for (let i = 1; i < layers.length; i++) {
      reorder(layers[i], (id) => parents.get(id)!);
      place();
    }
    for (let i = layers.length - 2; i >= 0; i--) {
      reorder(layers[i], (id) => children.get(id)!);
      place();
    }
  }

  // 너무 넓은 층은 여러 줄로
  const rows: string[][] = [];
  for (const layer of layers) {
    let row: string[] = [];
    let width = 0;
    for (const id of layer) {
      const w = size.get(id)!.w;
      if (row.length > 0 && width + B.gapX + w > B.maxRowWidth) {
        rows.push(row);
        row = [];
        width = 0;
      }
      width += (row.length > 0 ? B.gapX : 0) + w;
      row.push(id);
    }
    if (row.length > 0) rows.push(row);
  }
  layers = rows;

  const rowWidths = layers.map((row) => row.reduce((sum, id) => sum + size.get(id)!.w, 0) + B.gapX * Math.max(0, row.length - 1));
  const width = Math.max(0, ...rowWidths);
  const out: IeLayout['tables'] = {};
  let y = 0;
  layers.forEach((row, i) => {
    let x = Math.round((width - rowWidths[i]) / 2);
    let rowHeight = 0;
    for (const id of row) {
      const { w, h } = size.get(id)!;
      out[id] = { x, y, w, h };
      x += w + B.gapX;
      rowHeight = Math.max(rowHeight, h);
    }
    y += rowHeight + B.gapY;
  });
  const height = layers.length > 0 ? y - B.gapY : 0;
  return { tables: out, width, height };
}
