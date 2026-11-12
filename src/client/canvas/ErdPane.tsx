/**
 * ERD pane의 내용. 캔버스와 그 위에 떠 있는 패널(도구 팔레트, 속성 패널, 검증 패널, 표기법 안내,
 * 확대 버튼, 미니맵, 단축키 도움말)을 한데 묶는다. [담당: canvas 에이전트]
 *
 * 배치 틀(src/client/layout)이 이것을 data-pane="erd"가 붙은 pane 안에 놓는다. 이 요소는 놓인 컨테이너를
 * 꽉 채우고(position:absolute; inset:0), 떠 있는 패널은 모두 이 요소 안에서 자리를 잡는다(창 기준이 아니다).
 * 그래서 컨테이너는 position이 relative(또는 absolute 등)이고 크기가 정해져 있어야 한다.
 *
 * pane이 작으면(대략 640×460 아래) 미니맵을 접고 패널을 좁게 하며, 아주 작으면(420×340 아래) 확대 버튼 묶음의
 * 켜고 끄는 버튼을 숨긴다. 패널은 겹치지 않고 안에서 스크롤한다.
 *
 * 우클릭 메뉴(ContextMenu)와 이름 정하기 창(NicknameDialog)은 창 기준이라 여기에 넣지 않는다(방 화면이 한 번 그린다).
 * 키보드 단축키(useShortcuts)도 방 화면이 한 번 건다.
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useUi } from '../state/ui';
import { HelpOverlay } from '../ui/HelpOverlay';
import { Inspector } from '../ui/Inspector';
import { IssuesPanel } from '../ui/IssuesPanel';
import { Legend } from '../ui/Legend';
import { Toolbar } from '../ui/Toolbar';
import { Canvas } from './Canvas';
import { isEditableElement } from './shortcuts';
import { Minimap, ZoomControls } from './ViewportControls';
import './ErdPane.css';

export type ErdPaneSize = 'full' | 'compact' | 'tiny';

/** pane 크기에 따른 배치 단계. 크기를 아직 모르면(0, 숨겨짐) full로 본다 */
export function erdPaneSize(size: { w: number; h: number }): ErdPaneSize {
  const { w, h } = size;
  if (!(w > 0 && h > 0)) return 'full';
  if (w < 420 || h < 340) return 'tiny';
  if (w < 640 || h < 460) return 'compact';
  return 'full';
}

export function ErdPane() {
  const rootRef = useRef<HTMLDivElement>(null);
  const panels = useUi((s) => s.panels);
  const hasSelection = useUi((s) => s.selection.length > 0);
  const size = useUi((s) => erdPaneSize(s.canvasSize));
  // 작은 pane에서는 미니맵이 캔버스를 너무 많이 가린다. 켜 둔 설정은 그대로 두고 그리지만 않는다
  const showMinimap = panels.minimap && size === 'full';

  // pane 안의 빈 곳이나 패널을 눌러도 포커스를 이 pane으로 가져온다(다른 pane에 있던 포커스를 뺀다).
  // 캔버스 자체는 Canvas가, 입력창과 버튼은 브라우저가 스스로 포커스를 받는다.
  const takeFocus = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || isEditableElement(e.target)) return;
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    if (e.target instanceof Element && e.target.closest('.canvas-root')) return;
    root.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={rootRef}
      className="erd-pane"
      data-testid="erd-pane"
      data-size={size}
      data-minimap={showMinimap ? 'on' : 'off'}
      tabIndex={-1}
      onPointerDownCapture={takeFocus}
    >
      <Canvas />
      <div className="erd-slot erd-slot-left">
        <Toolbar />
      </div>
      <div className="erd-slot erd-slot-right">
        {hasSelection && <Inspector />}
        {panels.issues && <IssuesPanel />}
        {panels.legend && <Legend />}
      </div>
      <div className="erd-slot erd-slot-bottom-left">
        <ZoomControls />
      </div>
      <div className="erd-slot erd-slot-bottom-right">{showMinimap && <Minimap />}</div>
      {panels.help && <HelpOverlay />}
    </div>
  );
}
