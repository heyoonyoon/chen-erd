/**
 * 첫 화면의 제품 화면 예시. 실제 도형 렌더러와 도구 아이콘으로 방 화면을 축소해 그린다.
 * 장식용이라 조작은 받지 않는다.
 */
import { diagramBounds } from '../../shared/geometry';
import type { ErdEdge, ErdNode, PresetId } from '../../shared/types';
import { DiagramContent } from '../canvas/DiagramContent';
import { PresetIcon } from '../canvas/PresetIcon';

const NODES: ErdNode[] = [
  { id: 'stu', kind: 'entity', x: 60, y: 150, w: 120, h: 56, text: '학생' },
  { id: 'sid', kind: 'attribute', x: 6, y: 40, w: 100, h: 46, text: '학번', keyType: 'key' },
  { id: 'snm', kind: 'attribute', x: 134, y: 40, w: 100, h: 46, text: '이름' },
  { id: 'take', kind: 'relationship', x: 250, y: 138, w: 130, h: 80, text: '수강' },
  { id: 'crs', kind: 'entity', x: 450, y: 150, w: 120, h: 56, text: '과목' },
  { id: 'cid', kind: 'attribute', x: 392, y: 40, w: 112, h: 46, text: '과목코드', keyType: 'key' },
  { id: 'crd', kind: 'attribute', x: 530, y: 40, w: 92, h: 46, text: '학점' },
  { id: 'sp', kind: 'spec', x: 103, y: 258, w: 34, h: 34, text: '', specType: 'd' },
  { id: 'ug', kind: 'entity', x: 6, y: 344, w: 104, h: 50, text: '학부생' },
  { id: 'gr', kind: 'entity', x: 130, y: 344, w: 104, h: 50, text: '대학원생' },
  { id: 'open', kind: 'relationship', x: 440, y: 240, w: 140, h: 76, text: '개설', identifying: true },
  { id: 'sec', kind: 'entity', x: 445, y: 350, w: 130, h: 60, text: '분반', weak: true },
  { id: 'sno', kind: 'attribute', x: 300, y: 357, w: 104, h: 46, text: '분반번호', keyType: 'partial' },
];

const edge = (id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge => ({
  id,
  source,
  target,
  double: false,
  label: '',
  role: '',
  ...extra,
});

const EDGES: ErdEdge[] = [
  edge('a1', 'stu', 'sid'),
  edge('a2', 'stu', 'snm'),
  edge('a3', 'crs', 'cid'),
  edge('a4', 'crs', 'crd'),
  edge('a5', 'sec', 'sno'),
  edge('r1', 'stu', 'take', { label: 'M' }),
  edge('r2', 'take', 'crs', { label: 'N' }),
  edge('r3', 'crs', 'open', { label: '1' }),
  edge('r4', 'open', 'sec', { label: 'N', double: true }),
  edge('s1', 'stu', 'sp', { double: true }),
  edge('s2', 'sp', 'ug'),
  edge('s3', 'sp', 'gr'),
];

/** 예시 화면에 함께 들어와 있는 팀원 */
const MATES = [
  { name: '지민', color: '#E5484D' },
  { name: '서연', color: '#12A594' },
  { name: '도윤', color: '#8E4EC6' },
];

const TOOLS: PresetId[] = [
  'entity',
  'weak-entity',
  'relationship',
  'identifying-relationship',
  'attribute',
  'key-attribute',
  'multivalued-attribute',
  'derived-attribute',
  'spec-d',
];

/** 이름표가 달린 포인터. 이 제품의 표식이라 첫 화면에서는 여기와 내 프로필에서만 쓴다 */
export function NamedCursor({ name, color, className, style }: { name: string; color: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className ? `home-cursor ${className}` : 'home-cursor'} style={style} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 20 20">
        <path d="M3 2l5.2 14.2 2.3-5.9 5.9-2.3z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="home-cursor-name" style={{ background: color }}>
        {name}
      </span>
    </span>
  );
}

export function HomePreview() {
  const b = diagramBounds(NODES, 28) ?? { x: 0, y: 0, w: 640, h: 400 };
  const picked = NODES.find((n) => n.id === 'take')!;
  return (
    <figure className="home-pv" aria-label="제품 화면 예시">
      <div className="home-pv-top" aria-hidden="true">
        <span className="home-pv-title">수강 관리</span>
        <span className="home-pv-saved">저장됨</span>
        <span className="home-pv-mates">
          {MATES.map((m) => (
            <b key={m.name} style={{ background: m.color }}>
              {m.name.slice(0, 1)}
            </b>
          ))}
        </span>
        <span className="home-pv-share">공유</span>
      </div>
      <div className="home-pv-body">
        <div className="home-pv-tools" aria-hidden="true">
          <span className="home-pv-tool is-active">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M5 3l4.6 12 1.9-5 5-1.9z" />
            </svg>
          </span>
          {TOOLS.map((id) => (
            <span key={id} className="home-pv-tool">
              <PresetIcon presetId={id} size={18} />
            </span>
          ))}
        </div>
        <div className="home-pv-canvas">
          <div className="home-pv-stage">
          <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} role="img" aria-label="학생과 과목, 분반으로 이루어진 예시 ER 다이어그램">
            <DiagramContent nodes={NODES} edges={EDGES} />
            {/* 다른 팀원이 선택한 도형 */}
            <rect
              x={picked.x - 5}
              y={picked.y - 5}
              width={picked.w + 10}
              height={picked.h + 10}
              rx="3"
              fill="none"
              stroke={MATES[0].color}
              strokeWidth="1.6"
              pointerEvents="none"
            />
          </svg>
          <NamedCursor name={MATES[0].name} color={MATES[0].color} style={{ left: '50%', top: '53%' }} />
          <NamedCursor name={MATES[1].name} color={MATES[1].color} style={{ left: '35%', top: '62%' }} />
          </div>
        </div>
      </div>
    </figure>
  );
}
