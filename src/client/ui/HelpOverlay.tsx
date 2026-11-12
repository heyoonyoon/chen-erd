/**
 * 단축키 도움말 창. ui.panels.help가 true일 때 렌더링된다. [담당: shortcuts 에이전트]
 *
 * Esc로 닫는 것은 전역 단축키(useShortcuts의 Esc 순서 마지막)가 맡는다. 여기서 따로 받으면 Esc 한 번에 두 가지가 처리된다.
 */
import { useEffect, useRef, useState } from 'react';
import { SHORTCUT_LIST, type ShortcutGroup, type ShortcutInfo } from '../canvas/shortcuts';
import { useT, type MessageKey } from '../i18n';
import { ui } from '../state/ui';
import { LegendSections } from './Legend';
import './HelpOverlay.css';

/** 2단으로 나눠 놓는 묶음 순서(양쪽 길이가 비슷하도록) */
const COLUMNS: ShortcutGroup[][] = [
  ['tools', 'view'],
  ['edit', 'misc'],
];

const MOUSE_TIPS: MessageKey[] = ['help.tip.connect', 'help.tip.attribute', 'help.tip.pan', 'help.tip.lock', 'help.tip.cardinality'];

function close(): void {
  ui().togglePanel('help', false);
}

function ShortcutTable({ group, items }: { group: ShortcutGroup; items: ShortcutInfo[] }) {
  const t = useT();
  return (
    <section className="helpoverlay-group">
      <h3 className="helpoverlay-group-title">{t(`help.group.${group}`)}</h3>
      <table className="helpoverlay-table">
        <tbody>
          {items.map((s, i) => (
            <tr key={i}>
              <th scope="row">{t(s.description)}</th>
              <td>
                {s.keys.map((k, j) => (
                  <kbd key={j} className="kbd">
                    {typeof k === 'string' ? k : t(k.label)}
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
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'shortcuts' | 'notation'>('shortcuts');

  // 열릴 때 창으로 포커스를 옮기고, 닫히면 원래 있던 곳으로 돌려준다
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (prev && prev !== document.body && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);

  // COLUMNS에 없는 묶음이 생기면 오른쪽 단 끝에 붙인다
  const known = new Set<ShortcutGroup>(COLUMNS.flat());
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
          <h2 id="helpoverlay-title" className="helpoverlay-sr">
            {tab === 'shortcuts' ? t('help.title') : t('legend.title')}
          </h2>
          <div className="helpoverlay-tabs" role="tablist">
            {(['shortcuts', 'notation'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`helpoverlay-tab${tab === id ? ' is-active' : ''}`}
                data-testid={`help-tab-${id}`}
                onClick={() => setTab(id)}
              >
                {id === 'shortcuts' ? t('help.title') : t('legend.title')}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t('common.close')} title={t('common.close')} data-testid="help-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </header>

        <div className="helpoverlay-body" hidden={tab !== 'notation'} data-testid="help-notation">
          <div className="helpoverlay-legend">
            <LegendSections />
          </div>
        </div>
        <div className="helpoverlay-body" hidden={tab !== 'shortcuts'}>
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
            <h3 className="helpoverlay-group-title">{t('help.mouse')}</h3>
            <ul className="helpoverlay-tips">
              {MOUSE_TIPS.map((tip) => (
                <li key={tip}>{t(tip)}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
