/**
 * 논리 모델의 텍스트 형식. 한 줄에 한 문장씩 적고, 좌표는 없다.
 *
 *   title "수강신청"
 *   entity 학생 { 학번 key, 이름 { 성, 이름 }, 전화번호 multi }
 *   weak entity 부양가족 { 이름 partial }
 *   relationship 수강 (학생 M total, 과목 N) { 성적 }
 *   identifying relationship 부양 (직원 1, 부양가족 N total)
 *   relationship 관리 (직원 1 as 상사, 직원 N as 부하)
 *   specialization 직원 disjoint total { 비서, 기술자 }
 *   note "메모 글자"
 *
 * 이름은 공백과 { } ( ) , " # 이 없으면 그대로 쓰고, 있으면 큰따옴표로 묶는다(\" \\ \n \r \t).
 * 읽지 못하면 ModelSyntaxError를 던진다. 메시지는 AI가 자기 글을 고칠 수 있게 영어로 적는다.
 */
import {
  ModelSyntaxError,
  type Model,
  type ModelAttribute,
  type ModelEntity,
  type ModelParticipant,
  type ModelRelationship,
  type ModelSpecialization,
} from './types';

// ───────────────────────── 토큰 ─────────────────────────

type TokenType = 'word' | 'string' | '{' | '}' | '(' | ')' | ',' | 'nl' | 'eof';

interface Token {
  type: TokenType;
  /** word와 string은 이름 값, 나머지는 기호 그대로 */
  value: string;
  line: number;
  column: number;
}

const PUNCTUATION = new Set(['{', '}', '(', ')', ',']);

/** 따옴표 없이 쓸 수 없는 글자(공백류와 구분 기호) */
function isBareBreak(ch: string): boolean {
  return /\s/.test(ch) || PUNCTUATION.has(ch) || ch === '"' || ch === '#';
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let lineStart = 0;
  let i = 0;
  const n = text.length;
  const col = (index: number) => index - lineStart + 1;

  while (i < n) {
    const ch = text[i];
    if (ch === '\n') {
      tokens.push({ type: 'nl', value: '\n', line, column: col(i) });
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(ch) || ch === '\uFEFF') {
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      tokens.push({ type: ch as TokenType, value: ch, line, column: col(i) });
      i++;
      continue;
    }
    if (ch === '"') {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= n || text[i] === '\n') {
          throw new ModelSyntaxError('unterminated string — close it with " on the same line (write \\n for a line break inside a name)', line, col(start));
        }
        const c = text[i];
        if (c === '"') {
          i++;
          break;
        }
        if (c === '\\') {
          const next = text[i + 1];
          const mapped = next === undefined ? undefined : ESCAPES[next];
          if (mapped === undefined) {
            throw new ModelSyntaxError(`unknown escape \\${next ?? ''} in string — only \\" \\\\ \\n \\r \\t are allowed`, line, col(i));
          }
          value += mapped;
          i += 2;
          continue;
        }
        value += c;
        i++;
      }
      tokens.push({ type: 'string', value, line, column: col(start) });
      continue;
    }
    const start = i;
    while (i < n && !isBareBreak(text[i])) i++;
    tokens.push({ type: 'word', value: text.slice(start, i), line, column: col(start) });
  }
  tokens.push({ type: 'eof', value: '', line, column: col(i) });
  return tokens;
}

// ───────────────────────── 읽기 ─────────────────────────

const STATEMENTS = 'title, entity, weak entity, relationship, identifying relationship, specialization, note';

function show(t: Token): string {
  if (t.type === 'eof') return 'end of text';
  if (t.type === 'nl') return 'end of line';
  if (t.type === 'string') return quote(t.value);
  return `"${t.value}"`;
}

function fail(message: string, at: Token): never {
  throw new ModelSyntaxError(message, at.line, at.column);
}

interface PendingRelationship {
  relationship: ModelRelationship;
  participantTokens: Token[];
}

interface PendingSpecialization {
  spec: ModelSpecialization;
  parentToken: Token;
  childTokens: Token[];
}

