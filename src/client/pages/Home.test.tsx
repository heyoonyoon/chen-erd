// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ROOM_ID_PATTERN, USER_COLORS } from '../../shared/types';
import { getIdentity, getRecentRooms, rememberRoom, saveIdentity } from '../identity';
import { Home } from './Home';

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('Home', () => {
  it('새 다이어그램 만들기를 누르면 새 방 주소로 간다', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('create-room'));
    const m = /^\/r\/([^/]+)$/.exec(location.pathname);
    expect(m).not.toBeNull();
    expect(ROOM_ID_PATTERN.test(m![1])).toBe(true);
  });

  it('초대 링크를 넣고 들어가기를 누르면 그 방으로 간다', () => {
    render(<Home />);
    fireEvent.change(screen.getByTestId('join-input'), { target: { value: 'https://erd.example.com/r/abc234xyz9?x=1' } });
    fireEvent.click(screen.getByTestId('join-button'));
    expect(location.pathname).toBe('/r/abc234xyz9');
  });

  it('Enter로 들어가고, 한글 조합 중의 Enter는 무시한다', () => {
    render(<Home />);
    const input = screen.getByTestId('join-input');
    fireEvent.change(input, { target: { value: 'team-7' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(location.pathname).toBe('/');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(location.pathname).toBe('/');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(location.pathname).toBe('/r/team-7');
  });

  it('형식이 틀리면 안내를 보이고, 다시 입력하면 지운다', () => {
    render(<Home />);
    const input = screen.getByTestId('join-input');
    fireEvent.change(input, { target: { value: '방 코드' } });
    fireEvent.click(screen.getByTestId('join-button'));
    expect(location.pathname).toBe('/');
    expect(screen.getByRole('alert').textContent).toBe('방 코드 형식이 올바르지 않습니다');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('저장된 이름을 채우고, 바꾸면 저장한다', () => {
    saveIdentity({ name: '희윤' });
    render(<Home />);
    const input = screen.getByLabelText('내 이름') as HTMLInputElement;
    expect(input.value).toBe('희윤');
    expect(input.maxLength).toBe(20);
    fireEvent.change(input, { target: { value: '김철수' } });
    expect(getIdentity().name).toBe('김철수');
  });

  it('색을 누르면 저장하고 강조한다', () => {
    saveIdentity({ color: USER_COLORS[0] });
    render(<Home />);
    const swatches = screen.getAllByTestId('color-swatch');
    expect(swatches).toHaveLength(USER_COLORS.length);
    expect(swatches[0].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(swatches[3]);
    expect(getIdentity().color).toBe(USER_COLORS[3]);
    expect(swatches[3].getAttribute('aria-pressed')).toBe('true');
    expect(swatches[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('최근 목록이 비면 구역을 숨긴다', () => {
    render(<Home />);
    expect(screen.queryByTestId('recent-rooms')).toBeNull();
  });

  it('최근 목록을 보여 주고, 누르면 이동하고, 지우면 목록에서 뺀다', () => {
    rememberRoom('room-a', '수강신청 ERD');
    rememberRoom('room-b', '');
    render(<Home />);
    const links = screen.getAllByTestId('recent-room');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toContain('제목 없는 다이어그램');
    expect(links[0].textContent).toContain('room-b');
    expect(links[0].textContent).toContain('방금 전');
    expect(links[1].textContent).toContain('수강신청 ERD');

    fireEvent.click(screen.getAllByTestId('forget-room')[0]);
    expect(getRecentRooms().map((r) => r.id)).toEqual(['room-a']);
    expect(screen.getAllByTestId('recent-room')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('recent-room'));
    expect(location.pathname).toBe('/r/room-a');
  });
});
