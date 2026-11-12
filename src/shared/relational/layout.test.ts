import { describe, expect, it } from 'vitest';
import { deriveIe } from './ie';
import { IE_BOX, ieBoxSize, ieColumnGrid, layoutIe } from './layout';
import { columnKey } from './settings';
import { parseMarkup, RELATIONAL_SYNTAX_EXAMPLE } from './text';
import type { ColumnSettings, IeModel } from './userSchema';

function model(text: string, settings: ColumnSettings = {}): IeModel {
  return deriveIe(parseMarkup(text).schema, settings);
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function check(m: IeModel) {
  const layout = layoutIe(m);
  const boxes = Object.entries(layout.tables);
  expect(boxes.map(([name]) => name).sort()).toEqual(m.tables.map((t) => t.name).sort());
  for (const [, b] of boxes) {
    for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isInteger(v)).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(layout.width);
    expect(b.y + b.h).toBeLessThanOrEqual(layout.height);
    expect(b.w).toBeGreaterThanOrEqual(IE_BOX.minWidth);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i][1];
      const b = boxes[j][1];
      expect(overlaps(a, b), `${boxes[i][0]} ${boxes[j][0]}`).toBe(false);
      // 선 끝 기호가 들어갈 틈
      if (a.y === b.y) expect(Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)).toBeGreaterThanOrEqual(80);
    }
  }
  return layout;
}

describe('layoutIe', () => {
  it('겹치지 않고 부모가 자식보다 위에 있다', () => {
    const m = model(RELATIONAL_SYNTAX_EXAMPLE);
    const layout = check(m);
    for (const link of m.links) {
      if (link.child.table === link.parent.table) continue;
      expect(layout.tables[link.parent.table].y).toBeLessThan(layout.tables[link.child.table].y);
    }
  });

  it('재귀와 고리, 넓은 층에서도 겹치지 않는다', () => {
    check(model('직원(_사번_, 부서번호, 상사)\nForeign Key (부서번호) references 부서\nForeign Key (상사) references 직원\n부서(_부서번호_, 관리자)\nForeign Key (관리자) references 직원'));
    const many = Array.from({ length: 14 }, (_, i) => `테이블${i}(_키${i}_, 아주긴컬럼이름${i}, 설명${i})`).join('\n');
    const layout = check(model(many));
    expect(layout.width).toBeLessThanOrEqual(IE_BOX.maxRowWidth);
  });

  it('상자 크기: 머리 40, 줄 28(빈 묶음은 반 줄). 너비는 네 칸의 합이고 긴 이름과 타입이 있으면 넓어진다', () => {
    const m = model('학생(_학번_, 이름)\n아주아주아주긴이름의테이블(_정말로아주아주아주긴컬럼이름입니다_)\n빈()');
    const base = IE_BOX.keyWidth + IE_BOX.minNameWidth + IE_BOX.minTypeWidth + IE_BOX.nullWidth;
    expect(ieBoxSize(m.tables[0])).toEqual({ w: base, h: 40 + 28 * 2 });
    // 기본키만 있으면 아래 묶음은 반 줄
    expect(ieBoxSize(m.tables[1]).h).toBe(40 + 28 + 14);
    expect(ieBoxSize(m.tables[1]).w).toBeGreaterThan(base);
    expect(ieBoxSize(m.tables[2])).toEqual({ w: base, h: 40 + 14 + 14 });
    const typed = model('학생(_학번_, 이름)', { [columnKey('학생', '이름')]: { type: 'VARCHAR(200) CHARACTER SET utf8mb4' } });
    expect(ieBoxSize(typed.tables[0]).w).toBeGreaterThan(base);
    // 물려받은 타입도 너비에 든다
    const inherited = model('A(_a_)\nB(_b_)\nForeign Key (b) references A', { [columnKey('A', 'a')]: { type: 'VARCHAR(200) CHARACTER SET utf8mb4' } });
    expect(ieBoxSize(inherited.tables[1]).w).toBe(ieBoxSize(inherited.tables[0]).w);
  });

  it('칸 폭: 키와 NULL 칸은 고정, 타입 칸은 가장 긴 타입에, 남는 폭은 이름 칸에', () => {
    const m = model('학생(_학번_, 이름)', { [columnKey('학생', '학번')]: { type: 'CHAR(8)' }, [columnKey('학생', '이름')]: { type: 'VARCHAR(200)' } });
    const g = ieColumnGrid(m.tables[0]);
    expect(g.key).toBe(IE_BOX.keyWidth);
    expect(g.nullable).toBe(IE_BOX.nullWidth);
    expect(g.key + g.name + g.type + g.nullable).toBe(g.w);
    expect(g.type).toBeGreaterThan(ieColumnGrid(model('학생(_학번_, 이름)').tables[0]).type);
    const wide = ieColumnGrid(m.tables[0], g.w + 40);
    expect(wide).toEqual({ ...g, name: g.name + 40, w: g.w + 40 });
    // 테이블 이름이 길면 이름 칸이 넓어진다
    const long = ieColumnGrid(model('아주아주아주아주아주긴테이블이름(_a_)').tables[0]);
    expect(long.key + long.name + long.type + long.nullable).toBe(long.w);
    expect(long.name).toBeGreaterThan(IE_BOX.minNameWidth);
  });

  it('같은 입력이면 같은 배치', () => {
    const m = model(RELATIONAL_SYNTAX_EXAMPLE);
    expect(layoutIe(m)).toEqual(layoutIe(model(RELATIONAL_SYNTAX_EXAMPLE)));
    expect(layoutIe({ tables: [], links: [] })).toEqual({ tables: {}, width: 0, height: 0 });
  });
});
