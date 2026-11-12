/**
 * 화면에 보일 문장을 "키와 값"으로 나타내는 형식. 공용 코드(rules 등)는 문장을 직접 만들지 않고
 * 이 형식으로 돌려주고, 클라이언트가 보여 줄 때 현재 언어로 바꾼다(src/client/i18n).
 * 서버는 이 값을 화면에 쓰지 않는다.
 */

/** 문장에 끼워 넣는 값. 문장 안에 다른 문장을 넣거나, 여러 문장을 쉼표로 이어 넣을 수 있다. */
export type MessageParam = string | number | Message | readonly Message[];

export interface Message<K extends string = string> {
  /** 언어 사전의 키 */
  key: K;
  /** 문장의 {이름} 자리에 들어갈 값 */
  params?: Record<string, MessageParam>;
}

/** 메시지에서 도형을 부르는 말의 종류 */
export type NodeNounId = 'entity' | 'weakEntity' | 'relationship' | 'identifyingRelationship' | 'attribute' | 'note';

/** 연결할 수 없는 이유 */
export type ConnectReasonKey =
  | 'connect.note'
  | 'connect.specSpec'
  | 'connect.specRelationship'
  | 'connect.specAttribute'
  | 'connect.entityEntity'
  | 'connect.relationshipRelationship'
  | 'connect.self'
  | 'connect.pairLimit'
  | 'connect.alreadyConnected'
  | 'connect.sameComposite'
  | 'connect.bothOwned'
  | 'connect.attributeOwned'
  | 'connect.attributeInComposite';

/** 검증 결과의 설명 */
export type IssueMessageKey =
  | 'issue.edgeDangling'
  | 'issue.edgeDanglingBoth'
  | 'issue.edgeSelf'
  | 'issue.edgeInvalid'
  | 'issue.edgeDuplicate'
  | 'issue.edgeDuplicateRecursive'
  | 'issue.attributeUnconnected'
  | 'issue.attributeUnowned'
  | 'issue.attributeMultiOwner'
  | 'issue.attributeGroupMultiOwner'
  | 'issue.attributeCycle'
  | 'issue.specDegree'
  | `issue.emptyName.${Exclude<NodeNounId, 'note'>}`
  | 'issue.weakNoIdentifying'
  | 'issue.weakParticipation'
  | 'issue.weakNoPartialKey'
  | 'issue.entityNoKey'
  | 'issue.entityIsolated'
  | 'issue.edgeNoCardinality'
  | 'issue.relationshipDegree'
  | 'issue.identifyingNoWeak'
  | 'issue.attributeKeyConflict'
  | 'issue.duplicateEntityName';

/** 메시지 안에서 도형과 이름을 부르는 조각 */
export type RuleFragmentKey =
  | `rules.node.${NodeNounId}.named`
  | `rules.node.${NodeNounId}.unnamed`
  | 'rules.node.spec'
  | 'rules.name.quoted'
  | 'rules.name.unnamed'
  | 'rules.names.more'
  | 'rules.keyWord.key'
  | 'rules.keyWord.partial';

/** 사람이 적은 관계 모델 글(shared/relational)의 문법 오류와 내용 문제 */
export type RelationalMessageKey =
  | 'rel.syntax.expectedTableName'
  | 'rel.syntax.expectedOpenParen'
  | 'rel.syntax.expectedColumn'
  | 'rel.syntax.expectedCommaOrClose'
  | 'rel.syntax.expectedRefTable'
  | 'rel.syntax.unterminatedString'
  | 'rel.syntax.extraAfterTable'
  | 'rel.syntax.unclosedParen'
  | 'rel.syntax.emptyName'
  | 'rel.syntax.duplicateTable'
  | 'rel.syntax.duplicateColumn'
  | 'rel.syntax.arrowNotSupported'
  | 'rel.syntax.underscoreKey'
  | 'rel.syntax.partialUnderline'
  | 'rel.syntax.underlineIgnored'
  | 'rel.syntax.foreignKeyBeforeTable'
  | 'rel.syntax.expectedForeignKeyColumns'
  | 'rel.syntax.expectedReferences'
  | 'rel.syntax.duplicateInList'
  | 'rel.schema.unknownTable'
  | 'rel.schema.foreignKeyArity'
  | 'rel.schema.refNoPrimaryKey'
  | 'rel.schema.noPrimaryKey'
  | 'rel.schema.unknownForeignKeyColumn'
  | 'rel.schema.refColumnCount'
  | 'rel.schema.unknownRefColumn'
  | 'rel.schema.refNotPrimaryKey';

/** 공용 코드가 쓰는 모든 키. 클라이언트의 한국어 사전에 빠짐없이 있어야 한다(i18n/index.ts에서 컴파일 때 검사). */
export type SharedMessageKey = ConnectReasonKey | IssueMessageKey | RuleFragmentKey | RelationalMessageKey;

export type SharedMessage = Message<SharedMessageKey>;

export function msg<K extends string>(key: K, params?: Record<string, MessageParam>): Message<K> {
  return params ? { key, params } : { key };
}
