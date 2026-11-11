/**
 * 왼쪽 도구 팔레트. [담당: toolbar 에이전트]
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NODE_PRESETS, PRESET_ORDER, placeTool, type PresetId, type Tool } from '../../shared/types';
import { PresetIcon } from '../canvas/PresetIcon';
import { useLocale, useT, type MessageKey } from '../i18n';
import { useUi } from '../state/ui';
import './Toolbar.css';

/** 팔레트 버튼 하나의 정의 */
export interface ToolDef {
  tool: Tool;
  /** 이름의 사전 키 */
  label: MessageKey;
  /** 영어 이름(수업 용어). 영어 화면에서는 이름과 겹치므로 보여 주지 않는다 */
  labelEn: string;
  /** 단축키 표시(조합이면 여러 개). 없으면 빈 배열 */
  keys: string[];
  /** 툴팁에 보이는 한 줄 설명의 사전 키 */
  description: MessageKey;
  /** 더블클릭으로 잠글 수 있는 도구인지(도형 놓기, 연결) */
  lockable: boolean;
  icon: ReactNode;
}

/** KeyboardEvent.code를 화면에 보일 글자로 바꾼다. KeyE → E, Digit1 → 1 */
export function shortcutLabel(code: string | null): string | null {
  if (!code) return null;
  return code.replace(/^(Key|Digit)/, '');
}

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function SelectIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 3.2v12.6l3.3-3 2.1 4.7 1.9-.9-2.1-4.6 4.4-.3z" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M7 12.5V4.75a1.25 1.25 0 0 1 2.5 0V9.5" />
      <path d="M9.5 9.5v-6a1.25 1.25 0 0 1 2.5 0v6" />
      <path d="M12 9.5v-5a1.25 1.25 0 0 1 2.5 0V10" />
      <path d="M14.5 10V6.75a1.25 1.25 0 0 1 2.5 0V12c0 3.2-2.3 5.5-5.5 5.5h-1c-1.9 0-3.2-.8-4.3-2.4l-2.4-3.5a1.2 1.2 0 0 1 2-1.3L7 12.5" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4.5 15.5l11-11" />
    </svg>
  );
}

function DoubleLineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3.4 13.9L13.9 3.4" />
      <path d="M6.1 16.6L16.6 6.1" />
    </svg>
  );
}

function presetTool(id: PresetId): ToolDef {
  const preset = NODE_PRESETS[id];
  const key = shortcutLabel(preset.shortcut);
  return {
    tool: placeTool(id),
    label: `preset.${id}.label`,
    labelEn: preset.labelEn,
    keys: key ? [key] : [],
    description: `preset.${id}.desc`,
    lockable: true,
    icon: <PresetIcon presetId={id} size={26} />,
  };
}

/** PRESET_ORDER에서 종류(kind)가 같은 프리셋이 이어지면 한 묶음으로 본다. */
function presetGroups(): ToolDef[][] {
  const groups: ToolDef[][] = [];
  let lastKind: string | null = null;
  for (const id of PRESET_ORDER) {
    const kind = NODE_PRESETS[id].kind;
    if (kind !== lastKind) groups.push([]);
    groups[groups.length - 1].push(presetTool(id));
    lastKind = kind;
  }
  return groups;
}

/** 팔레트에 보이는 순서대로의 묶음. 묶음 사이에 구분선을 긋는다. */
export const TOOL_GROUPS: ToolDef[][] = [
  [
    {
      tool: 'select',
      label: 'tool.select.label',
      labelEn: 'Select',
      keys: ['V'],
      description: 'tool.select.desc',
      lockable: false,
      icon: <SelectIcon />,
    },
    {
      tool: 'pan',
      label: 'tool.pan.label',
      labelEn: 'Hand',
      keys: ['H'],
      description: 'tool.pan.desc',
      lockable: false,
      icon: <HandIcon />,
    },
  ],
  ...presetGroups(),
  [
    {
      tool: 'connect',
      label: 'tool.connect.label',
      labelEn: 'Line',
      keys: ['L'],
      description: 'tool.connect.desc',
      lockable: true,
      icon: <LineIcon />,
    },
    {
      tool: 'connect-double',
      label: 'tool.connect-double.label',
      labelEn: 'Double line',
      keys: ['Shift', 'L'],
      description: 'tool.connect-double.desc',
      lockable: true,
      icon: <DoubleLineIcon />,
    },
  ],
];

interface TipState {
  def: ToolDef;
  /** 툴팁 왼쪽 끝과 세로 중심의 화면 좌표 */
  left: number;
  centerY: number;
}

