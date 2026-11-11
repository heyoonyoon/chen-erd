/**
 * 논리 모델 층. 다이어그램을 좌표 없는 글로 읽고 쓰는 데 필요한 것을 한곳에서 내보낸다.
 * (CLI, 서버 API, 클라이언트가 함께 쓴다. DOM과 Node API를 쓰지 않는다.)
 */
export * from './types';
export { parseModel, printModel, normalizeModel } from './text';
export { extractModel, diagramToText } from './extract';
export { applyModel, isEmptyChange } from './apply';
