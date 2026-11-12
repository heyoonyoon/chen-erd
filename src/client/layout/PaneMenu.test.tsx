// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePane, defaultLayout, openPanes } from './model';
import { PaneMenu } from './PaneMenu';
import type { LayoutState, PaneId } from './types';

const TITLES: Record<PaneId, string> = { erd: 'ERD', relational: 'Relational', ie: 'IE', sql: 'SQL' };

let current: LayoutState;
function Harness({ initial }: { initial: LayoutState }) {
  const [s, setS] = useState(initial);
  current = s;
  return (
    <div>
      <PaneMenu state={s} onChange={setS} paneTitle={(p) => TITLES[p]} paneIcon={(p) => <svg data-icon={p} />} />
      <button type="button" data-testid="outside">
        outside
      </button>
    </div>
  );
}

afterEach(cleanup);

describe('PaneMenu', () => {
  it('열린 pane에 체크를 보이고 누르면 닫거나 연다', () => {
    const { getByTestId } = render(<Harness initial={closePane(defaultLayout(), 'sql')} />);
    const button = getByTestId('pane-menu-button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('pane-menu-erd').getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('pane-menu-sql').getAttribute('aria-checked')).toBe('false');
    expect(getByTestId('pane-menu-sql').querySelector('[data-icon="sql"]')).not.toBeNull();
    expect(getByTestId('pane-menu-sql').textContent).toContain('SQL');
    fireEvent.click(getByTestId('pane-menu-sql'));
    expect(openPanes(current)).toContain('sql');
    expect(getByTestId('pane-menu-sql').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(getByTestId('pane-menu-ie'));
    expect(openPanes(current)).not.toContain('ie');
  });

  it('마지막 남은 pane은 흐리게 보이고 닫히지 않는다', () => {
    let s = defaultLayout();
    for (const p of ['relational', 'ie', 'sql'] as const) s = closePane(s, p);
    const { getByTestId } = render(<Harness initial={s} />);
    fireEvent.click(getByTestId('pane-menu-button'));
    const erd = getByTestId('pane-menu-erd') as HTMLButtonElement;
    expect(erd.disabled).toBe(true);
    fireEvent.click(erd);
    expect(openPanes(current)).toEqual(['erd']);
  });

  it('레이아웃 초기화', () => {
    const { getByTestId, queryByTestId } = render(<Harness initial={closePane(defaultLayout(), 'sql')} />);
    fireEvent.click(getByTestId('pane-menu-button'));
    fireEvent.click(getByTestId('pane-menu-reset'));
    expect(current).toEqual(defaultLayout());
    expect(queryByTestId('pane-menu')).toBeNull();
    expect(document.activeElement).toBe(getByTestId('pane-menu-button'));
  });

  it('키보드로 다루고 키 입력은 밖으로 새지 않는다', () => {
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const { getByTestId, queryByTestId } = render(<Harness initial={defaultLayout()} />);
    const button = getByTestId('pane-menu-button');
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = getByTestId('pane-menu');
    expect(document.activeElement).toBe(getByTestId('pane-menu-erd'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByTestId('pane-menu-relational'));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(getByTestId('pane-menu-reset'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(getByTestId('pane-menu-erd'));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(getByTestId('pane-menu-reset'));
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(queryByTestId('pane-menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outside);
  });

  it('바깥을 누르면 닫힌다', () => {
    const { getByTestId, queryByTestId } = render(<Harness initial={defaultLayout()} />);
    fireEvent.click(getByTestId('pane-menu-button'));
    fireEvent.pointerDown(getByTestId('pane-menu-sql'));
    expect(queryByTestId('pane-menu')).not.toBeNull();
    fireEvent.pointerDown(getByTestId('outside'));
    expect(queryByTestId('pane-menu')).toBeNull();
  });

  it('단추를 다시 누르면 닫힌다', () => {
    const { getByTestId, queryByTestId } = render(<Harness initial={defaultLayout()} />);
    fireEvent.click(getByTestId('pane-menu-button'));
    fireEvent.click(getByTestId('pane-menu-button'));
    expect(queryByTestId('pane-menu')).toBeNull();
  });
});
