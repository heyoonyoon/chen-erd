// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { APP_NAME } from '../../shared/app';
import { ROOM_ID_PATTERN } from '../../shared/types';
import { LOCALES, loadLocale, setLocale, type Locale } from '../i18n';
import { getRecentRooms, rememberRoom, saveIdentity } from '../identity';
import { approximateLineWidth } from '../text/measure';
import { useToasts } from '../ui/toast';
import { REPO_URL } from './githubStars';
import { Home } from './Home';
import { AI_NODES, AI_TEXT, modelName } from './HomeAi';
import { NODES, SAMPLE_TEXT, sqlExample } from './HomePreview';
import { stageAt } from './HomeStages';

const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

/** 보이는 글자와 title, aria-label, placeholder를 모두 모은다. 언어 목록의 언어 이름(한국어 등)은 뺀다 */
function allText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('option').forEach((o) => o.remove());
  // 앱이 어느 언어에서나 그대로 내보내는 글자(SQL의 타입 미지정 자리 표시)는 뺀다
  copy.querySelectorAll('[data-verbatim]').forEach((o) => o.remove());
  const parts = [copy.textContent ?? ''];
  for (const el of copy.querySelectorAll('[title], [aria-label], [placeholder]')) {
    parts.push(el.getAttribute('title') ?? '', el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? '');
  }
  return parts.join('\n');
}

async function switchTo(locale: Locale) {
  await act(async () => {
    await setLocale(locale, { persist: false });
  });
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  useToasts.getState().clear();
  await switchTo('ko');
  localStorage.clear();
});

