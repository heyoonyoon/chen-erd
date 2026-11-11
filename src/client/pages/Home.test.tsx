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
import { NODES, SAMPLE_TEXT } from './HomePreview';

const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

/** 보이는 글자와 title, aria-label, placeholder를 모두 모은다. 언어 목록의 언어 이름(한국어 등)은 뺀다 */
function allText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('option').forEach((o) => o.remove());
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
    // 제품 화면 예시는 장면의 마지막 모습인 완성된 다이어그램이다
    const stage = container.querySelector('.home-pv-stage')!;
    expect(stage.querySelectorAll('[data-node-id]')).toHaveLength(13);
    expect(stage.querySelectorAll('[data-edge-id]')).toHaveLength(12);
    expect(stage.querySelector('.is-new')).toBeNull();
    expect(stage.querySelectorAll('.home-cursor')).toHaveLength(2);
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
    expect(document.title).toBe('modelll | 팀원과 함께 그리는 Chen 표기법 ERD 도구');
    expect(container.querySelector('.home-brand-name')!.textContent).toBe('modelll');
    // 옛 이름이 화면에 남아 있지 않다(Chen 표기법이라는 말은 남는다)
    expect(container.textContent).not.toContain('Chen ERD');
    expect(container.querySelector('.home-lead')!.textContent).toContain('Chen 표기법');
    // 처음 온 사람이 머리글에서 AI가 함께 그릴 수 있다는 것을 알게 한다
    expect(container.querySelector('.home-lead')!.textContent).toContain('Claude나 ChatGPT 같은 AI');
  });

  it('한국어 제목은 두 줄이고 둘째 줄은 ERD다', () => {
    const { container } = render(<Home />);
    const title = container.querySelector('.home-title')!;
    expect(title.querySelectorAll('br')).toHaveLength(1);
    expect(title.textContent).toBe('팀원과 함께 그리는ERD');
  });

  it('표기 표의 속성 줄은 네 가지이고 유도 속성은 없다', () => {
    const { container } = render(<Home />);
    const rows = container.querySelectorAll('.home-sheet-row');
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
    // 제품 화면 예시의 도구 줄에도 유도 속성 도구가 없다(선택 도구 + 도형 8개)
    expect(container.querySelectorAll('.home-pv-tool')).toHaveLength(9);
  });

  it('영어: 제목과 버튼, 예시 화면, 표기 표가 영어로 나오고 영어 용어 줄은 겹치므로 숨긴다', async () => {
    await switchTo('en');
    rememberRoom('room-a', '');
    const { container } = render(<Home />);
    const title = container.querySelector('.home-title')!;
    expect(title.querySelectorAll('br')).toHaveLength(1);
    expect(title.textContent).toBe('Draw ER diagramswith your team');
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
    expect(preview.querySelector('.home-pv-title')!.textContent).toBe('Course enrollment');
    expect(preview.querySelector('.home-pv-saved')!.textContent).toBe('Saved');
    expect(preview.querySelector('.home-pv-share')!.textContent).toBe('Share');
    const labels = [...preview.querySelectorAll('[data-node-id] text')].map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Student', 'Course', 'Enrolls', 'Student ID', 'Section no.']));
    expect([...preview.querySelectorAll('.home-cursor-name')].map((el) => el.textContent)).toEqual(['Emma', 'Liam']);
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
    expect(container.querySelector('.home-title')!.querySelectorAll('br')).toHaveLength(1);
    expect(container.querySelectorAll('.home-sheet-en').length).toBeGreaterThan(10);
    expect(container.querySelector('.home-brand-name')!.textContent).toBe('modelll');
  });

  it('기능 설명은 AI로 그리기, 주요 기능, 이용 안내, 지원하는 표기 순서로 놓인다', () => {
    const { container } = render(<Home />);
    const sections = [...container.querySelectorAll('.home-wrap > section')];
    expect(sections.map((el) => el.querySelector('h2')!.textContent)).toEqual(['AI와 함께 그리기', '주요 기능', '이용 안내', '지원하는 표기']);
    // 예전의 한 줄짜리 소개는 남아 있지 않다
    expect(container.textContent).not.toContain('한 캔버스, 여러 포인터');
    expect(container.textContent).not.toContain('보고서에 넣는 그림');
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
    expect(figure.textContent).toContain('npx -y modelll push');
    // 글에 적힌 엔티티 둘, 관계 하나, 속성 여섯과 그 사이의 선
    expect(figure.querySelectorAll('[data-node-id]')).toHaveLength(9);
    expect(figure.querySelectorAll('[data-edge-id]')).toHaveLength(8);
    expect([...figure.querySelectorAll('[data-node-id] text')].map((el) => el.textContent)).toEqual(
      expect.arrayContaining(['학생', '과목', '수강', '학번', '전화번호', '성적']),
    );
  });

  it('AI 구역: 세 가지 방법마다 복사할 글이 있고 누르면 클립보드에 넣고 알린다', async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<Home />);
    const toasts = () => useToasts.getState().items.map((t) => [t.message, t.kind]);
    expect(screen.getByTestId('home-way-cli').textContent).toContain('Claude Code, Cursor, Codex');
    expect(screen.getByTestId('home-way-remote').textContent).toContain('claude.ai나 ChatGPT의 커넥터 설정');

    const cli = '`npx -y modelll syntax`로 텍스트 형식을 읽고 도서관 대출 관리 ERD를 `npx -y modelll new`로 만들어 방 주소를 알려 주세요.';
    expect(screen.getByTestId('home-cli-text').textContent).toBe(cli);
    fireEvent.click(screen.getByTestId('home-cli-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(cli);

    expect(screen.getByTestId('home-local-text').textContent).toBe('claude mcp add modelll -- npx -y modelll mcp');
    fireEvent.click(screen.getByTestId('home-local-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['명령을 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith('claude mcp add modelll -- npx -y modelll mcp');

    // 원격 MCP 주소는 지금 열려 있는 사이트를 기준으로 만든다
    expect(screen.getByTestId('home-remote-text').textContent).toBe(`${location.origin}/mcp`);
    fireEvent.click(screen.getByTestId('home-remote-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['주소를 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/mcp`);
    // 알림은 첫 화면이 직접 그린다(방 화면에서는 상단 바가 그린다)
    expect(screen.getAllByTestId('toast').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
  });

  it('주요 기능은 공동 편집, 검증, 내보내기 세 가지를 화면 토막과 함께 설명한다', () => {
    render(<Home />);
    const collab = screen.getByTestId('home-feature-collab');
    expect(collab.querySelector('h3')!.textContent).toBe('실시간 공동 편집');
    expect(collab.textContent).toContain('15명까지');
    // 접속자 셋과 나머지 인원을 합치면 방의 정원이다
    expect([...collab.querySelectorAll('.home-fx-mates b')].map((el) => el.textContent)).toEqual(['지', '서', '도', '+12']);
    expect([...collab.querySelectorAll('.home-cursor-name')].map((el) => el.textContent)).toEqual(['지민', '서연']);

    const validation = screen.getByTestId('home-feature-validation');
    expect(validation.querySelector('h3')!.textContent).toBe('표기법 검증');
    // 화면 토막의 문장은 방 화면의 검증 패널이 쓰는 문장 그대로다
    expect([...validation.querySelectorAll('.home-fx-issue')].map((el) => el.textContent)).toEqual([
      "'분반' 약한 엔티티가 식별 관계(이중 마름모)에 연결되어 있지 않습니다",
      "'과목' 엔티티에 식별자(키 속성)가 없습니다",
      "'학생' 엔티티와 '수강' 관계 사이의 선에 카디널리티(1, M, N)가 없습니다",
    ]);
    expect(validation.querySelector('.home-fx-panel-head')!.textContent).toBe('검증오류 1개경고 2개');

    const exporting = screen.getByTestId('home-feature-export');
    expect(exporting.querySelector('h3')!.textContent).toBe('내보내기');
    expect([...exporting.querySelectorAll('.home-fx-menu-text')].map((el) => el.textContent)).toEqual([
      'PNG로 저장',
      'PNG 복사',
      'SVG로 저장',
      'JSON 백업 저장',
    ]);
    // 화면 토막은 장식이라 보조 기술에는 설명 글만 읽힌다
    expect(collab.querySelector('.home-feature-visual')!.getAttribute('aria-hidden')).toBe('true');
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
    expect([...container.querySelectorAll('.home-wrap > section')].map((el) => el.querySelector('h2')!.textContent)).toEqual([
      'Draw with an AI assistant',
      'Key features',
      'Good to know',
      'Supported notation',
    ]);
    expect(container.querySelector('.home-lead')!.textContent).toContain('AI assistant');
    const model = screen.getByTestId('ai-model-text').textContent!;
    expect(model).toContain('  "Student ID" key\n');
    expect(model).toContain('entity Course { "Course code" key, Credits }\n');
    expect(model).toContain('relationship Enrolls (Student M total, Course N) { Grade }\n');
    expect(screen.getByTestId('home-cli-text').textContent).toBe(
      'Run `npx -y modelll syntax` to read the text format, then create an ERD for a library loan system with `npx -y modelll new` and give me the room URL.',
    );
    expect(screen.getByTestId('home-feature-validation').querySelector('.home-fx-issue')!.textContent).toBe(
      'Weak entity “Section” isn’t connected to an identifying relationship (double diamond).',
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
    expect(container.querySelector('.home-pv-title')!.textContent).toBe('수강 관리');
    expect(screen.getByTestId('recent-expiry').textContent).toBe('30일 동안 아무도 열지 않은 다이어그램은 자동으로 삭제됩니다');

    fireEvent.click(button);
    fireEvent.click(screen.getByTestId('language-select-option-ja'));
    await waitFor(() => expect(screen.getByTestId('create-room').textContent).toBe('新しいダイアグラムを作成'));
    expect(container.querySelector('.home-pv-title')!.textContent).toBe('履修管理');
    const stage = container.querySelector('.home-pv-stage')!;
    // 장면은 완성된 모습으로 다시 그려지고 도형 수는 그대로다
    expect(stage.querySelectorAll('[data-node-id]')).toHaveLength(13);
    expect(stage.querySelectorAll('[data-edge-id]')).toHaveLength(12);
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
