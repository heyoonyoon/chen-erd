/**
 * 사람이 직접 적는 관계 모델. 이 파일은 계약이다: 엔진 쪽(파싱, IE 유도, SQL)과 화면 쪽이 함께 쓴다.
 * 바꿀 때는 추가만 한다.
 *
 * 흐름: Chen ERD(사람이 그림) → 관계 모델 글(사람이 수업 표기로 적음) → IE(글에서 유도) → SQL(IE에서 변환)
 * ERD에서 관계 모델을 자동으로 만들지 않는다. 글에 없는 것(타입, NULL 허용 여부 등)은 추측하지 않는다.
 * 사람이 컬럼 설정(타입, NOT NULL, UNIQUE)을 정하면 그만큼만 IE와 SQL에 반영한다.
 *
 * 저장(방 문서, 팀원과 실시간으로 함께 편집)
 *   doc.getText('relational-text')   관계 모델 글
 *   doc.getMap('relational-columns') 컬럼 설정. 키는 columnKey(table, column), 값은 ColumnSetting(JSON)
 */
import type { Message } from '../messages';

// ───────────────────────── 글에서 읽은 구조 ─────────────────────────

export interface RelColumnDef {
  name: string;
  /** 이름에 밑줄을 그은 기본키 컬럼인지 */
  primaryKey: boolean;
  /** 글에서의 위치(1부터) */
  line: number;
  column: number;
}

export interface RelForeignKeyDef {
  /** 이 테이블의 컬럼 이름들(복합 외래키면 여러 개, 글에 적은 순서) */
  columns: string[];
  /** 가리키는 테이블 이름. refColumns가 없으면 그 테이블의 기본키를 가리킨다 */
  refTable: string;
  /**
   * (추가) "Foreign Key (A) references T (B)"처럼 가리키는 컬럼을 적었을 때 그 이름들(columns와 같은 순서).
   * 적지 않았으면 없다
   */
  refColumns?: string[];
  line: number;
  column: number;
}

export interface RelTableDef {
  name: string;
  line: number;
  column: number;
  /** 글에 적은 순서 */
  columns: RelColumnDef[];
  foreignKeys: RelForeignKeyDef[];
}

export interface RelSchema {
  tables: RelTableDef[];
}

/** 글의 문제. 파싱은 멈추지 않고 읽을 수 있는 줄은 다 읽는다 */
export interface RelProblem {
  severity: 'error' | 'warning';
  /** 화면이 현재 언어로 바꾼다(합니다체) */
  message: Message;
  line: number;
  column: number;
  /** 밑줄을 그을 끝 위치(없으면 그 줄 끝까지) */
  endColumn?: number;
}

export interface ParseResult {
  schema: RelSchema;
  problems: RelProblem[];
}

// ───────────────────────── 사람이 정하는 컬럼 설정 ─────────────────────────

export interface ColumnSetting {
  /** SQL 타입 글자(예: 'VARCHAR(20)'). 없으면 미지정 */
  type?: string;
  /** true면 NOT NULL, false면 NULL 허용, 없으면 미지정. 기본키 컬럼은 정하지 않아도 NOT NULL로 본다 */
  notNull?: boolean;
  /** true면 UNIQUE(단일 컬럼). 없으면 미지정 */
  unique?: boolean;
}

/** columnKey(table, column) → 설정 */
export type ColumnSettings = Record<string, ColumnSetting>;

// ───────────────────────── IE(글과 설정에서 유도) ─────────────────────────

export interface IeColumn {
  name: string;
  primaryKey: boolean;
  foreignKey: boolean;
  /** 사람이 정한 타입. 없으면 null(그리지 않는다) */
  type: string | null;
  /** 기본키면 true, 아니면 사람이 정한 값, 없으면 null */
  notNull: boolean | null;
  /**
   * (추가) 외래키 컬럼에 타입을 정하지 않았을 때 가리키는 컬럼에서 물려받는 타입. toSql이 이 타입을 쓴다.
   * 사람이 정한 타입이 있거나 물려받을 것이 없으면 null. type과 구별해서 흐리게 그리면 된다.
   */
  inheritedType: string | null;
  /** (추가) 사람이 UNIQUE로 정했는지 */
  unique: boolean;
}

export interface IeTable {
  name: string;
  columns: IeColumn[];
}

/** 선 끝 하나. 알 수 없는 값은 null이고 그리지 않는다 */
export interface IeEnd {
  table: string;
  /** 0이면 동그라미, 1이면 막대, null이면 그리지 않음 */
  min: 0 | 1 | null;
  /** '1'이면 막대, 'N'이면 까마귀발 */
  max: '1' | 'N';
}