/** 두 글자열의 편집 거리(가까운 이름을 권할 때만 쓴다) */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(up + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

function suggest(name: string, known: Iterable<string>): string {
  let best: string | null = null;
  let bestDistance = Infinity;
  const lower = name.trim().toLowerCase();
  for (const k of known) {
    const d = k.trim().toLowerCase() === lower ? 0 : editDistance(k, name);
    if (d < bestDistance) {
      best = k;
      bestDistance = d;
    }
  }
  if (best === null || bestDistance > Math.max(1, Math.floor(name.length / 3))) return '';
  return ` (did you mean ${quote(best)}?)`;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== 'eof') this.pos++;
    return t;
  }
  private skipNewlines(): void {
    while (this.peek().type === 'nl') this.pos++;
  }
  /** 줄바꿈을 건너뛴 다음 토큰이 type이면 그 앞까지 옮기고 true */
  private lookPastNewlines(type: TokenType): boolean {
    let p = this.pos;
    while (this.tokens[p].type === 'nl') p++;
    if (this.tokens[p].type !== type) return false;
    this.pos = p;
    return true;
  }

  private name(what: string): Token {
    const t = this.peek();
    if (t.type === 'word' || t.type === 'string') return this.next();
    return fail(`expected ${what} but found ${show(t)} — a name with spaces or any of { } ( ) , # must be in double quotes`, t);
  }

  private endOfStatement(after: string): void {
    const t = this.peek();
    if (t.type === 'nl' || t.type === 'eof') return;
    fail(`unexpected ${show(t)} after ${after} — put each statement on its own line and quote names that contain spaces`, t);
  }

  parse(): Model {
    const model: Model = { entities: [], relationships: [], specializations: [], notes: [] };
    const entityTokens = new Map<string, Token>();
    const relationships: PendingRelationship[] = [];
    const specs: PendingSpecialization[] = [];
    let titleSeen = false;

    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (t.type === 'eof') break;
      if (t.type !== 'word') {
        fail(`expected a statement (${STATEMENTS}) but found ${show(t)}`, t);
      }
      switch (t.value) {
        case 'title': {
          this.next();
          if (titleSeen) fail('duplicate title — a model has at most one title line', t);
          titleSeen = true;
          model.title = this.name('the title text').value;
          this.endOfStatement('the title');
          break;
        }
        case 'weak':
        case 'entity': {
          this.next();
          let weak = false;
          if (t.value === 'weak') {
            const kw = this.peek();
            if (kw.type !== 'word' || kw.value !== 'entity') fail(`expected "entity" after "weak" but found ${show(kw)}`, kw);
            this.next();
            weak = true;
          }
          const nameToken = this.name('an entity name');
          if (entityTokens.has(nameToken.value)) {
            const first = entityTokens.get(nameToken.value)!;
            fail(`duplicate entity ${quote(nameToken.value)} — it is already declared on line ${first.line}; entity names must be unique`, nameToken);
          }
          entityTokens.set(nameToken.value, nameToken);
          const entity: ModelEntity = { name: nameToken.value, attributes: [] };
          if (weak) entity.weak = true;
          if (this.lookPastNewlines('{')) entity.attributes = this.attributeBlock();
          model.entities.push(entity);
          this.endOfStatement(`entity ${quote(entity.name)}`);
          break;
        }
        case 'identifying':
        case 'relationship': {
          this.next();
          let identifying = false;
          if (t.value === 'identifying') {
            const kw = this.peek();
            if (kw.type !== 'word' || kw.value !== 'relationship') fail(`expected "relationship" after "identifying" but found ${show(kw)}`, kw);
            this.next();
            identifying = true;
          }
          const nameToken = this.name('a relationship name');
          const relationship: ModelRelationship = { name: nameToken.value, participants: [], attributes: [] };
          if (identifying) relationship.identifying = true;
          if (!this.lookPastNewlines('(')) {
            const found = this.peek();
            fail(
              `expected "(" after relationship ${quote(relationship.name)} but found ${show(found)} — list the participants like: relationship ${bare(relationship.name)} (A 1, B N)`,
              found,
            );
          }
          const participantTokens = this.participants(relationship);
          if (this.lookPastNewlines('{')) relationship.attributes = this.attributeBlock();
          model.relationships.push(relationship);
          relationships.push({ relationship, participantTokens });
          this.endOfStatement(`relationship ${quote(relationship.name)}`);
          break;
        }
        case 'specialization': {
          this.next();
          const parentToken = this.name('the supertype entity name');
          const kindToken = this.peek();
          if (kindToken.type !== 'word' || (kindToken.value !== 'disjoint' && kindToken.value !== 'overlap')) {
            fail(`expected "disjoint" or "overlap" after the supertype name but found ${show(kindToken)}`, kindToken);
          }
          this.next();
          const spec: ModelSpecialization = { parent: parentToken.value, kind: kindToken.value === 'disjoint' ? 'd' : 'o', children: [] };
          const totalToken = this.peek();
          if (totalToken.type === 'word' && totalToken.value === 'total') {
            this.next();
            spec.total = true;
          }
          if (!this.lookPastNewlines('{')) {
            const found = this.peek();
            fail(
              `expected "{" with the subtype entity names but found ${show(found)} — write: specialization ${bare(spec.parent)} ${kindToken.value} { A, B }`,
              found,
            );
          }
          const childTokens = this.nameList(this.next(), 'a subtype entity name');
          spec.children = childTokens.map((c) => c.value);
          model.specializations.push(spec);
          specs.push({ spec, parentToken, childTokens });
          this.endOfStatement('the specialization');
          break;
        }
        case 'note': {
          this.next();
          model.notes.push(this.name('the note text').value);
          this.endOfStatement('the note');
          break;
        }
        default:
          fail(`unknown statement ${show(t)} — a line must start with one of: ${STATEMENTS}`, t);
      }
    }

    // 선언 순서와 무관하게, 다 읽은 뒤에 엔티티 이름을 확인한다
    const known = [...entityTokens.keys()];
    const unknown = (token: Token, where: string): never =>
      fail(`unknown entity ${quote(token.value)} in ${where}${suggest(token.value, known)} — declare it with: entity ${bare(token.value)}`, token);
    for (const { relationship, participantTokens } of relationships) {
      const count = new Map<string, number>();
      for (const token of participantTokens) {
        if (!entityTokens.has(token.value)) unknown(token, `relationship ${quote(relationship.name)}`);
        const c = (count.get(token.value) ?? 0) + 1;
        count.set(token.value, c);
        if (c > 2) {
          fail(`entity ${quote(token.value)} appears more than twice in relationship ${quote(relationship.name)} — an entity can take part at most twice (recursive relationship)`, token);
        }
      }
    }
    for (const { spec, parentToken, childTokens } of specs) {
      if (!entityTokens.has(parentToken.value)) unknown(parentToken, 'specialization');
      const seen = new Set<string>();
      for (const token of childTokens) {
        if (!entityTokens.has(token.value)) unknown(token, `specialization of ${quote(spec.parent)}`);
        if (token.value === spec.parent) fail(`entity ${quote(token.value)} cannot be a subtype of itself`, token);
        if (seen.has(token.value)) fail(`subtype ${quote(token.value)} is listed twice in the specialization of ${quote(spec.parent)}`, token);
        seen.add(token.value);
      }
    }
    return model;
  }

  /** '{' 다음부터 '}'까지의 속성 목록. 현재 위치는 '{' */
  private attributeBlock(): ModelAttribute[] {
    const open = this.next();
    const list: ModelAttribute[] = [];
    for (;;) {
      while (this.peek().type === 'nl' || this.peek().type === ',') this.pos++;
      const t = this.peek();
      if (t.type === '}') {
        this.next();
        return list;
      }
      if (t.type === 'eof') fail(`missing "}" to close the "{" opened on line ${open.line}`, open);
      list.push(this.attribute());
      const after = this.peek();
      if (after.type !== ',' && after.type !== 'nl' && after.type !== '}' && after.type !== 'eof') {
        fail(`unexpected ${show(after)} in attribute list — separate attributes with commas or newlines`, after);
      }
    }
  }

  private attribute(): ModelAttribute {
    const nameToken = this.name('an attribute name');
    const attr: ModelAttribute = { name: nameToken.value };
    for (;;) {
      const t = this.peek();
      if (t.type === 'word') {
        if (t.value === 'key' || t.value === 'partial') {
          if (attr.key) {
            fail(attr.key === t.value ? `"${t.value}" is written twice` : 'an attribute cannot be both "key" and "partial"', t);
          }
          attr.key = t.value;
        } else if (t.value === 'multi') {
          if (attr.multivalued) fail('"multi" is written twice', t);
          attr.multivalued = true;
        } else {
          fail(
            `unknown attribute modifier "${t.value}" — quote names that contain spaces: ${quote(`${nameToken.value} ${t.value}`)} (modifiers are key, partial, multi; separate attributes with commas or newlines)`,
            t,
          );
        }
        this.next();
        continue;
      }
      if (t.type === 'string') {
        fail(`unexpected ${show(t)} after attribute ${quote(nameToken.value)} — separate attributes with commas or newlines`, t);
      }
      if (t.type === '{' || (t.type === 'nl' && this.lookPastNewlines('{'))) {
        const parts = this.attributeBlock();
        if (parts.length > 0) attr.parts = parts;
      }
      return attr;
    }
  }

  /** '(' 다음부터 ')'까지의 참여자 목록. 현재 위치는 '('. 참여자 이름 토큰을 돌려준다 */
  private participants(relationship: ModelRelationship): Token[] {
    const open = this.next();
    const tokens: Token[] = [];
    const shape = 'entity [cardinality] [total] [as role]';
    for (;;) {
      while (this.peek().type === 'nl' || this.peek().type === ',') this.pos++;
      const t = this.peek();
      if (t.type === ')') {
        this.next();
        return tokens;
      }
      if (t.type === 'eof') fail(`missing ")" to close the "(" opened on line ${open.line}`, open);
      const entityToken = this.name('a participant entity name');
      const p: ModelParticipant = { entity: entityToken.value, cardinality: '' };
      const c = this.peek();
      if (c.type === 'string' || (c.type === 'word' && c.value !== 'total' && c.value !== 'as')) {
        p.cardinality = c.value;
        this.next();
      }
      for (;;) {
        const m = this.peek();
        if (m.type === 'word' && m.value === 'total') {
          if (p.total) fail('"total" is written twice', m);
          p.total = true;
          this.next();
        } else if (m.type === 'word' && m.value === 'as') {
          if (p.role !== undefined) fail('"as" is written twice — a participant has one role name', m);
          this.next();
          const r = this.peek();
          if (r.type !== 'word' && r.type !== 'string') fail(`expected a role name after "as" but found ${show(r)}`, r);
          this.next();
          p.role = r.value;
        } else if (m.type === ',' || m.type === 'nl' || m.type === ')' || m.type === 'eof') {
          break;
        } else {
          fail(
            `unexpected ${show(m)} in participant ${quote(p.entity)} — a participant is: ${shape}; separate participants with commas and quote names that contain spaces`,
            m,
          );
        }
      }
      if (p.role === '' || p.role === undefined) delete p.role;
      relationship.participants.push(p);
      tokens.push(entityToken);
    }
  }

  /** '{' 다음부터 '}'까지의 이름 목록. open은 이미 읽은 '{' */
  private nameList(open: Token, what: string): Token[] {
    const list: Token[] = [];
    for (;;) {
      while (this.peek().type === 'nl' || this.peek().type === ',') this.pos++;
      const t = this.peek();
      if (t.type === '}') {
        this.next();
        return list;
      }
      if (t.type === 'eof') fail(`missing "}" to close the "{" opened on line ${open.line}`, open);
      list.push(this.name(what));
      const after = this.peek();
      if (after.type !== ',' && after.type !== 'nl' && after.type !== '}' && after.type !== 'eof') {
        fail(`unexpected ${show(after)} — separate names with commas or newlines and quote names that contain spaces`, after);
      }
    }
  }
}

