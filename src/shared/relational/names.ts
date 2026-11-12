/**
 * 테이블과 컬럼 이름을 다루는 작은 도우미. 파싱, 설정 저장, IE, SQL이 같은 규칙을 쓴다.
 *
 * 이름 비교 규칙(nameKey)
 *   유니코드 NFC로 맞추고, 연속된 공백(줄바꿈, 탭 포함)을 공백 하나로 줄이고, 앞뒤 공백을 뗀 뒤, 라틴 문자 등을 소문자로 바꾼다.
 *   그래서 'Student'와 'student', '"학생  번호"'와 '"학생 번호"'는 같은 이름이다.
 *   대소문자를 따지지 않는 까닭: MySQL은 컬럼 이름의 대소문자를 구별하지 않고 테이블 이름도 운영체제에 따라 구별하지 않는다.
 *   대소문자만 다른 두 이름을 허용하면 어떤 DBMS에서는 SQL이 실패하므로 같은 이름(중복)으로 본다.
 *   밑줄과 공백은 구별한다('학생_번호'와 '학생 번호'는 다른 이름이다). SQL에서도 다른 이름이기 때문이다.
 */
import { msg, type Message } from '../messages';

/** 화면에 보일 이름: 연속 공백을 공백 하나로, 앞뒤 공백은 뗀다 */
export function cleanName(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** 같은 이름인지 비교하는 형태. 위의 규칙을 따른다 */
export function nameKey(name: string): string {
  return cleanName(name).toLowerCase();
}

/** 메시지에 넣는 따옴표 붙은 이름 */
export function quotedName(name: string): Message {
  return msg('rules.name.quoted', { name });
}