/**
 * 외래키 하나에 선 하나.
 *   parent.max = '1' (외래키는 기본키 하나를 가리킨다)
 *   parent.min = 외래키 컬럼이 모두 NOT NULL(기본키 포함)이면 1, 하나라도 사람이 NULL 허용으로 정했으면 0, 그 밖에는 null
 *   child.max  = 외래키 컬럼 묶음이 자식의 기본키 전체와 같거나 UNIQUE로 정해졌으면 '1', 아니면 'N'
 *   child.min  = 글로는 알 수 없어서 null
 *   identifying = 외래키 컬럼이 모두 자식의 기본키에 들어 있으면 true(실선), 아니면 false(점선)
 */
export interface IeLink {
  id: string;
  child: IeEnd;
  parent: IeEnd;
  identifying: boolean;
  columns: string[];
}

export interface IeModel {
  tables: IeTable[];
  links: IeLink[];
}

/** (추가, 예전 types.ts에서 옮김) IE 그림 배치. 키는 테이블 이름(IeTable.name) */
export interface IeLayout {
  /** 테이블 이름 → 왼쪽 위 좌표와 크기(월드 좌표, px) */
  tables: Record<string, { x: number; y: number; w: number; h: number }>;
  width: number;
  height: number;
}

export type SqlDialect = 'mysql' | 'postgresql' | 'oracle';

export interface SqlResult {
  sql: string;
  /** 타입을 정하지 않아 SQL에 자리 표시로 들어간 컬럼(화면이 경고로 보여 준다) */
  missingTypes: Array<{ table: string; column: string }>;
}

/** (추가) toSql의 선택 사항 */
export interface SqlOptions {
  /** 머리 주석에 적을 다이어그램 제목 */
  title?: string;
  /** true면 타입을 정하지 않은 컬럼 목록을 머리 주석으로도 적는다(API, CLI, MCP가 쓴다). 화면은 missingTypes로 따로 보여 주므로 기본은 false */
  listMissingTypes?: boolean;
  /** 0보다 크면 관계 모델 글에 오류가 그만큼 있어 읽은 부분만 옮겼다고 머리 주석에 적는다(API, CLI, MCP가 쓴다) */
  textErrors?: number;
}

/*
 * src/shared/relational/index.ts 가 내보내는 함수(엔진 쪽이 구현한다)
 *
 *   parseRelational(text: string): ParseResult
 *   columnKey(table: string, column: string): string
 *   deriveIe(schema: RelSchema, settings: ColumnSettings): IeModel
 *   layoutIe(model: IeModel): IeLayout             (기존 IeLayout 모양 유지: tables[name] = {x,y,w,h}, width, height)
 *   toSql(schema: RelSchema, settings: ColumnSettings, dialect: SqlDialect, opts?: { title?: string }): SqlResult
 *       타입을 정하지 않은 컬럼은 추측하지 않고 자리 표시를 넣는다. NOT NULL은 기본키와 사람이 정한 것만.
 *   getRelationalText(doc: Y.Doc): Y.Text
 *   readColumnSettings(doc: Y.Doc): ColumnSettings
 *   setColumnSetting(doc: Y.Doc, table: string, column: string, patch: ColumnSetting | null, origin?: unknown): void
 *       patch의 값이 undefined인 키는 지운다. null이면 그 컬럼 설정을 통째로 지운다.
 *
 * (추가) 엔진 쪽이 더한 것
 *   toSql의 opts는 SqlOptions(title, listMissingTypes, textErrors)
 *   setColumnSetting은 boolean을 돌려준다: 쓸 수 없는 값(틀린 타입 글자, 빈 이름)이면 아무것도 쓰지 않고 false
 *   setRelationalText(doc, text, origin?): void   글 전체를 바꾼다(달라진 가운데만 지우고 넣는다). 서버 PUT이 쓴다
 *   nameKey(name), cleanName(name)                이름 비교 규칙(names.ts). columnKey와 중복 검사가 같은 규칙을 쓴다
 *   cleanType(value): string | null               설정에 넣을 수 있는 타입 글자로 다듬기(MAX_TYPE_LENGTH = 100)
 *   TYPE_PLACEHOLDER = '/* 타입 미지정 *\/'        타입을 정하지 않은 컬럼의 SQL 자리 표시
 *   formatName, RELATIONAL_SYNTAX(영어), RELATIONAL_SYNTAX_RULES(메시지), RELATIONAL_SYNTAX_EXAMPLE
 *   ieBoxSize, IE_BOX, dialectType, quoteIdentifier, isSqlDialect, SQL_DIALECTS
 *   (edit.ts) planRenameColumn, planRenameTable, planTogglePrimaryKey → applyRelationalEdit(doc, plan, origin)
 *       IE에서 고친 이름과 기본키를 글에 되써 넣는다(글이 원본). 글에 오류가 있으면 고치지 않는다
 *   ieColumnGrid(table, width?), ieSectionHeight(rows)   IE 상자의 네 칸(키 | 이름 | 타입 | NULL) 폭과 묶음 높이(그림과 배치가 같은 값을 쓴다)
 *   getColumnSettingsMap, RELATIONAL_TEXT, RELATIONAL_COLUMNS
 *   RelProblem.endColumn은 밑줄 끝 바로 다음 칸이다(끝을 포함하지 않는다)
 */

