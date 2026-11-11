/**
 * 'modelll syntax'가 보여 주는 텍스트 형식 안내. AI 에이전트가 이 글만 읽고 모델을 쓰므로
 * 파서(src/shared/model)와 어긋나면 안 된다. 아래 예시는 테스트에서 실제 파서로 읽어 본다.
 */

/** 형식 전체를 한 번씩 쓰는 예시 */
export const SYNTAX_EXAMPLE = `title "Company"

entity Employee {
  id key                       # key attribute (underlined)
  name { first, last }         # composite attribute
  phone multi                  # multivalued attribute
}
entity Department { code key, name }
entity Secretary { typing_speed }
entity Engineer { field }
weak entity Dependent { name partial }      # partial key of a weak entity

relationship works_in (Employee N total, Department 1) { since }
relationship manages (Employee 1 as boss, Employee N as report)
identifying relationship has (Employee 1, Dependent N total)

specialization Employee disjoint total { Secretary, Engineer }

note "Draft"
`;

export const SYNTAX_TEXT = `modelll model text: a Chen-notation ER diagram without positions. One statement per line.

STATEMENTS
  title "<text>"
  entity <name> { <attributes> }
  weak entity <name> { <attributes> }
  relationship <name> (<participant>, <participant>, ...) { <attributes> }
  identifying relationship <name> (<participant>, ...) { <attributes> }
  specialization <supertype> disjoint|overlap [total] { <subtype>, <subtype>, ... }
  note "<text>"
  A { } or ( ) block may span several lines. In a specialization, disjoint and overlap are the
  d and o circles, and total is total specialization (double line to the supertype).

ATTRIBUTES   separated by commas or newlines; leave out the { } block when there are none
  <name>                  plain attribute
  <name> key              key attribute (underlined)
  <name> partial          partial key of a weak entity (dashed underline)
  <name> multi            multivalued attribute (double ellipse)
  <name> { <a>, <b> }     composite attribute with sub-attributes

PARTICIPANTS   <entity> [<cardinality>] [total] [as <role>]
  cardinality             1, M or N
  total                   total participation (double line)
  as <role>               role name; list the same entity twice for a recursive relationship

NAMES AND COMMENTS
  A name is written as is when it has no spaces and none of { } ( ) , " #  (any language works).
  Otherwise put it in double quotes: entity "Order item" { "unit price" }   (escapes: \\" \\\\ \\n)
  # starts a comment that runs to the end of the line.
  Entities are referred to by name: every entity used in a relationship or specialization must be
  declared with "entity" (in any order), and entity names must be unique.

EXAMPLE
${SYNTAX_EXAMPLE
  .trimEnd()
  .split('\n')
  .map((line) => (line ? `  ${line}` : ''))
  .join('\n')}

WORKFLOW
  modelll validate model.mdl          check the file locally
  modelll new model.mdl               create a room and print its URL
  modelll pull <room> -o model.mdl    get the current diagram, edit the file, then
  modelll push <room> model.mdl       update the room; open browsers see it live
`;
