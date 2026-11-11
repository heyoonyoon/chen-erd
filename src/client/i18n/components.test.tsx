// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { addEdges, addNodes, getEdgesMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { RoomContext } from '../collab/hooks';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';

// 화면 이동은 viewport 담당의 모듈이므로 호출만 받는다
vi.mock('../canvas/ViewportControls', () => ({ centerOn: vi.fn() }));

import { HelpOverlay } from '../ui/HelpOverlay';
import { Inspector } from '../ui/Inspector';
import { IssuesPanel } from '../ui/IssuesPanel';
import { Legend } from '../ui/Legend';
import { Toolbar } from '../ui/Toolbar';
import { LOCALE_FLAGS, LanguageSelect } from './LanguageSelect';
import { LOCALES, LOCALE_NAMES, LOCALE_STORAGE_KEY, getLocale, setLocale, useT } from './index';

const HANGUL = /[ㄱ-ㆎ가-힣]/;

function makeRoom(): Room {
  const doc = new Y.Doc();
  return {
    id: 'testroom',
    doc,
    nodes: new ElementStore<ErdNode>(getNodesMap(doc), readNode),
    edges: new ElementStore<ErdEdge>(getEdgesMap(doc), readEdge),
  } as unknown as Room;
}

function inRoom(room: Room, ui: React.ReactNode) {
  return render(<RoomContext.Provider value={room}>{ui}</RoomContext.Provider>);
}

/** 보이는 글자와 title, aria-label, placeholder를 모두 모은다 */
function allText(root: HTMLElement): string {
  const parts = [root.textContent ?? ''];
  for (const el of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
    parts.push(el.getAttribute('title') ?? '', el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? '');
  }
  return parts.join('\n');
}

beforeEach(() => useUi.getState().reset());
afterEach(async () => {
  cleanup();
  await act(async () => {
    await setLocale('ko', { persist: false });
  });
  localStorage.clear();
});

