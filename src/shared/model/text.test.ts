import { describe, expect, it } from 'vitest';
import { COMPANY, SHOP, SMALL, UNIVERSITY } from './fixtures';
import { normalizeModel, parseModel, printModel } from './text';
import { ModelSyntaxError, type Model } from './types';

/** 읽다가 난 오류를 돌려준다. 오류가 없으면 테스트가 실패한다 */
function syntaxError(text: string): ModelSyntaxError {
  try {
    parseModel(text);
  } catch (e) {
    expect(e).toBeInstanceOf(ModelSyntaxError);
    return e as ModelSyntaxError;
  }
  throw new Error('오류가 나야 하는데 읽혔다');
}

const EXAMPLE = `title "수강신청"

entity 학생 {
  학번 key
  이름 { 성, 이름 }
  전화번호 multi
}

weak entity 부양가족 {
  이름 partial
  관계
}

entity 과목
entity 직원
entity 비서
entity 기술자

relationship 수강 (학생 M total, 과목 N) {
  성적
}

identifying relationship 부양 (직원 1, 부양가족 N total)

relationship 관리 (직원 1 as 상사, 직원 N as 부하)

specialization 직원 disjoint total { 비서, 기술자 }

note "메모 글자"
`;

describe('parseModel', () => {
  it('문장 종류를 모두 읽는다', () => {
    const m = parseModel(EXAMPLE);
    expect(m.title).toBe('수강신청');
    expect(m.entities.map((e) => e.name)).toEqual(['학생', '부양가족', '과목', '직원', '비서', '기술자']);
    expect(m.entities[0]).toEqual({
      name: '학생',
      attributes: [{ name: '학번', key: 'key' }, { name: '이름', parts: [{ name: '성' }, { name: '이름' }] }, { name: '전화번호', multivalued: true }],
    });
    expect(m.entities[1]).toEqual({ name: '부양가족', weak: true, attributes: [{ name: '이름', key: 'partial' }, { name: '관계' }] });
    expect(m.entities[2]).toEqual({ name: '과목', attributes: [] });
    expect(m.relationships).toEqual([
      { name: '수강', participants: [{ entity: '학생', cardinality: 'M', total: true }, { entity: '과목', cardinality: 'N' }], attributes: [{ name: '성적' }] },
      { name: '부양', identifying: true, participants: [{ entity: '직원', cardinality: '1' }, { entity: '부양가족', cardinality: 'N', total: true }], attributes: [] },
      { name: '관리', participants: [{ entity: '직원', cardinality: '1', role: '상사' }, { entity: '직원', cardinality: 'N', role: '부하' }], attributes: [] },
    ]);
    expect(m.specializations).toEqual([{ parent: '직원', kind: 'd', total: true, children: ['비서', '기술자'] }]);
    expect(m.notes).toEqual(['메모 글자']);
  });

  it('빈 글은 빈 모델이다', () => {
    expect(parseModel('')).toEqual({ entities: [], relationships: [], specializations: [], notes: [] });
    expect(parseModel('\n  # 주석만\n')).toEqual({ entities: [], relationships: [], specializations: [], notes: [] });
  });

  it('속성과 참여자는 쉼표나 줄바꿈으로 나누고, 주석과 줄 끝 쉼표를 받아 준다', () => {
    const m = parseModel(`
      entity A { a key, b multi   # 주석
        c { x
            y, }
      }
      entity B
      relationship R (
        A 1 total as left   # 왼쪽
        B N,
      ) { since }
    `);
    expect(m.entities[0].attributes).toEqual([{ name: 'a', key: 'key' }, { name: 'b', multivalued: true }, { name: 'c', parts: [{ name: 'x' }, { name: 'y' }] }]);
    expect(m.relationships[0].participants).toEqual([{ entity: 'A', cardinality: '1', total: true, role: 'left' }, { entity: 'B', cardinality: 'N' }]);
    expect(m.relationships[0].attributes).toEqual([{ name: 'since' }]);
  });

  it('여는 괄호는 다음 줄에 와도 된다', () => {
    const m = parseModel('entity A\n{\n  id key\n}\nentity B\nrelationship R\n(A 1, B N)\n{ x }\n');
    expect(m.entities[0].attributes).toEqual([{ name: 'id', key: 'key' }]);
    expect(m.relationships[0].attributes).toEqual([{ name: 'x' }]);
  });

  it('속성 수식어는 순서를 가리지 않고, 깊이 제한 없이 겹친다', () => {
    const m = parseModel('entity A { a multi key { b { c { d partial } } } }');
    expect(m.entities[0].attributes).toEqual([
      { name: 'a', key: 'key', multivalued: true, parts: [{ name: 'b', parts: [{ name: 'c', parts: [{ name: 'd', key: 'partial' }] }] }] },
    ]);
  });

  it('카디널리티는 total과 as가 아닌 토큰 하나이고, 따옴표로 묶으면 항상 글자 그대로다', () => {
    const m = parseModel('entity A\nentity B\nrelationship R (A 0..N, B "total" total)\nrelationship S (A total, B as b)\nrelationship T (A "as" as "x y", B "(1,N)")');
    expect(m.relationships[0].participants).toEqual([{ entity: 'A', cardinality: '0..N' }, { entity: 'B', cardinality: 'total', total: true }]);
    expect(m.relationships[1].participants).toEqual([{ entity: 'A', cardinality: '', total: true }, { entity: 'B', cardinality: '', role: 'b' }]);
    expect(m.relationships[2].participants).toEqual([{ entity: 'A', cardinality: 'as', role: 'x y' }, { entity: 'B', cardinality: '(1,N)' }]);
  });

  it('따옴표 안의 이스케이프를 푼다', () => {
    const m = parseModel('entity "a \\"b\\" \\\\ c\\nd" { "" }\nnote ""');
    expect(m.entities[0].name).toBe('a "b" \\ c\nd');
    expect(m.entities[0].attributes).toEqual([{ name: '' }]);
    expect(m.notes).toEqual(['']);
  });

  it('선언 순서와 상관없이 엔티티를 가리킬 수 있다', () => {
    const m = parseModel('relationship R (A 1, B N)\nspecialization A overlap { B }\nentity B\nentity A');
    expect(m.relationships[0].participants.map((p) => p.entity)).toEqual(['A', 'B']);
    expect(m.specializations[0]).toEqual({ parent: 'A', kind: 'o', children: ['B'] });
  });

  it('참여자가 없는 관계와 서브타입이 없는 특수화도 읽는다', () => {
    const m = parseModel('entity A\nrelationship R ()\nspecialization A disjoint {}');
    expect(m.relationships[0].participants).toEqual([]);
    expect(m.specializations[0].children).toEqual([]);
  });
});