describe('Home', () => {
  it('새 다이어그램 만들기를 누르면 고르는 창이 뜨고, 빈 다이어그램을 고르면 새 방 주소로 간다', () => {
    render(<Home />);
    const create = screen.getByTestId('create-room');
    expect(create.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(create);
    // 누르자마자 방으로 가지 않는다
    expect(location.pathname).toBe('/');
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-testid')).toBe('new-dialog');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('새 다이어그램 만들기');
    expect(screen.getByTestId('new-blank').textContent).toContain('빈 다이어그램으로 시작');
    expect(screen.getByTestId('new-migrate').textContent).toContain('draw.io, ERDCloud 같은 다른 도구나 손으로 그린 ERD');
    // 첫 선택지에 포커스가 간다
    expect(document.activeElement).toBe(screen.getByTestId('new-blank'));
    fireEvent.click(screen.getByTestId('new-blank'));
    const m = /^\/r\/([^/]+)$/.exec(location.pathname);
    expect(m).not.toBeNull();
    expect(ROOM_ID_PATTERN.test(m![1])).toBe(true);
  });

  it('고르는 창은 Esc나 바깥 클릭, 닫기 버튼으로 닫히고 연 버튼으로 포커스가 돌아간다', () => {
    render(<Home />);
    const create = screen.getByTestId('create-room');
    create.focus();
    fireEvent.click(create);
    expect(document.querySelector('.home.is-locked')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(create);
    expect(document.querySelector('.home.is-locked')).toBeNull();

    fireEvent.click(create);
    // 창 안을 누르면 닫히지 않는다
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.mouseDown(screen.getByTestId('new-dialog-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(create);
    fireEvent.click(screen.getByTestId('new-dialog-close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(location.pathname).toBe('/');
  });

  it('Tab은 창 안에서만 돈다', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('create-room'));
    const close = screen.getByTestId('new-dialog-close');
    const blank = screen.getByTestId('new-blank');
    const migrate = screen.getByTestId('new-migrate');
    // 순서: 닫기, 빈 다이어그램, 옮기기
    migrate.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(migrate);
    blank.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    // 중간에서는 브라우저 기본 이동에 맡긴다
    expect(document.activeElement).toBe(blank);
  });

  it('기존 도구에서 옮기기를 고르면 단계 안내가 나오고, 지시문을 복사하고, 뒤로 가거나 빈 다이어그램으로 시작한다', async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const toasts = () => useToasts.getState().items.map((t) => [t.message, t.kind]);
    render(<Home />);
    fireEvent.click(screen.getByTestId('create-room'));
    fireEvent.click(screen.getByTestId('new-migrate'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-testid')).toBe('migrate-dialog');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('기존 ERD 옮기기');
    expect([...dialog.querySelectorAll('.home-step-title')].map((el) => el.textContent)).toEqual([
      '기존 ERD를 이미지로 저장합니다',
      'AI에 이미지를 첨부하고 지시문을 붙여 넣습니다',
      'AI가 알려 준 주소로 들어갑니다',
    ]);
    // 3단계에는 설명 대신 시연 영상이 있고, 누르기 전에는 재생하지 않는다
    const video = screen.getByTestId('migrate-video') as HTMLVideoElement;
    expect(video.closest('.home-step')!.textContent).toContain('AI가 알려 준 주소로 들어갑니다');
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.hasAttribute('controls')).toBe(true);
    // 제목으로 포커스를 옮겨 읽기 도구가 바뀐 화면을 읽게 한다
    expect(document.activeElement!.textContent).toBe('기존 ERD 옮기기');

    // 명령을 실행하는 AI: 첫 화면 AI 구역과 같은 지시문
    expect(screen.getByTestId('migrate-tab-cli').getAttribute('aria-selected')).toBe('true');
    const cli = screen.getByTestId('migrate-cli-text').textContent!;
    expect(cli).toContain('npx -y modelll new model.mdl');
    fireEvent.click(screen.getByTestId('migrate-cli-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(cli);

    // 대화형 AI: 원격 MCP 주소와 대화창에 붙일 짧은 지시문. 오른쪽 화살표로도 옮겨 간다
    fireEvent.keyDown(screen.getByTestId('migrate-tab-cli'), { key: 'ArrowRight' });
    expect(screen.getByTestId('migrate-tab-chat').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByTestId('migrate-tab-chat'));
    expect(screen.queryByTestId('migrate-panel-cli')).toBeNull();
    expect(screen.getByTestId('migrate-panel-chat').textContent).toContain('원격 MCP 서버나 커넥터');
    expect(screen.getByTestId('migrate-mcp-text').textContent).toBe(`${location.origin}/mcp`);
    fireEvent.click(screen.getByTestId('migrate-mcp-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['주소를 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/mcp`);
    const chat = '첨부한 ERD 이미지를 modelll MCP로 그대로 옮겨서 새 다이어그램을 만들고 주소를 알려 주세요.';
    expect(screen.getByTestId('migrate-chat-text').textContent).toBe(chat);
    fireEvent.click(screen.getByTestId('migrate-chat-copy'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(chat));

    // 뒤로: 고르는 창으로 돌아가고 방금 고른 선택지에 포커스가 간다
    fireEvent.click(screen.getByTestId('migrate-back'));
    expect(screen.getByRole('dialog').getAttribute('data-testid')).toBe('new-dialog');
    expect(document.activeElement).toBe(screen.getByTestId('new-migrate'));

    // 다시 들어가 Esc로 닫는다
    fireEvent.click(screen.getByTestId('new-migrate'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(location.pathname).toBe('/');

    // 안내에는 빈 다이어그램으로 바로 가는 버튼이 없다
    fireEvent.click(screen.getByTestId('create-room'));
    fireEvent.click(screen.getByTestId('new-migrate'));
    expect(screen.queryByTestId('migrate-blank')).toBeNull();
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

  it('이름과 색을 정하는 자리는 첫 화면에 없다(방에 들어갈 때 묻는다)', () => {
    saveIdentity({ name: '희윤' });
    const { container } = render(<Home />);
    expect(screen.queryByTestId('name-input')).toBeNull();
    expect(screen.queryByTestId('color-swatch')).toBeNull();
    expect(container.querySelector('.home-nav')!.textContent).not.toContain('희윤');
  });

  it('상단에 GitHub 저장소 링크를 새 탭으로 열리게 두고, 별 수를 모르면 이름을 적는다', () => {
    render(<Home />);
    const link = screen.getByTestId('github-link') as HTMLAnchorElement;
    expect(link.href).toBe(REPO_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.textContent).toBe('GitHub');
    expect(link.getAttribute('aria-label')).toBe('GitHub 저장소 열기');
  });

  it('기억해 둔 별 수가 있으면 줄여서 적는다', () => {
    localStorage.setItem('chen-erd.stars', JSON.stringify({ count: 1234, at: Date.now() }));
    render(<Home />);
    const link = screen.getByTestId('github-link');
    expect(link.textContent).toBe('1.2k');
    expect(link.getAttribute('aria-label')).toContain('1,234');
  });

  it('바닥글 없이 끝나고, 움직임을 쓸 수 없는 환경에서는 처음부터 완성된 화면을 보여 준다', () => {
    const { container } = render(<Home />);
    expect(container.querySelector('footer')).toBeNull();
    // 화면에 들어와야 나타나는 구역이 감춰진 채로 남지 않는다
    const reveals = container.querySelectorAll('.home-reveal');
    expect(reveals.length).toBeGreaterThan(0);
    reveals.forEach((el) => expect(el.classList.contains('is-in')).toBe(true));
    expect(container.querySelector('.home-sheet-row.is-armed')).toBeNull();
    // 제품 화면 예시는 분할 화면에서 타입까지 채운 IE 장면에 멈춰 있다
    const split = screen.getByTestId('home-pv-split');
    expect(split.getAttribute('data-tab')).toBe('ie');
    expect(split.querySelectorAll('[data-node-id]')).toHaveLength(7);
    expect(split.querySelectorAll('[data-edge-id]')).toHaveLength(6);
    expect(split.querySelector('.is-new')).toBeNull();
    expect(split.querySelectorAll('.home-pv-word.is-ul')).toHaveLength(2);
    expect(split.querySelector('.home-pv-caret')).toBeNull();
    expect(split.querySelector('[data-testid="home-pv-menu"]')).toBeNull();
    // 지민은 IE에, 서연은 관계 모델 칸에 있다
    expect(split.querySelectorAll('.home-pv-hcursor')).toHaveLength(2);
    // 세 단계 구역은 고정 없이 세 단계를 모두 보여 주고 영상은 재생 버튼을 둔다
    expect(screen.getByTestId('home-stages').classList.contains('is-pinned')).toBe(false);
    expect(screen.getByTestId('home-stages').querySelectorAll('.home-story-stage.is-active')).toHaveLength(3);
    expect(screen.getByTestId('home-stages').querySelectorAll('.home-story-play')).toHaveLength(3);
    // AI 구역의 그림도 감춰 둔 것 없이 완성된 모습이다
    expect(screen.getByTestId('ai-figure').classList.contains('is-armed')).toBe(false);
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

describe('Home: 제품 이름과 첫 화면의 글자', () => {
  it('제품 이름은 상수에서 오고 탭 제목과 상단에 쓰인다', () => {
    const { container } = render(<Home />);
    expect(APP_NAME).toBe('modelll');
    // 탭 제목은 이름으로 시작하고 무엇을 하는 곳인지까지 적는다
    expect(document.title).toBe('modelll | 팀과 AI가 함께, ERD부터 SQL까지');
    expect(container.querySelector('.home-brand-name')!.textContent).toBe('modelll');
    // 옛 이름이 화면에 남아 있지 않다(Chen 표기법이라는 말은 남는다)
    expect(container.textContent).not.toContain('Chen ERD');
    expect(container.querySelector('.home-lead')!.textContent).toContain('Chen 표기법');
    // 처음 온 사람이 머리글에서 설계 세 단계와 AI가 함께 그릴 수 있다는 것을 알게 한다
    expect(container.querySelector('.home-lead')!.textContent).toContain('개념적, 논리적, 물리적 설계');
    expect(container.querySelector('.home-lead')!.textContent).toContain('Claude나 ChatGPT 같은 AI');
  });

  it('한국어 제목은 세 줄이다', () => {
    const { container } = render(<Home />);
    const title = container.querySelector('.home-title')!;
    expect(title.querySelectorAll('br')).toHaveLength(2);
    expect(title.textContent).toBe('팀과 AI가 함께.ERD부터 SQL까지.데이터베이스 모델링을 한\u00a0곳에서.');
  });

  it('표기 표의 속성 줄은 네 가지이고 유도 속성은 없다', () => {
    const { container } = render(<Home />);
    const rows = container.querySelectorAll('.home-sheet-panel.is-active .home-sheet-row');
    expect([...rows].map((r) => r.querySelector('.home-sheet-group')!.textContent)).toEqual(['엔티티', '관계', '속성', '선', '특수화']);
    const names = [...rows[2].querySelectorAll('.home-sheet-name')].map((el) => el.textContent);
    expect(names).toEqual(['속성', '식별자', '부분 키', '다중값 속성']);
    expect(container.textContent).not.toContain('유도');
    expect(container.querySelector('.home-sheet ellipse[stroke-dasharray]')).toBeNull();
    // 한국어 화면에서는 영어 용어를 둘째 줄에 함께 적는다
    expect([...rows[2].querySelectorAll('.home-sheet-en')].map((el) => el.textContent)).toEqual([
      'Attribute',
      'Identifier',
      'Partial key',
      'Multivalued attribute',
    ]);
    // 제품 화면 예시의 도구 줄에도 유도 속성 도구가 없다(선택 도구 + 도형 6개)
    expect(container.querySelectorAll('.home-pv-tool')).toHaveLength(7);
  });

  it('표기 표는 ERD, 관계 모델, IE 다이어그램, SQL 네 탭이고 고른 묶음만 그린다', () => {
    const { container } = render(<Home />);
    const active = () => container.querySelector('.home-sheet-panel.is-active')!;
    const rowsOf = () => [...active().querySelectorAll('.home-sheet-row')];
    // 네 묶음은 모두 그려 두고(칸 높이를 가장 높은 묶음에 맞춘다) 고른 묶음만 보인다
    expect([...container.querySelectorAll('.home-sheet-panel')].map((el) => el.getAttribute('data-tab'))).toEqual(['erd', 'rel', 'ie', 'sql']);
    expect(container.querySelectorAll('.home-sheet-panel[aria-hidden="true"]')).toHaveLength(3);
    const groupsOf = () => rowsOf().map((r) => r.querySelector('.home-sheet-group')!.textContent);
    const namesOf = (row: number) => [...rowsOf()[row].querySelectorAll('.home-sheet-name')].map((el) => el.textContent);
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['ERD', '관계 모델', 'IE 다이어그램', 'SQL']);
    expect(screen.getByTestId('notation-tab-erd').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.home-notation .home-section-sub')!.textContent).toBe('ERD부터 관계 모델, IE 다이어그램, SQL까지 각 단계의 표기를 그대로 씁니다');

    // 관계 모델: 기본키는 진짜 밑줄, 외래키 줄은 테이블 바로 아래, 가리키는 컬럼은 뺄 수 있다
    fireEvent.click(screen.getByTestId('notation-tab-rel'));
    expect(screen.getByTestId('notation-tab-rel').getAttribute('aria-selected')).toBe('true');
    expect(groupsOf()).toEqual(['테이블', '외래키']);
    expect(active().getAttribute('data-tab')).toBe('rel');
    expect([...active().querySelectorAll('.home-sheet-line')].map((el) => el.textContent)).toEqual([
      '학생 (학번, 이름, 학과코드)',
      '수강 (학번, 과목코드, 성적)',
      '학생 (학번, 이름, 학과코드)',
      'Foreign Key (학과코드) references 학과 (학과코드)',
      'Foreign Key (학과코드) references 학과',
    ]);
    expect([...active().querySelectorAll('.home-sheet-ul')].map((el) => el.textContent)).toEqual(['학번', '학번', '과목코드', '학번']);
    expect(namesOf(0)[0]).toMatch(/^기본키는 이름에 밑줄\((⌘U|Ctrl\+U)\)$/);

    // IE: 앱의 기호 설명과 같은 이름의 선 끝 여섯, 식별과 비식별 관계 선, 네 칸 테이블 상자
    fireEvent.click(screen.getByTestId('notation-tab-ie'));
    expect(groupsOf()).toEqual(['선 끝', '선 끝(최소 미정)', '관계 선', '테이블']);
    expect([...namesOf(0), ...namesOf(1)]).toEqual(['정확히 하나', '하나 이상', '없거나 하나', '없거나 여럿', '하나(최소 미정)', '여럿(최소 미정)']);
    expect(namesOf(2)).toEqual(['식별 관계', '비식별 관계']);
    expect(rowsOf()[2].querySelectorAll('.home-ie-link')).toHaveLength(1);
    const table = rowsOf()[3].querySelector('svg')!;
    expect([...table.querySelectorAll('.home-ie-tag')].map((el) => el.textContent)).toEqual(['PK', 'FK']);
    expect([...table.querySelectorAll('.home-ie-null')].map((el) => el.textContent)).toEqual(['NOT NULL', 'NOT NULL', 'NULL']);

    // SQL: DBMS마다 식별자 따옴표와 타입이 다르고, 만드는 문에는 타입 미지정 자리 표시가 있다
    fireEvent.click(screen.getByTestId('notation-tab-sql'));
    expect(groupsOf()).toEqual(['DBMS', '만드는 문']);
    expect(namesOf(0)).toEqual(['MySQL', 'PostgreSQL', 'Oracle']);
    const code = [...active().querySelectorAll('.home-sheet-line')].map((el) => el.textContent).join('\n');
    expect(code).toContain('CREATE TABLE `학생` (');
    expect(code).toContain('"이름" VARCHAR2(50 CHAR)');
    expect(code).toContain('PRIMARY KEY ("학번")');
    expect(code).toContain('REFERENCES "학과" ("학과코드")');
    expect(code).toContain('UNIQUE ("전화번호")');
    expect(code).toContain('"학과코드" /* 타입 미지정 */');
  });

  it('영어: 제목과 버튼, 예시 화면, 표기 표가 영어로 나오고 영어 용어 줄은 겹치므로 숨긴다', async () => {
    await switchTo('en');
    rememberRoom('room-a', '');
    const { container } = render(<Home />);
    const title = container.querySelector('.home-title')!;
    expect(title.querySelectorAll('br')).toHaveLength(2);
    expect(title.textContent).toBe('Your team and AI, together.From ERD to SQL.Database modeling in one place.');
    expect(screen.getByTestId('create-room').textContent).toBe('Create a new diagram');
    expect(screen.getByTestId('join-button').textContent).toBe('Join');
    expect(screen.getByTestId('recent-room').textContent).toContain('Untitled diagram');
    expect(screen.getByTestId('recent-room').textContent).toContain('Just now');
    expect(screen.getByTestId('forget-room').getAttribute('aria-label')).toBe('Remove Untitled diagram from the list');
    expect(screen.getByTestId('github-link').getAttribute('aria-label')).toBe('Open the GitHub repository');

    fireEvent.click(screen.getByTestId('join-button'));
    expect(screen.getByRole('alert').textContent).toBe('That doesn’t look like a valid room code');

    // 예시 화면 안의 글자와 팀원 이름
    const preview = container.querySelector('.home-pv')!;
    expect(preview.querySelector('.home-pv-title')!.textContent).toBe('Student records');
    expect(preview.querySelector('.home-pv-saved')!.textContent).toBe('Saved');
    expect(preview.querySelector('.home-pv-share')!.textContent).toBe('Share');
    expect([...preview.querySelectorAll('.home-pv-tab')].map((el) => el.textContent)).toEqual(['ERD×', 'Relational model×', 'IE diagram×', 'SQL']);
    const labels = [...preview.querySelectorAll('[data-node-id] text')].map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Student', 'Department', 'Student ID']));
    expect([...preview.querySelectorAll('.home-pv-hcursor > span')].map((el) => el.textContent)).toEqual(['Emma', 'Liam']);
    expect([...preview.querySelectorAll('.home-pv-mates b')].map((el) => el.textContent)).toEqual(['E', 'L', 'N']);

    expect(container.querySelector('.home-sheet-en')).toBeNull();
    expect(container.querySelector('.home-sheet-name')!.textContent).toBe('Entity');
    expect(allText(container)).not.toMatch(HANGUL);
  });

  it('별 수를 아는 영어 화면에서는 개수에 맞는 낱말과 그 언어의 숫자 표기를 쓴다', async () => {
    await switchTo('en');
    localStorage.setItem('chen-erd.stars', JSON.stringify({ count: 1, at: Date.now() }));
    const first = render(<Home />);
    expect(screen.getByTestId('github-link').getAttribute('aria-label')).toBe('Open the GitHub repository, 1 star');
    first.unmount();
    localStorage.setItem('chen-erd.stars', JSON.stringify({ count: 1234, at: Date.now() }));
    await switchTo('de');
    render(<Home />);
    expect(screen.getByTestId('github-link').getAttribute('aria-label')).toBe('GitHub-Repository öffnen, 1.234 Sterne');
  });

  it.each(['ja', 'de', 'zh-CN', 'vi', 'es'] as const)('%s: 화면에 한글이 남지 않고 표기 표에는 영어 용어가 함께 나온다', async (locale) => {
    await switchTo(locale);
    rememberRoom('room-a', '');
    const { container } = render(<Home />);
    expect(allText(container)).not.toMatch(HANGUL);
    expect(container.querySelector('.home-title')!.querySelectorAll('br')).toHaveLength(2);
    expect(container.querySelectorAll('.home-sheet-en').length).toBeGreaterThan(10);
    expect(container.querySelector('.home-brand-name')!.textContent).toBe('modelll');
  });

  it('기능 설명은 세 단계, AI로 그리기, 이용 안내, 지원하는 표기 순서로 놓이고 교육용 표현을 쓰지 않는다', () => {
    const { container } = render(<Home />);
    const sections = [...container.querySelectorAll('.home-wrap > section')];
    expect(sections.map((el) => el.querySelector('h2')?.textContent ?? null)).toEqual([
      '데이터베이스 모델링의 세 단계를 modelll 하나로',
      'AI와 함께 그리기',
      '이용 안내',
      '지원하는 표기',
    ]);
    // 개념적 설계 기능 카드 구역과 네 화면 카드는 없다(히어로가 분할 화면을 보여 준다)
    expect(container.textContent).not.toContain('개념적 설계를 돕는 기능');
    expect(container.textContent).not.toContain('네 화면을 나란히');
    expect(allText(container)).not.toMatch(/수업|학습|익히/);
  });

  it('히어로 예시: 분할 화면에 ERD, 관계 모델 글, IE 표를 그린다', () => {
    render(<Home />);
    const preview = document.querySelector('.home-pv')!;
    expect([...preview.querySelectorAll('.home-pv-tab')].map((el) => el.textContent)).toEqual(['ERD×', '관계 모델×', 'IE 다이어그램×', 'SQL']);
    expect(preview.querySelector('.home-pv-title')!.textContent).toBe('학적 관리');
    expect([...preview.querySelectorAll('[data-node-id] text')].map((el) => el.textContent)).toEqual(
      expect.arrayContaining(['학생', '학과', '소속', '학번', '학과코드']),
    );
    // 관계 모델 글: 줄 번호와 세 줄, 기본키 밑줄
    const rel = screen.getByTestId('home-pv-relational');
    expect([...rel.querySelectorAll('.home-pv-ln')].map((el) => el.textContent)).toEqual(['1', '2', '3']);
    expect([...rel.querySelectorAll('.home-pv-text')].map((el) => el.textContent)).toEqual([
      '학과 (학과코드, 학과명)',
      '학생 (학번, 이름, 학과코드)',
      'Foreign Key (학과코드) references 학과 (학과코드)',
    ]);
    expect([...rel.querySelectorAll('.home-pv-word.is-ul')].map((el) => el.textContent)).toEqual(['학과코드', '학번']);
    expect(rel.querySelector('.home-pv-btn')!.textContent).toBe('밑줄');
    // IE: 표 둘, PK와 FK, 메뉴에서 고른 타입과 NOT NULL
    const ie = screen.getByTestId('home-pv-ie');
    expect([...ie.querySelectorAll('.home-ie-name')].map((el) => el.textContent)).toEqual(['학과', '학생']);
    expect([...ie.querySelectorAll('.home-ie-tag')].map((el) => el.textContent)).toEqual(['PK', 'PK', 'FK']);
    // 타입은 메뉴에서 고른 두 칸만 채워져 있다(누르지 않은 칸은 비어 있다)
    expect([...ie.querySelectorAll('[data-type]')].map((el) => el.getAttribute('data-type'))).toEqual(['CHAR(10)', 'VARCHAR(255)']);
    expect([...ie.querySelectorAll('.home-ie-null')].map((el) => el.textContent)).toEqual(['NOT NULL', 'NOT NULL', 'NOT NULL']);
    expect(preview.querySelector('.home-pv-select')!.textContent).toBe('MySQL');
  });

  it('세 단계 구역: 이름의 l 세 개가 개념적, 논리적, 물리적 설계이고 단계마다 실제 화면 영상이 있다', () => {
    render(<Home />);
    const stages = screen.getByTestId('home-stages');
    const logo = screen.getByTestId('home-story-logo');
    expect(logo.querySelector('.home-story-model')!.textContent + [...logo.querySelectorAll('.home-story-l')].map((el) => el.firstChild!.textContent).join('')).toBe(
      'modelll',
    );
    expect(logo.getAttribute('aria-hidden')).toBe('true');
    expect([...stages.querySelectorAll('.home-stage-name')].map((el) => el.textContent)).toEqual(['1개념적 설계', '2논리적 설계', '3물리적 설계']);
    // 움직임을 쓸 수 없으면 l 세 개가 다 켜져 있다
    expect(stages.querySelectorAll('.home-story-l.is-on')).toHaveLength(3);

    for (const id of ['conceptual', 'logical', 'physical']) {
      const video = screen.getByTestId(`home-stage-video-${id}`).querySelector('video')!;
      expect(video.getAttribute('poster')).toBe(`/landing/${id}.jpg`);
      expect(video.getAttribute('preload')).toBe('none');
      expect(video.hasAttribute('loop')).toBe(true);
      expect(video.hasAttribute('playsinline')).toBe(true);
      expect(video.muted).toBe(true);
      expect([...video.querySelectorAll('source')].map((el) => [el.getAttribute('src'), el.getAttribute('type')])).toEqual([
        [`/landing/${id}.mp4`, 'video/mp4'],
      ]);
    }
    expect(screen.getByTestId('home-stage-video-logical').querySelector('button')!.getAttribute('aria-label')).toBe('논리적 설계 화면 녹화 재생');

    const logical = screen.getByTestId('home-stage-logical');
    expect(logical.textContent).toContain('학생 (학번, 이름, 학과코드)처럼 적습니다');
    expect(logical.textContent).toContain('ERD에서 멋대로 변환하지 않으므로');
    expect(screen.getByTestId('home-stage-physical').textContent).toContain('MySQL, PostgreSQL, Oracle');
  });

  it('세 단계 구역: 고정 구간을 세 칸으로 나눠 들어간 칸이 지금 단계다', () => {
    expect([-0.5, 0, 0.1, 0.333, 0.334, 0.6, 0.667, 0.9, 1, 1.4].map((p) => stageAt(p))).toEqual([0, 0, 0, 0, 1, 1, 2, 2, 2, 2]);
    expect(stageAt(Number.NaN)).toBe(0);
  });

  it('세 단계 구역(넓은 화면): 지금 단계까지만 l이 있고 그 단계 묶음만 보이며 영상은 자동 재생 자리다', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<Home />);
    const stages = screen.getByTestId('home-stages');
    expect(stages.classList.contains('is-pinned')).toBe(true);
    expect(stages.getAttribute('data-stage')).toBe('conceptual');
    // 처음에는 model + l 하나다. 나머지 l은 자리 없이 숨어 있다
    expect(stages.querySelectorAll('.home-story-slot.is-on')).toHaveLength(1);
    expect(stages.querySelectorAll('.home-story-slot')).toHaveLength(3);
    expect([...stages.querySelectorAll('.home-story-stage')].map((el) => el.classList.contains('is-active'))).toEqual([true, false, false]);
    expect(screen.getByTestId('home-stage-logical').getAttribute('aria-hidden')).toBe('true');
    // 자동 재생이므로 재생 버튼이 없다
    expect(stages.querySelectorAll('.home-story-play')).toHaveLength(0);
    expect(stages.querySelector('filter')).not.toBeNull();
  });

  it('영어: 예시 이름과 SQL이 영어로 나온다', async () => {
    await switchTo('en');
    render(<Home />);
    expect(screen.getByTestId('home-pv-relational').textContent).toContain('Student (Student ID, Name, Dept code)');
    expect(screen.getByTestId('home-stage-logical').textContent).toContain('like Student (Student ID, Name, Dept code).');
  });

  it('히어로 예시의 SQL은 IE에서 고른 타입과 NOT NULL을 쓴다', () => {
    const sql = sqlExample((key) => ({ 'home.sample.student': '학생', 'home.sample.studentId': '학번', 'home.sample.name': '이름', 'home.sample.dept': '학과', 'home.sample.deptCode': '학과코드' })[key as string] ?? key);
    expect(sql).toContain('CREATE TABLE `학생` (');
    expect(sql).toContain('`학번` CHAR(10) NOT NULL,');
    expect(sql).toContain('`이름` VARCHAR(255) NOT NULL,');
    expect(sql).toContain('`학과코드` /* 타입 미지정 */,');
    expect(sql).toContain('REFERENCES `학과` (`학과코드`)');
  });

  it('AI 구역: 요청과 글로 쓴 모델, 그 모델대로 그린 다이어그램을 나란히 보여 준다', () => {
    render(<Home />);
    const figure = screen.getByTestId('ai-figure');
    expect(figure.textContent).toContain('수강 관리 ERD를 그려 주세요');
    expect(screen.getByTestId('ai-model-text').textContent).toBe(
      [
        'entity 학생 {',
        '  학번 key',
        '  이름',
        '  전화번호 multi',
        '}',
        'entity 과목 { 과목코드 key, 학점 }',
        'relationship 수강 (학생 M total, 과목 N) { 성적 }',
        '',
      ].join('\n'),
    );
    // 실제 CLI 순서: 형식 읽기, 모델 파일 쓰기, 방 만들기
    expect(figure.textContent).toContain('npx -y modelll syntax');
    expect(figure.textContent).toContain('Write(model.mdl)');
    expect(figure.textContent).toContain('npx -y modelll new model.mdl');
    // 글에 적힌 엔티티 둘, 관계 하나, 속성 여섯과 그 사이의 선
    expect(figure.querySelectorAll('[data-node-id]')).toHaveLength(9);
    expect(figure.querySelectorAll('[data-edge-id]')).toHaveLength(8);
    expect([...figure.querySelectorAll('[data-node-id] text')].map((el) => el.textContent)).toEqual(
      expect.arrayContaining(['학생', '과목', '수강', '학번', '전화번호', '성적']),
    );
  });

  it('AI 구역: CLI와 MCP 두 가지 방법마다 복사할 글이 있고 누르면 클립보드에 넣고 알린다', async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<Home />);
    const toasts = () => useToasts.getState().items.map((t) => [t.message, t.kind]);
    expect(screen.getByTestId('home-way-cli').textContent).toContain('Claude Code, Cursor, Codex');
    // 두 방법을 CLI와 MCP라는 이름으로 나란히 부른다. 로컬 MCP 서버를 추가하는 카드는 없다
    expect(screen.getByTestId('home-ai').querySelector('h3')!.textContent).toBe('AI를 연결하는 두 가지 방법');
    const ways = [...document.querySelectorAll('.home-way')];
    expect(ways.map((el) => el.getAttribute('data-testid'))).toEqual(['home-way-cli', 'home-way-mcp', 'home-migrate']);
    expect(ways.map((el) => el.querySelector('h4')!.textContent)).toEqual(['CLI로 사용하기', 'MCP로 연결하기', '다른 도구의 ERD를 그대로 옮기기']);
    expect(screen.getByTestId('home-way-cli').textContent).toContain('npx -y modelll 명령으로');
    expect(screen.getByTestId('home-way-mcp').textContent).toContain('claude.ai, ChatGPT, Cursor처럼 원격 MCP 서버를 지원하는 AI 도구');
    expect(screen.getByTestId('home-way-mcp').textContent).toContain('원격 MCP 서버나 커넥터로 추가합니다');
    expect(screen.getByTestId('home-ai').textContent).not.toContain('터미널');
    expect(screen.getByTestId('home-ai').textContent).not.toContain('mcpServers');
    expect(screen.getByTestId('home-ai').textContent).not.toContain('modelll mcp');

    const cli = '`npx -y modelll syntax`로 텍스트 형식을 읽고 도서관 대출 관리 ERD를 `npx -y modelll new`로 만들어 방 주소를 알려 주세요.';
    expect(screen.getByTestId('home-cli-text').textContent).toBe(cli);
    fireEvent.click(screen.getByTestId('home-cli-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(cli);

    // 원격 MCP 주소는 지금 열려 있는 사이트를 기준으로 만든다
    expect(screen.getByTestId('home-mcp-text').textContent).toBe(`${location.origin}/mcp`);
    expect(screen.getByTestId('home-mcp-copy').getAttribute('aria-label')).toBe('주소 복사');
    fireEvent.click(screen.getByTestId('home-mcp-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['주소를 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/mcp`);
    // 알림은 첫 화면이 직접 그린다(방 화면에서는 상단 바가 그린다)
    expect(screen.getAllByTestId('toast').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
  });

  it('이용 안내는 가입, 링크, 언어, 보관 기간 네 가지다', () => {
    render(<Home />);
    const facts = screen.getByTestId('home-facts');
    expect([...facts.querySelectorAll('h3')].map((el) => el.textContent)).toEqual(['가입 없이 시작', '링크가 곧 방', '10개 언어', '30일 보관']);
    expect(facts.textContent).toContain('30일 동안 아무도 열지 않은 다이어그램은 자동으로 삭제되므로');
  });

  it('영어: 기능 설명이 영어로 나오고 띄어쓰기가 있는 이름은 모델 글에서 큰따옴표로 감싼다', async () => {
    await switchTo('en');
    const { container } = render(<Home />);
    expect([...container.querySelectorAll('.home-wrap > section')].map((el) => el.querySelector('h2')?.textContent ?? null)).toEqual([
      'All three stages of database modeling, in modelll',
      'Draw with an AI assistant',
      'Good to know',
      'Supported notation',
    ]);
    expect(container.querySelector('.home-lead')!.textContent).toContain('CLI or MCP');
    const model = screen.getByTestId('ai-model-text').textContent!;
    expect(model).toContain('  "Student ID" key\n');
    expect(model).toContain('entity Course { "Course code" key, Credits }\n');
    expect(model).toContain('relationship Enrolls (Student M total, Course N) { Grade }\n');
    expect(screen.getByTestId('home-cli-text').textContent).toBe(
      'Run `npx -y modelll syntax` to read the text format, then create an ERD for a library loan system with `npx -y modelll new` and give me the room URL.',
    );
    expect(modelName('Student')).toBe('Student');
    expect(modelName('a "b"')).toBe('"a \\"b\\""');
  });

  it('상단의 언어 선택으로 바꾸면 새로 고치지 않고 화면과 예시 장면이 그 언어로 다시 그려진다', async () => {
    const { container } = render(<Home />);
    const nav = container.querySelector('.home-nav')!;
    const button = nav.querySelector('[data-testid="language-select"]') as HTMLButtonElement;
    expect(button.closest('.home-lang')).not.toBeNull();
    expect(button.getAttribute('data-locale')).toBe('ko');
    expect(container.querySelector('.home-pv-title')!.textContent).toBe('학적 관리');
    expect(screen.getByTestId('recent-expiry').textContent).toBe('30일 동안 아무도 열지 않은 다이어그램은 자동으로 삭제됩니다');

    fireEvent.click(button);
    fireEvent.click(screen.getByTestId('language-select-option-ja'));
    await waitFor(() => expect(screen.getByTestId('create-room').textContent).toBe('新しいダイアグラムを作成'));
    expect(container.querySelector('.home-pv-title')!.textContent).toBe('学籍管理');
    const stage = screen.getByTestId('home-pv-split');
    // 장면은 같은 모습으로 다시 그려지고 도형 수는 그대로다
    expect(stage.querySelectorAll('[data-node-id]')).toHaveLength(7);
    expect(stage.querySelectorAll('[data-edge-id]')).toHaveLength(6);
    expect([...stage.querySelectorAll('[data-node-id] text')].map((el) => el.textContent)).toContain('学籍番号');
    expect(localStorage.getItem('chen-erd.locale')).toBe('ja');
  });

  it('예시 다이어그램의 글자는 모든 언어에서 도형 폭 안에 들어가는 길이다', async () => {
    for (const locale of LOCALES) {
      const dict = await loadLocale(locale);
      for (const node of NODES) {
        const key = SAMPLE_TEXT[node.id];
        if (!key) continue;
        const text = dict[key] as string;
        expect(text.includes('\n'), `${locale} ${node.id}`).toBe(false);
        // 어림한 글자 폭이 도형 폭의 86%를 넘지 않게 한다(타원과 마름모는 가장자리로 갈수록 좁아진다)
        expect(approximateLineWidth(text), `${locale} ${node.id} "${text}"`).toBeLessThanOrEqual(node.w * 0.86);
      }
      // AI 구역의 예시 다이어그램도 같은 기준을 지킨다
      for (const node of AI_NODES) {
        const text = dict[AI_TEXT[node.id]] as string;
        expect(text.includes('\n'), `${locale} ai ${node.id}`).toBe(false);
        expect(approximateLineWidth(text), `${locale} ai ${node.id} "${text}"`).toBeLessThanOrEqual(node.w * 0.86);
      }
    }
  });
});