const TIP_GAP = 12;
const TIP_MARGIN = 8;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function Toolbar() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  const toolLocked = useUi((s) => s.toolLocked);
  const setTool = useUi((s) => s.setTool);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [more, setMore] = useState({ up: false, down: false });

  // 가려진 도구가 있으면 위아래 끝을 흐리게 해서 더 있다는 것을 알린다(스크롤바는 숨겨 둔다)
  const updateMore = () => {
    const el = scrollRef.current;
    if (!el) return;
    const up = el.scrollTop > 1;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setMore((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
  };

  useEffect(() => {
    updateMore();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateMore);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showTip = (def: ToolDef, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ def, left: r.right + TIP_GAP, centerY: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);

  return (
    <div className="toolbar panel" role="toolbar" aria-label={t('toolbar.label')} aria-orientation="vertical" data-testid="toolbar">
      <div
        ref={scrollRef}
        className="toolbar-scroll"
        data-more-up={more.up || undefined}
        data-more-down={more.down || undefined}
        onScroll={() => {
          updateMore();
          hideTip();
        }}
        onMouseLeave={hideTip}
      >
        {TOOL_GROUPS.map((group, gi) => (
          <Fragment key={group[0].tool}>
            {gi > 0 && <div className="toolbar-sep" role="separator" />}
            <div className="toolbar-group" role="group">
              {group.map((def) => {
                const active = tool === def.tool;
                const locked = active && toolLocked && def.lockable;
                return (
                  <button
                    key={def.tool}
                    type="button"
                    className={`toolbar-btn${active ? ' is-active' : ''}`}
                    data-testid={`tool-${def.tool}`}
                    data-locked={locked || undefined}
                    aria-label={locked ? t('toolbar.locked', { label: t(def.label) }) : t(def.label)}
                    aria-pressed={active}
                    aria-keyshortcuts={def.keys.length > 0 ? def.keys.join('+') : undefined}
                    onClick={(e) => {
                      setTool(def.tool);
                      // 마우스로 누른 뒤 버튼에 포커스가 남으면 스페이스(화면 이동)가 버튼을 다시 누른다
                      if (e.detail > 0) e.currentTarget.blur();
                    }}
                    onDoubleClick={() => {
                      if (def.lockable) setTool(def.tool, true);
                    }}
                    onMouseEnter={(e) => {
                      // 캔버스에서 끌던 중에 지나가는 경우는 띄우지 않는다
                      if (e.buttons === 0) showTip(def, e.currentTarget);
                    }}
                    onMouseMove={(e) => {
                      // 스크롤로 툴팁이 닫힌 뒤 같은 버튼 위에서 다시 움직이면 되살린다
                      if (e.buttons === 0 && tip?.def !== def) showTip(def, e.currentTarget);
                    }}
                    onFocus={(e) => {
                      if (isFocusVisible(e.currentTarget)) showTip(def, e.currentTarget);
                    }}
                    onBlur={hideTip}
                  >
                    {def.icon}
                    {locked && <LockMark />}
                  </button>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>
      {tip && <ToolTip tip={tip} locked={tool === tip.def.tool && toolLocked && tip.def.lockable} />}
    </div>
  );
}

/** 잠금 상태 표시. 버튼 오른쪽 위의 작은 자물쇠 */
function LockMark() {
  return (
    <svg className="toolbar-lock" data-testid="tool-lock" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M3.1 4.6V3.3a1.9 1.9 0 0 1 3.8 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.8" y="4.4" width="6.4" height="4.8" rx="1.2" fill="currentColor" />
    </svg>
  );
}

/** 버튼 오른쪽에 뜨는 설명. 팔레트가 스크롤 영역이라 잘리지 않도록 body에 그린다. */
function ToolTip({ tip, locked }: { tip: TipState; locked: boolean }) {
  const t = useT();
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const { def } = tip;

  // 화면 위아래 밖으로 나가지 않게 세로 위치를 맞춘다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const half = el.offsetHeight / 2;
    const min = TIP_MARGIN + half;
    const max = window.innerHeight - TIP_MARGIN - half;
    el.style.top = `${Math.max(min, Math.min(max, tip.centerY))}px`;
  }, [tip, locked, locale]);

  return createPortal(
    <div ref={ref} className="toolbar-tip" role="tooltip" data-testid="tool-tip" style={{ left: tip.left, top: tip.centerY }}>
      <div className="toolbar-tip-head">
        <span className="toolbar-tip-name">{t(def.label)}</span>
        {def.keys.length > 0 && (
          <span className="toolbar-tip-keys">
            {def.keys.map((k, i) => (
              <span key={k} className="toolbar-tip-key">
                {i > 0 && <span className="toolbar-tip-plus">+</span>}
                <kbd className="kbd">{k}</kbd>
              </span>
            ))}
          </span>
        )}
      </div>
      {locale !== 'en' && <div className="toolbar-tip-en">{def.labelEn}</div>}
      <div className="toolbar-tip-desc">{t(def.description)}</div>
      {def.lockable && (
        <div className="toolbar-tip-hint">
          {locked ? t('toolbar.lockHint.locked') : t('toolbar.lockHint.unlocked')}
        </div>
      )}
    </div>,
    document.body,
  );
}
