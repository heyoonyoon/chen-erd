/**
 * 테스트와 배치 점검에 쓰는 예제 모델(텍스트 형식). 제품 코드에서는 쓰지 않는다.
 */
import { normalizeModel } from './text';
import type { Model, ModelAttribute } from './types';

/** 엔티티 10개, 도형 60개 이상. 3항 관계, 재귀 관계, 같은 쌍의 관계 둘, 서브타입 셋, 복합 속성, 떨어진 덩어리, 외딴 엔티티 */
export const UNIVERSITY = `
title "수강신청"

entity 학생 {
  학번 key
  이름 { 성, 이름 }
  전화번호 multi
  생년월일
  주소 { 시, 구, 상세 { 도로명, 건물번호 } }
}
entity 과목 {
  과목코드 key
  과목명
  학점
}
entity 교수 {
  교수번호 key
  이름
  연구실
  직급
}
entity 학과 {
  학과코드 key
  학과명
  위치
}
entity 강의실 {
  호실 key
  건물
  수용인원
}
entity 학기 {
  연도 key
  구분 key
}
weak entity 분반 {
  분반번호 partial
  정원
}
entity 직원 {
  사번 key
  이름
  입사일
}
entity 조교 { 담당업무 }
entity 행정직원 { 부서 }
entity 계약직 { 계약만료일 }
entity 동아리 {
  동아리명 key
  설립연도
}
entity 장학금 {
  장학금명 key
  금액
}
entity 공지 {
  번호 key
  제목
  내용
}

relationship 수강 (학생 M total, 분반 N) { 성적 }
identifying relationship 개설 (과목 1, 분반 N total)
relationship 담당 (교수 1, 분반 N total)
relationship 소속 (학생 N total, 학과 1)
relationship 재직 (교수 N total, 학과 1)
relationship 학과장 (교수 1, 학과 1) { 취임일 }
relationship 선수과목 (과목 M as 선수, 과목 N as 후수)
relationship 배정 (분반 N, 강의실 1, 학기 1) { 요일, 교시 }
relationship 가입 (학생 M, 동아리 N) { 가입일 }
relationship 수혜 (학생 N, 장학금 M)

specialization 직원 disjoint total { 조교, 행정직원, 계약직 }

note "초안: 학사팀 검토 필요"
`;

/** Elmasri의 COMPANY 예제 */
export const COMPANY = `
title COMPANY

entity EMPLOYEE {
  Ssn key
  Name { Fname, Minit, Lname }
  Bdate
  Address
  Salary
  Sex
}
entity DEPARTMENT {
  Number key
  Name key
  Locations multi
}
entity PROJECT {
  Number key
  Name key
  Location
}
weak entity DEPENDENT {
  Name partial
  Sex
  Birth_date
  Relationship
}

relationship WORKS_FOR (EMPLOYEE N total, DEPARTMENT 1 total)
relationship MANAGES (EMPLOYEE 1, DEPARTMENT 1 total) { Start_date }
relationship CONTROLS (DEPARTMENT 1, PROJECT N total)
relationship WORKS_ON (EMPLOYEE M total, PROJECT N total) { Hours }
relationship SUPERVISION (EMPLOYEE 1 as supervisor, EMPLOYEE N as supervisee)
identifying relationship DEPENDENTS_OF (EMPLOYEE 1, DEPENDENT N total)
`;

/** 작은 그림: 겹치는 특수화와 관계 하나 */
export const SMALL = `
entity 회원 { 회원번호 key, 이름, 이메일 multi }
entity 주문 { 주문번호 key, 주문일 }
entity 일반회원 { 적립금 }
entity 사업자회원 { 사업자번호 }
relationship 주문함 (회원 1, 주문 N total)
specialization 회원 overlap { 일반회원, 사업자회원 }
`;

/** 긴 사슬과 허브(연결이 많은 엔티티) */
export const SHOP = `
entity Customer { id key, name, email, phone multi, address { street, city, zip } }
entity Order { order_no key, placed_at, status }
entity OrderLine { line_no key, quantity, unit_price }
entity Product { sku key, title, price, weight }
entity Category { code key, label }
entity Supplier { supplier_id key, company, country }
entity Warehouse { wh_code key, city }
entity Shipment { tracking_no key, shipped_at }
entity Carrier { carrier_id key, name }
entity Review { review_id key, rating, body }
entity Coupon { code key, percent_off }
relationship places (Customer 1, Order N total)
relationship contains (Order 1, OrderLine N total)
relationship of (OrderLine N total, Product 1)
relationship in (Product N, Category M)
relationship supplies (Supplier M, Product N) { lead_days }
relationship stocks (Warehouse M, Product N) { on_hand }
relationship ships (Order 1, Shipment N total)
relationship carries (Carrier 1, Shipment N)
relationship writes (Customer 1, Review N total)
relationship about (Review N total, Product 1)
relationship redeems (Order N, Coupon 1)
relationship parent (Category 1 as parent, Category N as child)
`;


/**
 * 순서만 다른 두 모델을 같게 보도록 정렬한 모양.
 * 엔티티, 관계, 참여자, 서브타입, 메모의 순서는 화면 위치에서 나오므로 배치를 거치면 달라질 수 있다.
 * 속성의 순서는 전체 배치가 지켜 주므로 그대로 둔다. 부분 배치(새 속성을 빈자리에 끼워 넣는다)를 거친 모델은
 * sortAttributes를 켜서 속성도 정렬해 비교한다.
 */
export function canonicalModel(model: Model, opts: { sortAttributes?: boolean } = {}): Model {
  const m = normalizeModel(model);
  const key = (value: unknown) => JSON.stringify(value);
  const byKey = <T>(list: T[]): T[] => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const attrs = (list: ModelAttribute[]): ModelAttribute[] => {
    if (!opts.sortAttributes) return list;
    return byKey(list.map((a) => (a.parts ? { ...a, parts: attrs(a.parts) } : a)));
  };
  return {
    ...m,
    entities: byKey(m.entities.map((e) => ({ ...e, attributes: attrs(e.attributes) }))),
    relationships: byKey(m.relationships.map((r) => ({ ...r, participants: byKey(r.participants), attributes: attrs(r.attributes) }))),
    specializations: byKey(m.specializations.map((s) => ({ ...s, children: [...s.children].sort() }))),
    notes: [...m.notes].sort(),
  };
}
