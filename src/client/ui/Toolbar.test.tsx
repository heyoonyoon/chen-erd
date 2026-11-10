// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESET_ORDER, placeTool, type Tool } from '../../shared/types';
import { ui, useUi } from '../state/ui';
import { Legend, LEGEND_SECTIONS } from './Legend';
import { shortcutLabel, Toolbar, TOOL_GROUPS } from './Toolbar';

beforeEach(() => useUi.getState().reset());
afterEach(cleanup);

describe('shortcutLabel', () => {
  it('code 값을 글자로 바꾼다', () => {
    expect(shortcutLabel('KeyE')).toBe('E');
    expect(shortcutLabel('Digit1')).toBe('1');
    expect(shortcutLabel(null)).toBeNull();
  });
});

describe('Toolbar', () => {
  it('정해진 순서와 묶음으로 모든 도구를 보여 준다', () => {
    const expected: Tool[][] = [
      ['select', 'pan'],
      ['place:entity', 'place:weak-entity'],
      ['place:relationship', 'place:identifying-relationship'],
      ['place:attribute', 'place:key-attribute', 'place:partial-key-attribute', 'place:multivalued-attribute', 'place:derived-attribute'],
      ['place:spec-d', 'place:spec-o'],
      ['place:note'],
      ['connect', 'connect-double'],
    ];
    expect(TOOL_GROUPS.map((g) => g.map((d) => d.tool))).toEqual(expected);

    const { container } = render(<Toolbar />);
    for (const tool of expected.flat()) {
      const btn = screen.getByTestId(`tool-${tool}`);
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    }
    expect(PRESET_ORDER.every((id) => screen.queryByTestId(`tool-${placeTool(id)}`))).toBe(true);
    expect(container.querySelectorAll('.toolbar-sep')).toHaveLength(expected.length - 1);
  });

  it('현재 도구를 활성으로 표시하고 클릭하면 도구를 바꾼다', () => {
    render(<Toolbar />);
    expect(screen.getByTestId('tool-select').className).toContain('is-active');

    fireEvent.click(screen.getByTestId('tool-place:entity'));
    expect(ui().tool).toBe('place:entity');
    expect(ui().toolLocked).toBe(false);
    expect(screen.getByTestId('tool-place:entity').className).toContain('is-active');
    expect(screen.getByTestId('tool-place:entity').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tool-select').className).not.toContain('is-active');
    expect(screen.queryByTestId('tool-lock')).toBeNull();
  });

  it('더블클릭하면 도구를 잠그고 자물쇠를 표시한다. 다시 한 번 누르면 풀린다', () => {
    render(<Toolbar />);
    const btn = screen.getByTestId('tool-connect-double');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.doubleClick(btn);
    expect(ui().tool).toBe('connect-double');
    expect(ui().toolLocked).toBe(true);
    expect(btn.querySelector('[data-testid="tool-lock"]')).not.toBeNull();

    fireEvent.click(btn);
    expect(ui().toolLocked).toBe(false);
    expect(screen.queryByTestId('tool-lock')).toBeNull();
  });

  it('선택과 손 도구는 더블클릭해도 잠기지 않는다', () => {
    render(<Toolbar />);
    fireEvent.doubleClick(screen.getByTestId('tool-pan'));
    expect(ui().toolLocked).toBe(false);
  });

  it('마우스를 올리면 이름, 영어 이름, 단축키, 설명이 든 툴팁이 뜬다', () => {
    render(<Toolbar />);
    fireEvent.mouseEnter(screen.getByTestId('tool-place:entity'));
    let tip = screen.getByTestId('tool-tip');
    expect(tip.textContent).toContain('엔티티');
    expect(tip.textContent).toContain('Entity type');
    expect([...tip.querySelectorAll('.kbd')].map((k) => k.textContent)).toEqual(['E']);

    fireEvent.mouseEnter(screen.getByTestId('tool-connect-double'));
    tip = screen.getByTestId('tool-tip');
    expect(tip.textContent).toContain('전체 참여 또는 전체 특수화');
    expect([...tip.querySelectorAll('.kbd')].map((k) => k.textContent)).toEqual(['Shift', 'L']);

    // 단축키가 없는 도구는 키를 그리지 않는다
    fireEvent.mouseEnter(screen.getByTestId('tool-place:spec-d'));
    expect(screen.getByTestId('tool-tip').querySelector('.kbd')).toBeNull();

    fireEvent.mouseLeave(screen.getByTestId('toolbar').querySelector('.toolbar-scroll')!);
    expect(screen.queryByTestId('tool-tip')).toBeNull();
  });
});

describe('Legend', () => {
  it('묶음과 항목을 모두 보여 준다', () => {
    render(<Legend />);
    const legend = screen.getByTestId('legend');
    expect(legend.textContent).toContain('표기법 안내');
    expect(LEGEND_SECTIONS.map((s) => s.title)).toEqual(['엔티티', '관계', '속성', '선', '특수화']);
    for (const section of LEGEND_SECTIONS) {
      for (const row of section.rows) {
        expect(legend.textContent).toContain(row.name);
        expect(legend.textContent).toContain(row.nameEn);
        expect(legend.textContent).toContain(row.description);
      }
    }
    expect(legend.textContent).toContain('Chen 표기법 기준');
  });

  it('닫기 버튼이 legend 패널을 닫는다', () => {
    ui().togglePanel('legend', true);
    render(<Legend />);
    fireEvent.click(screen.getByTestId('legend-close'));
    expect(ui().panels.legend).toBe(false);
  });
});