describe('parseModel 오류', () => {
  it('모르는 속성 수식어는 위치와 고치는 방법을 알려 준다', () => {
    const e = syntaxError('entity person {\n  birth date\n}');
    expect(e.line).toBe(2);
    expect(e.column).toBe(9);
    expect(e.message).toContain('unknown attribute modifier "date"');
    expect(e.message).toContain('"birth date"');
  });

  it('같은 이름의 엔티티가 두 번 나오면 두 번째 이름 자리를 가리킨다', () => {
    const e = syntaxError('entity A\nweak entity A');
    expect([e.line, e.column]).toEqual([2, 13]);
    expect(e.message).toContain('duplicate entity "A"');
  });

  it('선언되지 않은 엔티티를 참여자로 쓰면 그 토큰을 가리킨다', () => {
    const e = syntaxError('entity Student\nrelationship takes (Student M, Course N)');
    expect([e.line, e.column]).toEqual([2, 32]);
    expect(e.message).toContain('unknown entity "Course"');
    expect(e.message).toContain('entity Course');
  });

  it('비슷한 이름이 있으면 권한다', () => {
    const e = syntaxError('entity Student\nentity Course\nrelationship takes (student M, Course N)');
    expect(e.message).toContain('did you mean "Student"');
  });

  it('한 관계에 같은 엔티티가 세 번 나오면 세 번째를 가리킨다', () => {
    const e = syntaxError('entity A\nrelationship R (A 1, A N, A M)');
    expect([e.line, e.column]).toEqual([2, 27]);
    expect(e.message).toContain('more than twice');
  });

  it('특수화의 서브타입이 슈퍼타입과 같거나 두 번 나오면 막는다', () => {
    const self = syntaxError('entity A\nentity B\nspecialization A disjoint { B, A }');
    expect([self.line, self.column]).toEqual([3, 32]);
    expect(self.message).toContain('subtype of itself');
    const twice = syntaxError('entity A\nentity B\nspecialization A disjoint { B, B }');
    expect([twice.line, twice.column]).toEqual([3, 32]);
    expect(twice.message).toContain('listed twice');
    const unknown = syntaxError('entity A\nspecialization A overlap { C }');
    expect([unknown.line, unknown.column]).toEqual([2, 28]);
    const parent = syntaxError('entity A\nspecialization Z overlap { A }');
    expect([parent.line, parent.column]).toEqual([2, 16]);
  });

  it('문장이 아닌 것으로 시작하는 줄을 막는다', () => {
    const e = syntaxError('entity A\ntable B');
    expect([e.line, e.column]).toEqual([2, 1]);
    expect(e.message).toContain('unknown statement "table"');
    expect(syntaxError('"entity" A').message).toContain('expected a statement');
  });

  it('따옴표 없는 이름에 공백이 있으면 줄 끝에서 알려 준다', () => {
    const e = syntaxError('entity birth date');
    expect([e.line, e.column]).toEqual([1, 14]);
    expect(e.message).toContain('quote names');
  });

  it('닫지 않은 따옴표와 괄호, 모르는 이스케이프를 막는다', () => {
    expect(syntaxError('note "abc').message).toContain('unterminated string');
    expect(syntaxError('note "a\\qb"').message).toContain('unknown escape');
    const brace = syntaxError('entity A {\n  x\n');
    expect([brace.line, brace.column]).toEqual([1, 10]);
    expect(brace.message).toContain('missing "}"');
    expect(syntaxError('entity A\nrelationship R (A 1').message).toContain('missing ")"');
  });

  it('관계에 괄호가 없거나 특수화의 종류가 없으면 본보기를 보여 준다', () => {
    expect(syntaxError('entity A\nrelationship R').message).toContain('relationship R (A 1, B N)');
    expect(syntaxError('entity A\nspecialization A { }').message).toContain('"disjoint" or "overlap"');
    expect(syntaxError('entity A\nspecialization A disjoint').message).toContain('specialization A disjoint { A, B }');
  });

  it('수식어가 겹치거나 참여자 모양이 틀리면 막는다', () => {
    expect(syntaxError('entity A { x key partial }').message).toContain('both "key" and "partial"');
    expect(syntaxError('entity A { x multi multi }').message).toContain('twice');
    expect(syntaxError('entity A\nentity B\nrelationship R (A 1 N, B 1)').message).toContain('entity [cardinality] [total] [as role]');
    expect(syntaxError('entity A\nentity B\nrelationship R (A 1 as, B 1)').message).toContain('role name after "as"');
    expect(syntaxError('title a\ntitle b').message).toContain('duplicate title');
    expect(syntaxError('weak A').message).toContain('expected "entity" after "weak"');
  });
});