// ───────────────────────── (추가) 밑줄이 있는 글 ─────────────────────────
/*
 * 학교 수업 표기를 그대로 받는다.
 *   Player (SSN, Name, DOB, Address)                ← 기본키는 이름에 밑줄을 긋는다(문서 편집기의 밑줄)
 *   Foreign Key (SSN) references Player (SSN)       ← 바로 위 테이블의 외래키. 가리키는 컬럼 목록은 생략 가능
 *   Performs_In (Performer_ID, Film_ID, Role)
 *   Foreign Key (Performer_ID) references Performer (ID)
 *   Foreign Key (Film_ID) references Film (Film_ID)
 * 예전 표기(_이름_, 컬럼 -> 테이블)도 계속 읽는다.
 *
 * 밑줄은 Y.Text의 서식 속성 UNDERLINE_ATTR(true)로 저장한다. 글자 자체에는 표시가 없다.
 * 밑줄을 표현할 수 없는 곳(API, CLI, MCP, 일반 텍스트 클립보드)에서는 밑줄 구간을 _이름_ 으로 바꿔 주고받는다.
 */

/** Y.Text 서식 속성 이름 */
export const UNDERLINE_ATTR = 'underline';

/** 글의 한 구간. from 포함, to 미포함. UTF-16 위치(JavaScript 문자열 인덱스) */
export interface TextRange {
  from: number;
  to: number;
}

/** 밑줄 정보가 붙은 글 */
export interface RelationalSource {
  text: string;
  /** 겹치지 않고 정렬된 밑줄 구간 */
  underlines: TextRange[];
}

/*
 * 엔진 쪽이 구현해 index.ts에서 내보내는 함수(추가)
 *
 *   parseRelational(input: string | RelationalSource): ParseResult
 *       문자열이면 밑줄 없음. 밑줄이 컬럼 이름에 걸리면 기본키다(이름의 일부만 걸리면 경고와 함께 기본키로 본다).
 *       문제 위치(line, column)는 원래 글 기준이다.
 *   readRelationalSource(doc: Y.Doc): RelationalSource          방 문서의 글과 밑줄
 *   setRelationalSource(doc: Y.Doc, source: RelationalSource, origin?: unknown): void
 *       글과 밑줄을 바뀐 부분만 고쳐 맞춘다
 *   toMarkup(source: RelationalSource): string                  밑줄 구간을 _이름_ 으로 바꾼 일반 텍스트
 *   fromMarkup(markup: string): RelationalSource                _이름_ 을 밑줄 구간으로 바꾸고 밑줄 문자를 뺀다
 *
 * (추가) 엔진 쪽이 더한 것
 *   편집기의 표기는 수업 표기 하나다. 글 안의 _ 는 이름의 글자이고(_SSN_ 은 이름이 '_SSN_'인 보통 컬럼, 밑줄을 그으라는 경고),
 *   화살표 표기(컬럼 -> 테이블, (a, b) -> 테이블)는 Foreign Key 줄로 적으라는 오류다. _이름_ 을 밑줄로 읽는 것은 fromMarkup뿐이다.
 *   parseRelational(string)은 밑줄이 없는 글로 읽는다({ text, underlines: [] }와 같다).
 *   parseMarkup(markup: string): ParseResult    parseRelational(fromMarkup(markup))과 같고, 위치(문제, 테이블, 컬럼, 외래키)는 markup 글 기준.
 *                                               API, CLI, MCP가 받은 글을 검사할 때 쓴다
 *   ResolvedForeignKey(schema.ts)의 실패 이유 'ref-count' | 'unknown-ref-column' | 'ref-not-primary-key' (refColumns 검사)
 *   새 메시지 키: rel.syntax.arrowNotSupported, underscoreKey, partialUnderline, underlineIgnored, foreignKeyBeforeTable,
 *     expectedForeignKeyColumns, expectedReferences, duplicateInList, rel.schema.unknownForeignKeyColumn, refColumnCount,
 *     unknownRefColumn, refNotPrimaryKey. 뺀 키: rel.syntax.groupNeedsArrow, unclosedPrimaryKey, rel.syntaxRule.*
 *   RELATIONAL_SYNTAX_RULES는 뺐다(쓰는 곳이 없었다). RELATIONAL_SYNTAX_EXAMPLE은 _이름_ 표기의 수업 표기 예시다
 */
