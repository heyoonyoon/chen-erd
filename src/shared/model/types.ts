/**
 * 논리 모델. 좌표와 도형 크기를 뺀 ERD의 내용만 담는다.
 * CLI와 API가 주고받는 텍스트는 이 모델을 글로 적은 것이고, 다이어그램(노드와 엣지)과는 extract와 apply로 오간다.
 * (계약 파일: 모델 쪽과 서버, CLI 쪽이 이 정의를 함께 쓴다.)
 */
import type { ErdEdge, ErdNode } from '../types';

export interface ModelAttribute {
  name: string;
  /** key = 식별자(밑줄), partial = 부분 키(점선 밑줄) */
  key?: 'key' | 'partial';
  /** 다중값 속성(이중 타원) */
  multivalued?: boolean;
  /** 복합 속성의 하위 속성 */
  parts?: ModelAttribute[];
}

export interface ModelEntity {
  name: string;
  /** 약한 엔티티 */
  weak?: boolean;
  attributes: ModelAttribute[];
}

export interface ModelParticipant {
  /** 엔티티 이름 */
  entity: string;
  /** 카디널리티 글자. 없으면 '' */
  cardinality: string;
  /** 전체 참여(이중선) */
  total?: boolean;
  /** 역할 이름. 없으면 생략 */
  role?: string;
}

export interface ModelRelationship {
  name: string;
  /** 식별 관계(이중 마름모) */
  identifying?: boolean;
  /** 같은 엔티티가 두 번 나오면 재귀 관계다(최대 두 번) */
  participants: ModelParticipant[];
  attributes: ModelAttribute[];
}

export interface ModelSpecialization {
  /** 슈퍼타입 엔티티 이름 */
  parent: string;
  /** d = disjoint, o = overlap */
  kind: 'd' | 'o';
  /** 전체 특수화(슈퍼타입 쪽 이중선) */
  total?: boolean;
  /** 서브타입 엔티티 이름 */
  children: string[];
}

export interface Model {
  /** 없으면 다이어그램의 제목을 건드리지 않는다 */
  title?: string;
  entities: ModelEntity[];
  relationships: ModelRelationship[];
  specializations: ModelSpecialization[];
  /** 메모의 글자 */
  notes: string[];
}

/** 텍스트를 모델로 읽지 못했을 때. line과 column은 1부터 센다 */
export class ModelSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'ModelSyntaxError';
    this.line = line;
    this.column = column;
  }
}

/** 다이어그램에 가할 변경. 한 번의 트랜잭션으로 적용한다 */
export interface DiagramChange {
  addNodes: ErdNode[];
  /** 값이 undefined인 키는 지운다(플래그 끄기) */
  patchNodes: Array<{ id: string; patch: Partial<Omit<ErdNode, 'id'>> }>;
  removeNodeIds: string[];
  addEdges: ErdEdge[];
  patchEdges: Array<{ id: string; patch: Partial<Omit<ErdEdge, 'id'>> }>;
  removeEdgeIds: string[];
  /** 있으면 제목을 이 값으로 바꾼다 */
  title?: string;
}

export interface ApplyOptions {
  /** true면 남아 있는 도형의 위치도 버리고 전체를 다시 배치한다 */
  relayout?: boolean;
  /** 새 도형과 선의 id를 만드는 함수. 기본은 nanoid(10) */
  newId?: () => string;
}

export interface ApplyResult {
  change: DiagramChange;
  /** 변경을 적용한 뒤의 전체 노드와 엣지 */
  nodes: ErdNode[];
  edges: ErdEdge[];
  /** 도형과 선을 합친 개수 */
  summary: { added: number; updated: number; removed: number };
  /** 모델대로 그리지 못한 부분에 대한 설명(영어 문장) */
  warnings: string[];
}

export interface ExtractResult {
  model: Model;
  /** 모델로 나타내지 못해 빠진 도형 수(어디에도 붙지 않은 속성 등). push는 이 도형들을 건드리지 않는다 */
  skipped: number;
}

/*
 * src/shared/model/index.ts 가 내보내는 함수(모델 쪽이 구현한다)
 *
 *   parseModel(text: string): Model                          읽지 못하면 ModelSyntaxError
 *   printModel(model: Model): string                         parseModel(printModel(m))은 m과 같다
 *   extractModel(nodes: ErdNode[], edges: ErdEdge[], title?: string): ExtractResult
 *   diagramToText(nodes: ErdNode[], edges: ErdEdge[], title?: string): string
 *                                                            extractModel + printModel. 빠진 도형이 있으면 끝에 주석 한 줄
 *   applyModel(model: Model, nodes: ErdNode[], edges: ErdEdge[], currentTitle: string, opts?: ApplyOptions): ApplyResult
 *   isEmptyChange(change: DiagramChange): boolean
 */