describe('printModel', () => {
  it('필요할 때만 따옴표로 묶는다', () => {
    const model: Model = {
      title: '수강 신청',
      entities: [
        { name: '학생', attributes: [{ name: '학번', key: 'key' }, { name: 'birth date' }, { name: 'key' }, { name: '', multivalued: true }] },
        { name: 'a#b', weak: true, attributes: [] },
      ],
      relationships: [
        {
          name: '수강',
          participants: [
            { entity: '학생', cardinality: 'total', total: true, role: 'as' },
            { entity: 'a#b', cardinality: 'as' },
          ],
          attributes: [],
        },
      ],
      specializations: [],
      notes: ['두 줄\n메모', 'plain'],
    };
    expect(printModel(model)).toBe(
      [
        'title "수강 신청"',
        '',
        'entity 학생 {',
        '  학번 key',
        '  "birth date"',
        '  key',
        '  "" multi',
        '}',
        '',
        'weak entity "a#b"',
        '',
        'relationship 수강 (학생 "total" total as as, "a#b" "as")',
        '',
        'note "두 줄\\n메모"',
        'note plain',
        '',
      ].join('\n'),
    );
    expect(parseModel(printModel(model))).toEqual(normalizeModel(model));
  });

  it('빈 모델은 빈 글이다', () => {
    expect(printModel({ entities: [], relationships: [], specializations: [], notes: [] })).toBe('');
  });

  it('예제 모델들이 읽고 쓰기를 거쳐도 그대로다', () => {
    for (const text of [EXAMPLE, UNIVERSITY, COMPANY, SMALL, SHOP]) {
      const model = parseModel(text);
      const printed = printModel(model);
      expect(parseModel(printed)).toEqual(model);
      expect(printModel(parseModel(printed))).toBe(printed);
    }
  });

  it('까다로운 이름도 읽고 쓰기를 거쳐 그대로다', () => {
    const names = ['', ' ', 'a b', 'a,b', '{', '}', '(x)', '"', '\\', 'a"b\\c', '줄\n바꿈', '탭\t문자', 'CR\r문자', '#주석아님', 'entity', 'total', 'as', 'key', 'multi', 'title', '전각　공백', '🙂'];
    const model: Model = {
      title: 'a "b"',
      entities: names.map((name) => ({ name, attributes: names.map((n) => ({ name: n, parts: [{ name: n, key: 'partial' as const }] })) })),
      relationships: names.map((name, i) => ({
        name,
        identifying: i % 2 === 0,
        participants: [
          { entity: name, cardinality: names[(i + 1) % names.length], total: i % 3 === 0, role: names[(i + 2) % names.length] },
          { entity: names[(i + 5) % names.length], cardinality: '' },
        ],
        attributes: [{ name }],
      })),
      specializations: [{ parent: names[0], kind: 'o', total: true, children: names.slice(1) }],
      notes: names,
    };
    const normalized = normalizeModel(model);
    expect(parseModel(printModel(model))).toEqual(normalized);
  });

  it('false와 빈 선택 필드는 빼고 읽은 모양과 같게 맞춘다', () => {
    const model: Model = {
      entities: [{ name: 'A', weak: false, attributes: [{ name: 'x', multivalued: false, parts: [] }] }],
      relationships: [{ name: 'R', identifying: false, participants: [{ entity: 'A', cardinality: '1', total: false, role: '' }], attributes: [] }],
      specializations: [{ parent: 'A', kind: 'd', total: false, children: [] }],
      notes: [],
    };
    expect(normalizeModel(model)).toEqual({
      entities: [{ name: 'A', attributes: [{ name: 'x' }] }],
      relationships: [{ name: 'R', participants: [{ entity: 'A', cardinality: '1' }], attributes: [] }],
      specializations: [{ parent: 'A', kind: 'd', children: [] }],
      notes: [],
    });
    expect(Object.keys(normalizeModel(model).entities[0])).toEqual(['name', 'attributes']);
    expect(parseModel(printModel(model))).toEqual(normalizeModel(model));
  });
});
