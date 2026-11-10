/**
 * 캔버스만 쓰는 화면 상태. 공용 ui store에 없는 것(진행 중인 조작 종류, 스페이스 키 등)을 둔다. [담당: canvas 에이전트]
 */
import { create } from 'zustand';
import type { Point } from '../../../shared/types';
import type { Handle } from './logic';

/** 포인터 하나로 진행 중인 조작. 한 번에 하나만 활성화된다. */
export type Mode = 'idle' | 'pan' | 'move' | 'resize' | 'connect' | 'marquee';

export interface CanvasLocalState {
  mode: Mode;
  /** 크기 조절 중인 손잡이(커서 모양에 쓴다) */
  activeHandle: Handle | null;
  /** 스페이스를 누르고 있는지(누른 채 끌면 화면 이동) */
  spaceHeld: boolean;
  /** 도형 놓기 도구에서 미리보기를 그릴 위치(월드 좌표). 마우스가 캔버스 밖이면 null */
  placePos: Point | null;
  /** 연결할 수 없는 이유(말풍선에 표시) */
  connectReason: string | null;
  /** 마우스를 올려 연결 점을 띄우고 있는 노드 */
  hostId: string | null;
}

const initial: CanvasLocalState = {
  mode: 'idle',
  activeHandle: null,
  spaceHeld: false,
  placePos: null,
  connectReason: null,
  hostId: null,
};

export const useCanvasLocal = create<CanvasLocalState>(() => ({ ...initial }));

export const canvasLocal = (): CanvasLocalState => useCanvasLocal.getState();

/** 값이 실제로 바뀔 때만 갱신한다. */
export function setCanvasLocal(patch: Partial<CanvasLocalState>): void {
  const cur = useCanvasLocal.getState();
  for (const k of Object.keys(patch) as Array<keyof CanvasLocalState>) {
    if (cur[k] !== patch[k]) {
      useCanvasLocal.setState(patch);
      return;
    }
  }
}

export function resetCanvasLocal(): void {
  useCanvasLocal.setState({ ...initial });
}
