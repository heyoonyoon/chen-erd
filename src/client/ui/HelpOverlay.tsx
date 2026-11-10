/**
 * 단축키 도움말 창. ui.panels.help가 true일 때 렌더링된다. [담당: shortcuts 에이전트]
 *
 * Esc로 닫는 것은 전역 단축키(useShortcuts의 Esc 순서 마지막)가 맡는다. 여기서 따로 받으면 Esc 한 번에 두 가지가 처리된다.
 */
import { useEffect, useRef } from 'react';
import { SHORTCUT_LIST, type ShortcutInfo } from '../canvas/shortcuts';
import { ui } from '../state/ui';
import './HelpOverlay.css';

/** 2단으로 나눠 놓는 묶음 순서(양쪽 길이가 비슷하도록) */
const COLUMNS: string[][] = [
  ['도구', '화면'],
  ['편집', '기타'],
];

const MOUSE_TIPS = [
  '도형에 마우스를 올리면 뜨는 연결 점에서 다른 도형으로 끌면 선이 이어집니다.',
  '연결 점에서 끌어 빈 곳에 놓으면 그 자리에 속성이 추가됩니다.',
  '스페이스를 누른 채 끌면 화면이 이동합니다.',
  '도구 버튼을 더블클릭하면 도구가 잠겨 도형을 계속 놓을 수 있습니다.',
  '선을 더블클릭하면 카디널리티가 바뀝니다.',
];

function close(): void {
  ui().togglePanel('help', false);
}

function ShortcutTable({ group, items }: { group: string; items: ShortcutInfo[] }) {
  return (
    <section className="helpoverlay-group">
      <h3 className="helpoverlay-group-title">{group}</h3>
      <table className="helpoverlay-table">
        <tbody>
          {items.map((s, i) => (
            <tr key={i}>
              <th scope="row">{s.description}</th>
              <td>
                {s.keys.map((k, j) => (
                  <kbd key={j} className="kbd">
                    {k}
                  </kbd>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function HelpOverlay() {
  const panelRef = useRef<HTMLDivElement>(null);

  // 열릴 때 창으로 포커스를 옮기고, 닫히면 원래 있던 곳으로 돌려준다
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (prev && prev !== document.body && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);

  // COLUMNS에 없는 묶음이 생기면 오른쪽 단 끝에 붙인다
  const known = new Set(COLUMNS.flat());
  const extra = Array.from(new Set(SHORTCUT_LIST.map((s) => s.group))).filter((g) => !known.has(g));
  const columns = [COLUMNS[0], [...COLUMNS[1], ...extra]];

  return (
    <div
      className="helpoverlay-backdrop"
      data-testid="help-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={panelRef} className="helpoverlay panel" role="dialog" aria-modal="true" aria-labelledby="helpoverlay-title" tabIndex={-1}>
        <header className="helpoverlay-header">
          <h2 id="helpoverlay-title" className="helpoverlay-title">
            단축키
          </h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="닫기" title="닫기" data-testid="help-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </header>

        <div className="helpoverlay-body">
          <div className="helpoverlay-columns">
            {columns.map((groups, i) => (
              <div key={i} className="helpoverlay-column">
                {groups.map((group) => {
                  const items = SHORTCUT_LIST.filter((s) => s.group === group);
                  return items.length > 0 ? <ShortcutTable key={group} group={group} items={items} /> : null;
                })}
              </div>
            ))}
          </div>

          <section className="helpoverlay-mouse">
            <h3 className="helpoverlay-group-title">마우스</h3>
            <ul className="helpoverlay-tips">
              {MOUSE_TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
