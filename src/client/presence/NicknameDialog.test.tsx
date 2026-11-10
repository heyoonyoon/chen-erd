// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_COLORS, type Presence } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import type { Room } from '../collab/room';
import { getIdentity, saveIdentity } from '../identity';
import { NicknameDialog, openNicknameDialog, useNicknameDialog } from './NicknameDialog';

function setup() {
  const setPresence = vi.fn((_: Partial<Presence>) => {});
  const room = { id: 'test', setPresence } as unknown as Room;
  const view = render(
    <RoomContext.Provider value={room}>
      <NicknameDialog />
    </RoomContext.Provider>,
  );
  return { setPresence, ...view };
}

const input = () => screen.getByTestId('nickname-input') as HTMLInputElement;
const submit = () => screen.getByTestId('nickname-submit') as HTMLButtonElement;
const isOpen = () => screen.queryByTestId('nickname-dialog') !== null;

beforeEach(() => {
  localStorage.clear();
  useNicknameDialog.setState({ open: false, forced: false });
});
afterEach(cleanup);

describe('NicknameDialog', () => {
  it('저장된 이름이 없으면 방에 들어올 때 자동으로 열린다', () => {
    setup();
    expect(isOpen()).toBe(true);
    expect(screen.getByText('이름을 알려 주세요')).toBeTruthy();
    expect(screen.getByText('다른 팀원 화면에 이 이름으로 표시됩니다')).toBeTruthy();
    expect(input().maxLength).toBe(20);
    expect(document.activeElement).toBe(input());
    expect(screen.getAllByTestId('nickname-color')).toHaveLength(USER_COLORS.length);
  });

  it('저장된 이름이 있으면 열리지 않는다', () => {
    saveIdentity({ name: '희윤' });
    setup();
    expect(isOpen()).toBe(false);
  });

  it('자동으로 열린 경우 이름을 넣기 전에는 닫을 수 없다', () => {
    setup();
    fireEvent.keyDown(input(), { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('nickname-overlay'));
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(isOpen()).toBe(true);
    expect(submit().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: '   ' } });
    expect(submit().disabled).toBe(true);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(isOpen()).toBe(true);
    // 열려 있는 중에 다시 열어도 닫을 수 있는 상태로 바뀌지 않는다
    act(() => openNicknameDialog());
    expect(useNicknameDialog.getState().forced).toBe(true);
  });

  it('확인을 누르면 이름과 색을 저장하고 바로 알린다', () => {
    const { setPresence } = setup();
    const id = getIdentity().id;
    fireEvent.change(input(), { target: { value: '  희윤  ' } });
    const target = USER_COLORS[5];
    fireEvent.click(screen.getAllByTestId('nickname-color')[5]);
    expect(screen.getAllByTestId('nickname-color')[5].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(submit());

    expect(getIdentity()).toEqual({ id, name: '희윤', color: target });
    expect(setPresence).toHaveBeenCalledTimes(1);
    expect(setPresence).toHaveBeenCalledWith({ user: { id, name: '희윤', color: target } });
    expect(isOpen()).toBe(false);
  });

  it('Enter로 확인하되 한글 조합 중의 Enter는 무시한다', () => {
    const { setPresence } = setup();
    fireEvent.change(input(), { target: { value: '희윤' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(isOpen()).toBe(true);
    expect(setPresence).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 13 });
    expect(isOpen()).toBe(false);
    expect(getIdentity().name).toBe('희윤');
  });

  it('직접 연 경우 지금 이름과 색을 채워서 보여 주고 Esc로 닫는다', () => {
    saveIdentity({ name: '희윤', color: USER_COLORS[2] });
    const { setPresence } = setup();
    act(() => openNicknameDialog());
    expect(input().value).toBe('희윤');
    expect(screen.getAllByTestId('nickname-color')[2].className).toContain('is-active');
    fireEvent.change(input(), { target: { value: '바꾸다 만 이름' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(getIdentity().name).toBe('희윤');
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('직접 연 경우 바깥을 누르면 닫히고 안쪽을 누르면 닫히지 않는다', () => {
    saveIdentity({ name: '희윤' });
    setup();
    act(() => openNicknameDialog());
    fireEvent.mouseDown(screen.getByTestId('nickname-dialog'));
    fireEvent.mouseDown(input());
    expect(isOpen()).toBe(true);
    fireEvent.mouseDown(screen.getByTestId('nickname-overlay'));
    expect(isOpen()).toBe(false);
  });

  it('창 안의 키 입력이 전역 단축키로 새지 않는다', () => {
    const onWindow = vi.fn();
    const onDocument = vi.fn();
    window.addEventListener('keydown', onWindow);
    document.addEventListener('keydown', onDocument, true);
    try {
      setup();
      fireEvent.keyDown(input(), { key: 'v', code: 'KeyV' });
      fireEvent.keyDown(screen.getAllByTestId('nickname-color')[0], { key: ' ', code: 'Space' });
      fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete' });
      expect(onWindow).not.toHaveBeenCalled();
      expect(onDocument).not.toHaveBeenCalled();

      // 닫힌 뒤에는 다시 전달된다
      fireEvent.change(input(), { target: { value: '희윤' } });
      fireEvent.click(submit());
      fireEvent.keyDown(document.body, { key: 'v', code: 'KeyV' });
      expect(onWindow).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', onWindow);
      document.removeEventListener('keydown', onDocument, true);
    }
  });

  it('Tab은 창 안에서만 돈다', () => {
    setup();
    fireEvent.change(input(), { target: { value: '희윤' } });
    submit().focus();
    fireEvent.keyDown(submit(), { key: 'Tab' });
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submit());
  });

  it('방을 나가면 닫힌 상태로 돌아간다', () => {
    const { unmount } = setup();
    expect(useNicknameDialog.getState().open).toBe(true);
    unmount();
    expect(useNicknameDialog.getState()).toEqual({ open: false, forced: false });
  });
});
