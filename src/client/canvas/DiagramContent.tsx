/**
 * 노드와 엣지 전체를 장식(선택, 격자) 없이 그린다. PNG/SVG 내보내기와 미니맵에서 쓴다. (CORE 파일)
 */
import { computeEdgeGeometry, siblingInfo } from '../../shared/geometry';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { EdgeShape } from './EdgeShape';
import { NodeShape } from './NodeShape';

export function DiagramContent({ nodes, edges }: { nodes: ErdNode[]; edges: ErdEdge[] }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const siblings = siblingInfo(edges);
  return (
    <g>
      {edges.map((e) => {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) return null;
        const sib = siblings.get(e.id) ?? { index: 0, count: 1, pair: 1 };
        return <EdgeShape key={e.id} edge={e} geometry={computeEdgeGeometry(e, s, t, sib.index, sib.count, sib.pair)} />;
      })}
      {nodes.map((n) => (
        <NodeShape key={n.id} node={n} />
      ))}
    </g>
  );
}
