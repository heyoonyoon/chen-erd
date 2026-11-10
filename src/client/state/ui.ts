/**
 * 화면 상태(내 브라우저에만 있는 상태). 문서 내용은 여기 두지 않는다.
 * (CORE 파일) 자기 모듈만 쓰는 상태가 더 필요하면 이 파일을 고치지 말고 자기 파일에 따로 store를 만든다.
 */
import { create } from 'zustand';
import type { Guide, Point, Rect, Tool, Viewport } from '../../shared/types';

export interface ConnectDraft {
  /** 선을 끌기 시작한 노드 */
  sourceId: string;
  /** 현재 마우스 위치(월드 좌표) */
  to: Point;
  /** 마우스 아래에 있는 후보 노드 */
  targetId: string | null;
  /** 후보 노드와 연결할 수 있는지(rules.canConnect 결과) */
  valid: boolean;
  /** 이중선으로 만들지 */
  double: boolean;
}

export interface ContextMenuState {
  /** 메뉴를 띄울 화면 좌표(clientX, clientY) */
  x: number;
  y: number;
  /** 우클릭한 지점의 월드 좌표(붙여넣기 위치 등에 사용) */
  world: Point;
  /** 우클릭한 노드/엣지 id. 빈 곳이면 null */
  targetId: string | null;
}

export interface Panels {
  issues: boolean;
  legend: boolean;
  help: boolean;
  minimap: boolean;
}

export interface UiState {
  tool: Tool;
  /** true면 도형을 놓거나 선을 이은 뒤에도 도구가 select로 돌아가지 않는다 */
  toolLocked: boolean;
  viewport: Viewport;
  /** 캔버스 영역의 화면 크기(px). Canvas가 ResizeObserver로 갱신한다 */
  canvasSize: { w: number; h: number };
  /** 선택된 노드/엣지 id */
  selection: string[];
  hoveredId: string | null;
  /** 글자를 편집 중인 노드 id */
  editingId: string | null;
  connectDraft: ConnectDraft | null;
  /** 드래그 선택 상자(월드 좌표) */
  marquee: Rect | null;
  guides: Guide[];
  contextMenu: ContextMenuState | null;
  panels: Panels;
  showGrid: boolean;
  /** 이동할 때 다른 도형에 맞춰 붙는 기능 */
  snapEnabled: boolean;
  /** 검증 패널 등에서 잠깐 강조할 요소 id */
  highlightIds: string[];

  setTool(tool: Tool, locked?: boolean): void;
  setViewport(v: Viewport): void;
  setCanvasSize(size: { w: number; h: number }): void;
  setSelection(ids: string[]): void;
  toggleSelection(id: string): void;
  clearSelection(): void;
  setHovered(id: string | null): void;
  setEditing(id: string | null): void;
  setConnectDraft(d: ConnectDraft | null): void;
  setMarquee(r: Rect | null): void;
  setGuides(g: Guide[]): void;
  openContextMenu(m: ContextMenuState): void;
  closeContextMenu(): void;
  togglePanel(name: keyof Panels, open?: boolean): void;
  setShowGrid(v: boolean): void;
  setSnapEnabled(v: boolean): void;
  setHighlight(ids: string[]): void;
  /** 방을 옮길 때 초기화 */
  reset(): void;
}

const initial = {
  tool: 'select' as Tool,
  toolLocked: false,
  viewport: { x: 0, y: 0, zoom: 1 } as Viewport,
  canvasSize: { w: 0, h: 0 },
  selection: [] as string[],
  hoveredId: null as string | null,
  editingId: null as string | null,
  connectDraft: null as ConnectDraft | null,
  marquee: null as Rect | null,
  guides: [] as Guide[],
  contextMenu: null as ContextMenuState | null,
  panels: { issues: false, legend: false, help: false, minimap: true } as Panels,
  showGrid: true,
  snapEnabled: true,
  highlightIds: [] as string[],
};

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const useUi = create<UiState>((set, get) => ({
  ...initial,
  setTool: (tool, locked = false) => set({ tool, toolLocked: locked, connectDraft: null }),
  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => {
    const cur = get().canvasSize;
    if (cur.w !== canvasSize.w || cur.h !== canvasSize.h) set({ canvasSize });
  },
  setSelection: (ids) => {
    if (!sameIds(get().selection, ids)) set({ selection: ids });
  },
  toggleSelection: (id) => {
    const cur = get().selection;
    set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
  clearSelection: () => {
    if (get().selection.length > 0) set({ selection: [] });
  },
  setHovered: (hoveredId) => {
    if (get().hoveredId !== hoveredId) set({ hoveredId });
  },
  setEditing: (editingId) => set({ editingId }),
  setConnectDraft: (connectDraft) => set({ connectDraft }),
  setMarquee: (marquee) => set({ marquee }),
  setGuides: (guides) => {
    if (guides.length === 0 && get().guides.length === 0) return;
    set({ guides });
  },
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => {
    if (get().contextMenu) set({ contextMenu: null });
  },
  togglePanel: (name, open) => set((s) => ({ panels: { ...s.panels, [name]: open ?? !s.panels[name] } })),
  setShowGrid: (showGrid) => set({ showGrid }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setHighlight: (highlightIds) => set({ highlightIds }),
  reset: () => set({ ...initial, panels: { ...initial.panels } }),
}));

/** 컴포넌트 밖(이벤트 처리기 등)에서 현재 상태를 읽을 때 */
export const ui = (): UiState => useUi.getState();