/** 텍스트를 모델로 읽는다. 읽지 못하면 ModelSyntaxError */
export function parseModel(text: string): Model {
  return new Parser(tokenize(text)).parse();
}

// ───────────────────────── 쓰기 ─────────────────────────

function quote(value: string): string {
  let out = '"';
  for (const ch of value) {
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return `${out}"`;
}

function needsQuote(value: string): boolean {
  if (value === '') return true;
  for (let i = 0; i < value.length; i++) {
    if (isBareBreak(value[i]) || value[i] === '\uFEFF') return true;
  }
  return false;
}

/** 꼭 필요할 때만 따옴표로 묶는다. keywords는 그 자리에서 예약어로 읽히는 말 */
function bare(value: string, keywords?: readonly string[]): string {
  return needsQuote(value) || (keywords !== undefined && keywords.includes(value)) ? quote(value) : value;
}

function normalizeAttribute(a: ModelAttribute): ModelAttribute {
  const out: ModelAttribute = { name: a.name };
  if (a.key === 'key' || a.key === 'partial') out.key = a.key;
  if (a.multivalued) out.multivalued = true;
  if (a.parts && a.parts.length > 0) out.parts = a.parts.map(normalizeAttribute);
  return out;
}

/**
 * 선택 필드를 한 가지 모양으로 맞춘다(false와 빈 값은 필드 자체를 뺀다).
 * parseModel이 돌려주는 모양과 같으므로, 손으로 만든 모델을 비교하기 전에 쓴다.
 */
export function normalizeModel(model: Model): Model {
  const out: Model = {
    entities: model.entities.map((e) => {
      const entity: ModelEntity = { name: e.name, attributes: (e.attributes ?? []).map(normalizeAttribute) };
      if (e.weak) entity.weak = true;
      return entity;
    }),
    relationships: model.relationships.map((r) => {
      const relationship: ModelRelationship = {
        name: r.name,
        participants: (r.participants ?? []).map((p) => {
          const participant: ModelParticipant = { entity: p.entity, cardinality: p.cardinality ?? '' };
          if (p.total) participant.total = true;
          if (p.role) participant.role = p.role;
          return participant;
        }),
        attributes: (r.attributes ?? []).map(normalizeAttribute),
      };
      if (r.identifying) relationship.identifying = true;
      return relationship;
    }),
    specializations: model.specializations.map((s) => {
      const spec: ModelSpecialization = { parent: s.parent, kind: s.kind === 'o' ? 'o' : 'd', children: [...(s.children ?? [])] };
      if (s.total) spec.total = true;
      return spec;
    }),
    notes: [...model.notes],
  };
  if (model.title !== undefined) out.title = model.title;
  return out;
}

function printAttribute(a: ModelAttribute): string {
  let out = bare(a.name);
  if (a.key === 'key' || a.key === 'partial') out += ` ${a.key}`;
  if (a.multivalued) out += ' multi';
  if (a.parts && a.parts.length > 0) out += ` { ${a.parts.map(printAttribute).join(', ')} }`;
  return out;
}

function printAttributeBlock(attributes: ModelAttribute[]): string {
  if (!attributes || attributes.length === 0) return '';
  return ` {\n${attributes.map((a) => `  ${printAttribute(a)}`).join('\n')}\n}`;
}

function printParticipant(p: ModelParticipant): string {
  let out = bare(p.entity);
  if (p.cardinality) out += ` ${bare(p.cardinality, ['total', 'as'])}`;
  if (p.total) out += ' total';
  if (p.role) out += ` as ${bare(p.role)}`;
  return out;
}

/** 모델을 텍스트로 적는다. parseModel(printModel(m))은 normalizeModel(m)과 같다 */
export function printModel(model: Model): string {
  // 문장 하나가 여러 줄이면 앞뒤를 빈 줄로 띄우고, 종류가 바뀔 때도 띄운다
  const statements: Array<{ group: string; text: string }> = [];
  if (model.title !== undefined) statements.push({ group: 'title', text: `title ${bare(model.title)}` });
  for (const e of model.entities) {
    statements.push({ group: 'entity', text: `${e.weak ? 'weak ' : ''}entity ${bare(e.name)}${printAttributeBlock(e.attributes)}` });
  }
  for (const r of model.relationships) {
    const participants = (r.participants ?? []).map(printParticipant).join(', ');
    statements.push({
      group: 'relationship',
      text: `${r.identifying ? 'identifying ' : ''}relationship ${bare(r.name)} (${participants})${printAttributeBlock(r.attributes)}`,
    });
  }
  for (const s of model.specializations) {
    const children = (s.children ?? []).map((c) => bare(c)).join(', ');
    statements.push({
      group: 'specialization',
      text: `specialization ${bare(s.parent)} ${s.kind === 'o' ? 'overlap' : 'disjoint'}${s.total ? ' total' : ''} {${children ? ` ${children} ` : ''}}`,
    });
  }
  for (const note of model.notes) statements.push({ group: 'note', text: `note ${bare(note)}` });

  let out = '';
  statements.forEach((s, i) => {
    if (i > 0) {
      const prev = statements[i - 1];
      const blank = prev.group !== s.group || prev.text.includes('\n') || s.text.includes('\n');
      out += blank ? '\n\n' : '\n';
    }
    out += s.text;
  });
  return out === '' ? '' : `${out}\n`;
}