describe('LanguageSelect', () => {
  const button = () => screen.getByTestId('language-select');
  const option = (code: string) => screen.getByTestId(`language-select-option-${code}`);

  it('브라우저의 select를 쓰지 않고, 버튼에 지금 언어의 국기와 이름을 보여 준다', () => {
    const { container } = render(<LanguageSelect />);
    expect(container.querySelector('select')).toBeNull();
    expect(button().tagName).toBe('BUTTON');
    expect(button().getAttribute('aria-label')).toBe('언어: 한국어');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().textContent).toContain('🇰🇷');
    expect(button().textContent).toContain('한국어');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('누르면 열 개 언어가 국기와 그 언어의 이름으로 나오고 지금 언어가 골라져 있다', () => {
    render(<LanguageSelect />);
    fireEvent.click(button());
    expect(button().getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('lang'))).toEqual([...LOCALES]);
    expect(options.map((o) => o.querySelector('.language-select-name')!.textContent)).toEqual(LOCALES.map((l) => LOCALE_NAMES[l]));
    expect(options.map((o) => o.querySelector('.language-select-flag')!.textContent)).toEqual(LOCALES.map((l) => LOCALE_FLAGS[l]));
    expect(new Set(Object.values(LOCALE_FLAGS)).size).toBe(LOCALES.length);
    expect(option('ko').getAttribute('aria-selected')).toBe('true');
    expect(option('en').getAttribute('aria-selected')).toBe('false');
    // 다시 누르면 닫힌다
    fireEvent.click(button());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('고르면 새로 고치지 않고 화면이 바뀌고 선택을 기억한다', async () => {
    function Probe() {
      const t = useT();
      return <p data-testid="probe">{t('common.close')}</p>;
    }
    render(
      <>
        <LanguageSelect />
        <Probe />
      </>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('닫기');

    fireEvent.click(button());
    fireEvent.click(option('en'));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Close'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(button().getAttribute('aria-label')).toBe('Language: English');
    expect(button().textContent).toContain('🇺🇸');

    // 사전을 따로 받아 오는 언어도 같은 방식으로 바뀐다
    fireEvent.click(button());
    fireEvent.click(option('vi'));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Đóng'));
    expect(document.documentElement.lang).toBe('vi');
  });

  it('키보드로 열고, 화살표로 옮기고, Enter로 고르고, Esc로 닫는다', async () => {
    render(<LanguageSelect />);
    fireEvent.keyDown(button(), { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    await waitFor(() => expect(document.activeElement).toBe(list));
    expect(list.getAttribute('aria-activedescendant')).toBe(option('ko').id);

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list.getAttribute('aria-activedescendant')).toBe(option('en').id);
    fireEvent.keyDown(list, { key: 'End' });
    expect(list.getAttribute('aria-activedescendant')).toBe(option('vi').id);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(list.getAttribute('aria-activedescendant')).toBe(option('ko').id);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(list.getAttribute('aria-activedescendant')).toBe(option('vi').id);
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    await waitFor(() => expect(getLocale()).toBe('ja'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button());

    // Esc는 고르지 않고 닫는다
    fireEvent.keyDown(button(), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(getLocale()).toBe('ja');
  });

  it('바깥을 누르면 닫힌다', () => {
    render(
      <>
        <LanguageSelect />
        <p data-testid="outside">바깥</p>
      </>,
    );
    fireEvent.click(button());
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('compact는 짧은 표기를, full은 언어 이름을 보여 준다', async () => {
    await act(async () => {
      await setLocale('de', { persist: false });
    });
    const { container, rerender } = render(<LanguageSelect variant="compact" />);
    expect(container.querySelector('.language-select-value')!.textContent).toBe('DE');
    rerender(<LanguageSelect variant="full" />);
    expect(container.querySelector('.language-select-value')!.textContent).toBe('Deutsch');
  });

  it('버튼과 목록 안의 키 입력이 전역 단축키로 새지 않는다', () => {
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    render(<LanguageSelect />);
    fireEvent.keyDown(button(), { key: 'e', code: 'KeyE' });
    fireEvent.click(button());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'v', code: 'KeyV' });
    window.removeEventListener('keydown', onKey);
    expect(onKey).not.toHaveBeenCalled();
  });
});

describe('한국어가 아닌 언어로 그린 화면', () => {
  it('도구 팔레트: 영어 이름과 설명, 영어 화면에서는 영어 용어 줄을 따로 보이지 않는다', async () => {
    await act(async () => {
      await setLocale('en', { persist: false });
    });
    render(<Toolbar />);
    expect(screen.getByTestId('toolbar').getAttribute('aria-label')).toBe('Tools');
    expect(screen.getByTestId('tool-place:entity').getAttribute('aria-label')).toBe('Entity');
    expect(screen.getByTestId('tool-place:weak-entity').getAttribute('aria-label')).toBe('Weak entity');

    fireEvent.mouseEnter(screen.getByTestId('tool-place:entity'));
    const tip = screen.getByTestId('tool-tip');
    expect(tip.textContent).toContain('Entity');
    expect(tip.textContent).toContain('Rectangle.');
    expect(tip.querySelector('.toolbar-tip-en')).toBeNull();
    expect(allText(document.body)).not.toMatch(HANGUL);

    fireEvent.doubleClick(screen.getByTestId('tool-place:entity'));
    expect(screen.getByTestId('tool-place:entity').getAttribute('aria-label')).toBe('Entity (locked)');
  });

  it('도구 팔레트: 독일어에서는 영어 용어를 함께 보여 주고, 떠 있는 채로 언어를 바꾸면 따라 바뀐다', async () => {
    await act(async () => {
      await setLocale('de', { persist: false });
    });
    render(<Toolbar />);
    fireEvent.mouseEnter(screen.getByTestId('tool-place:identifying-relationship'));
    let tip = screen.getByTestId('tool-tip');
    expect(tip.textContent).toContain('Identifizierende Beziehung');
    expect(tip.querySelector('.toolbar-tip-en')!.textContent).toBe('Identifying relationship type');

    await act(async () => {
      await setLocale('es', { persist: false });
    });
    tip = screen.getByTestId('tool-tip');
    expect(tip.textContent).toContain('Relación identificadora');
    expect(screen.getByTestId('toolbar').getAttribute('aria-label')).toBe('Herramientas');
  });

  it('표기법 안내: 일본어', async () => {
    await act(async () => {
      await setLocale('ja', { persist: false });
    });
    render(<Legend />);
    const legend = screen.getByTestId('legend');
    expect(legend.getAttribute('aria-label')).toBe('表記法ガイド');
    expect(legend.textContent).toContain('弱エンティティ');
    expect(legend.textContent).toContain('カーディナリティ');
    expect(legend.textContent).toContain('Chen 記法に準拠');
    // 표기 기호는 번역하지 않는다
    expect(legend.textContent).toContain('1、M、N');
    expect(allText(legend)).not.toMatch(HANGUL);
  });

  it('도움말: 프랑스어, 방향키 이름까지 번역된다', async () => {
    await act(async () => {
      await setLocale('fr', { persist: false });
    });
    render(<HelpOverlay />);
    const help = screen.getByTestId('help-overlay');
    expect(help.textContent).toContain('Raccourcis clavier');
    expect(help.textContent).toContain('Outils');
    expect(help.textContent).toContain('Tout sélectionner');
    expect([...help.querySelectorAll('.kbd')].map((k) => k.textContent)).toContain('Flèches');
    expect(screen.getByTestId('help-close').getAttribute('aria-label')).toBe('Fermer');
    expect(allText(help)).not.toMatch(HANGUL);
  });

  it('검증 패널: 문제 개수와 설명이 현재 언어로 나오고 사용자 글자는 그대로다', async () => {
    const room = makeRoom();
    addNodes(room.doc, [
      { id: 'a', kind: 'entity', x: 0, y: 0, w: 100, h: 50, text: '학생' },
      { id: 'b', kind: 'attribute', x: 200, y: 0, w: 100, h: 50, text: 'Age' },
    ]);
    await act(async () => {
      await setLocale('en', { persist: false });
    });
    inRoom(room, <IssuesPanel />);
    expect(screen.getByTestId('issues-panel').getAttribute('aria-label')).toBe('Validation');
    expect(screen.getByTestId('issues-error-count').textContent).toBe('1 error');
    expect(screen.getByTestId('issues-warning-count').textContent).toBe('2 warnings');
    const messages = screen.getAllByTestId('issue-item').map((el) => el.querySelector('.issues-message')!.textContent);
    expect(messages).toContain('Attribute “Age” isn’t connected to anything.');
    // 사용자가 적은 이름은 번역하지 않는다
    expect(messages).toContain('Entity “학생” has no key attribute.');

    await act(async () => {
      await setLocale('zh-TW', { persist: false });
    });
    expect(screen.getByTestId('issues-error-count').textContent).toBe('1 個錯誤');
    expect(screen.getAllByTestId('issue-item').map((el) => el.querySelector('.issues-message')!.textContent)).toContain(
      '屬性「Age」沒有連接到任何圖形。',
    );
  });

  it('검증 패널: 문제가 없을 때의 안내', async () => {
    const room = makeRoom();
    await act(async () => {
      await setLocale('pt-BR', { persist: false });
    });
    inRoom(room, <IssuesPanel />);
    expect(screen.getByTestId('issues-empty').textContent).toBe('Nenhum problema de notação');
  });

  it('인스펙터: 선을 고르면 베트남어 항목이 나온다', async () => {
    const room = makeRoom();
    addNodes(room.doc, [
      { id: 'e1', kind: 'entity', x: 0, y: 0, w: 100, h: 50, text: 'TEAM' },
      { id: 'r1', kind: 'relationship', x: 200, y: 0, w: 100, h: 50, text: '' },
    ]);
    addEdges(room.doc, [{ id: 'ed', source: 'e1', target: 'r1', double: false, label: '1', role: '' }]);
    await act(async () => {
      await setLocale('vi', { persist: false });
    });
    useUi.getState().setSelection(['ed']);
    inRoom(room, <Inspector />);
    const panel = screen.getByTestId('inspector');
    expect(panel.getAttribute('aria-label')).toBe('Thuộc tính của hình');
    expect(panel.textContent).toContain('Bản số');
    expect(panel.textContent).toContain('Nét đôi');
    // 글자가 빈 도형은 현재 언어의 종류 이름으로 부른다
    expect(screen.getByTestId('inspector-edge-name').textContent).toBe('TEAM — Mối quan hệ');
    expect(screen.getByTestId('inspector-cardinality-none').textContent).toBe('Không có');
    expect(screen.getByTestId('inspector-delete').textContent).toBe('Xóa');
    expect(allText(panel)).not.toMatch(HANGUL);
  });

  it('인스펙터: 도형을 고르면 독일어 항목이 나온다', async () => {
    const room = makeRoom();
    addNodes(room.doc, [{ id: 'a1', kind: 'attribute', x: 0, y: 0, w: 120, h: 50, text: 'Name' }]);
    await act(async () => {
      await setLocale('de', { persist: false });
    });
    useUi.getState().setSelection(['a1']);
    inRoom(room, <Inspector />);
    const panel = screen.getByTestId('inspector');
    expect(panel.textContent).toContain('Schlüsselmarkierung');
    expect(screen.getByTestId('inspector-key-partial').textContent).toBe('Partieller Schlüssel');
    expect(screen.getByTestId('inspector-multivalued').textContent).toBe('Mehrwertig');
    expect(screen.getByTestId('inspector-preset-entity').getAttribute('aria-label')).toBe('Entität');
    expect(screen.getByTestId('inspector-fit').textContent).toBe('An Text anpassen');
    expect(allText(panel)).not.toMatch(HANGUL);
  });
});
