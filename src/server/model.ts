/**
 * 모델을 방에 쓰는 부분. 모델 API(http.ts)와 MCP(mcp.ts)가 같은 크기 제한과 같은 방식으로 쓰도록 한곳에 둔다.
 */
import type * as Y from 'yjs';
import { applyModel, isEmptyChange } from '../shared/model';
import type { Model, ModelAttribute } from '../shared/model/types';
import { validateDiagram } from '../shared/rules';
import type { Issue } from '../shared/types';
import { applyChange, getEdges, getNodes, getTitle } from '../shared/ydoc';

/** 모델 텍스트로 받는 본문의 최대 크기 */
export const MAX_MODEL_BYTES = 256 * 1024;
/** 이보다 도형이 많아지는 쓰기는 받지 않는다 */
export const MAX_NODES = 3000;

/** 방의 문서로 동기 함수를 실행한다(SyncHub.withDoc) */
export type WithDoc = <T>(roomId: string, fn: (doc: Y.Doc, save: () => void) => T) => Promise<T>;

export interface WriteOutcome {
  summary: { added: number; updated: number; removed: number };
  warnings: string[];
  issues: Issue[];
}

function countAttributes(attributes: ModelAttribute[]): number {
  let count = 0;
  for (const a of attributes) count += 1 + countAttributes(a.parts ?? []);
  return count;
}

/** 모델을 그리면 생길 도형 수. 배치를 계산하기 전에 너무 큰 모델을 걸러 내는 데 쓴다 */
export function modelNodeCount(model: Model): number {
  let count = model.entities.length + model.relationships.length + model.specializations.length + model.notes.length;
  for (const e of model.entities) count += countAttributes(e.attributes);
  for (const r of model.relationships) count += countAttributes(r.attributes);
  return count;
}

/**
 * 방을 모델의 내용으로 맞춘다. 도형이 MAX_NODES보다 많아지면 아무것도 바꾸지 않고 null을 돌려준다.
 * created는 이 쓰기로 방이 새로 생기는 경우다.
 */
export function writeModel(
  withDoc: WithDoc,
  roomId: string,
  model: Model,
  opts: { relayout: boolean; created: boolean },
): Promise<WriteOutcome | null> {
  return withDoc(roomId, (doc, save) => {
    const result = applyModel(model, getNodes(doc), getEdges(doc), getTitle(doc), { relayout: opts.relayout });
    // 모델에 없어서 그대로 남는 도형까지 합친 수로 다시 본다
    if (result.nodes.length > MAX_NODES) return null;
    if (!isEmptyChange(result.change)) applyChange(doc, result.change, 'api');
    // 내용이 없는 모델로 새 방을 만들면 문서가 바뀌지 않는다. 그래도 방이 남도록 저장한다
    else if (opts.created) save();
    return { summary: result.summary, warnings: result.warnings, issues: validateDiagram(result.nodes, result.edges) };
  });
}
