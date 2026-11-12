// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdFile, ErdNode } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import { LOCAL_ORIGIN, addNode, getEdgesMap, getMetaMap, getNodesMap, getTitle, readEdge, readNode, setTitle } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { setLocale } from '../i18n';
import { useUi } from '../state/ui';

// 다른 담당의 모듈은 계약(시그니처)만 흉내 낸다
const ex = vi.hoisted(() => ({
  downloadPng: vi.fn(async (..._a: unknown[]) => true),
  downloadSvg: vi.fn(async (..._a: unknown[]) => true),
  copyPngToClipboard: vi.fn(async (..._a: unknown[]) => true),
  downloadJson: vi.fn((..._a: unknown[]) => undefined),
  parseErdFile: vi.fn((_text: string): unknown => ({})),
  importErdFile: vi.fn((..._a: unknown[]): string[] => []),
  safeFilename: vi.fn((t: string) => t.trim() || 'erd'),
  zoomToRect: vi.fn((..._a: unknown[]) => undefined),
  issueCount: { errors: 0, warnings: 0 },
}));
vi.mock('../export/exporters', () => ({
  downloadPng: ex.downloadPng,
  downloadSvg: ex.downloadSvg,
  copyPngToClipboard: ex.copyPngToClipboard,
  downloadJson: ex.downloadJson,
  parseErdFile: ex.parseErdFile,
  importErdFile: ex.importErdFile,
  safeFilename: ex.safeFilename,
}));
vi.mock('../canvas/ViewportControls', () => ({ zoomToRect: ex.zoomToRect }));
vi.mock('../presence/Presence', () => ({ UserAvatars: () => <div data-testid="avatars" /> }));
vi.mock('./IssuesPanel', () => ({ useIssueCount: () => ex.issueCount }));

import { TopBar } from './TopBar';
import { useToasts } from './toast';

type Handler = (arg: never) => void;

function makeRoom() {
  const doc = new Y.Doc();
  const handlers = new Map<string, Set<Handler>>();
  const provider = {
    wsconnected: true,
    synced: true,
    on: (name: string, fn: Handler) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(fn);
    },
    off: (name: string, fn: Handler) => handlers.get(name)?.delete(fn),
  };
  const emit = (name: string, arg: unknown) => {
    for (const fn of handlers.get(name) ?? []) (fn as (a: unknown) => void)(arg);
  };
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const room = {
    id: 'testroom',
    doc,
    provider,
    awareness: {},
    undo: new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 }),
    nodes: new ElementStore(nodesMap, readNode),
    edges: new ElementStore(edgesMap, readEdge),
    setPresence: () => undefined,
    destroy: () => undefined,
  } as unknown as Room;
  return { room, emit, provider };
}

const NODE: ErdNode = { id: 'n1', kind: 'entity', x: 10, y: 20, w: 120, h: 60, text: '학생' };

function renderBar(room: Room) {
  return render(
    <RoomContext.Provider value={room}>
      <TopBar />
    </RoomContext.Provider>,
  );
}
const toasts = () => useToasts.getState().items.map((t) => [t.message, t.kind]);

beforeEach(() => {
  useUi.getState().reset();
  useToasts.getState().clear();
  ex.issueCount = { errors: 0, warnings: 0 };
  for (const v of Object.values(ex)) if (typeof v === 'function' && 'mockClear' in v) v.mockClear();
  history.replaceState(null, '', '/r/testroom');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TopBar 제목', () => {
  it('Enter와 blur에서 저장하고, 80자로 자른다', () => {
    const { room } = makeRoom();
    renderBar(room);
    const input = screen.getByTestId('title-input') as HTMLInputElement;
    expect(input.placeholder).toBe('제목 없는 다이어그램');
    expect(input.maxLength).toBe(80);

    input.focus();
    fireEvent.change(input, { target: { value: '  수강 신청  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(getTitle(room.doc)).toBe('수강 신청');
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe('수강 신청');

    input.focus();
    fireEvent.change(input, { target: { value: '가'.repeat(120) } });
    act(() => input.blur());
    expect(getTitle(room.doc)).toHaveLength(80);
  });

  it('한글 조합 중의 Enter는 무시하고, Esc는 취소한다', () => {
    const { room } = makeRoom();
    setTitle(room.doc, '원래 제목');
    renderBar(room);
    const input = screen.getByTestId('title-input') as HTMLInputElement;

    input.focus();
    fireEvent.change(input, { target: { value: '바꾸는 중' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(getTitle(room.doc)).toBe('원래 제목');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(getTitle(room.doc)).toBe('원래 제목');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getTitle(room.doc)).toBe('원래 제목');
    expect(input.value).toBe('원래 제목');
    expect(document.activeElement).not.toBe(input);
  });

  it('다른 사람이 제목을 바꾸면 입력 중이 아닐 때만 갱신한다', () => {
    const { room } = makeRoom();
    renderBar(room);
    const input = screen.getByTestId('title-input') as HTMLInputElement;
    act(() => getMetaMap(room.doc).set('title', '원격 제목'));
    expect(input.value).toBe('원격 제목');

    input.focus();
    fireEvent.change(input, { target: { value: '내가 쓰는 중' } });
    act(() => getMetaMap(room.doc).set('title', '또 바뀜'));
    expect(input.value).toBe('내가 쓰는 중');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('또 바뀜');
  });

  it('입력창의 키 입력이 window까지 올라가지 않는다', () => {
    const { room } = makeRoom();
    renderBar(room);
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(screen.getByTestId('title-input'), { key: 'Backspace', code: 'Backspace' });
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('TopBar 연결 상태', () => {
  it('상태에 따라 글자와 data-status가 바뀐다', () => {
    const { room, emit } = makeRoom();
    renderBar(room);
    const el = screen.getByTestId('connection-status');
    expect(el.dataset.status).toBe('connected');
    expect(el.textContent).toBe('저장됨');
    expect(el.title).not.toBe('');

    act(() => emit('status', { status: 'disconnected' }));
    expect(el.dataset.status).toBe('disconnected');
    expect(el.textContent).toBe('연결 끊김');
    expect(el.title).toBe('다시 연결되면 변경 내용이 자동으로 합쳐집니다');

    act(() => emit('status', { status: 'connecting' }));
    expect(el.dataset.status).toBe('connecting');
    expect(el.textContent).toBe('연결 중');

    // 연결됐지만 아직 서버 문서를 다 받지 못한 동안은 저장됨으로 보여 주지 않는다
    act(() => {
      emit('sync', false);
      emit('status', { status: 'connected' });
    });
    expect(el.dataset.status).toBe('connecting');
    act(() => emit('sync', true));
    expect(el.dataset.status).toBe('connected');
  });
});

describe('TopBar 버튼', () => {
  it('실행 취소와 다시 실행이 스택 상태를 따른다', () => {
    const { room } = makeRoom();
    renderBar(room);
    const undoBtn = screen.getByTestId('undo-button') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('redo-button') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(undoBtn.title).toMatch(/Z/);

    act(() => addNode(room.doc, NODE));
    expect(undoBtn.disabled).toBe(false);
    fireEvent.click(undoBtn);
    expect(room.nodes.getSnapshot()).toHaveLength(0);
    expect(redoBtn.disabled).toBe(false);
    fireEvent.click(redoBtn);
    expect(room.nodes.getSnapshot()).toHaveLength(1);
  });

  it('검증 배지는 0이면 없고, 버튼들이 패널을 여닫는다', () => {
    const { room } = makeRoom();
    const first = renderBar(room);
    expect(screen.queryByTestId('issues-badge-error')).toBeNull();
    expect(screen.queryByTestId('issues-badge-warning')).toBeNull();
    first.unmount();

    ex.issueCount = { errors: 2, warnings: 0 };
    renderBar(room);
    expect(screen.getByTestId('issues-badge-error').textContent).toBe('2');
    expect(screen.queryByTestId('issues-badge-warning')).toBeNull();

    const issues = screen.getByTestId('issues-button');
    fireEvent.click(issues);
    expect(useUi.getState().panels.issues).toBe(true);
    expect(issues.className).toContain('is-active');
    // 표기법 안내는 상단 버튼이 아니라 도움말 창의 탭에 있다
    expect(screen.queryByTestId('legend-button')).toBeNull();
    fireEvent.click(screen.getByTestId('help-button'));
    expect(useUi.getState().panels.help).toBe(true);
    expect(screen.getByTestId('avatars')).toBeTruthy();
  });

  it('홈 버튼은 처음 화면으로 간다', () => {
    const { room } = makeRoom();
    renderBar(room);
    // 첫 화면과 같은 로고 표식을 제품 이름 앞에 둔다
    const mark = screen.getByTestId('home-button').querySelector('[data-testid="logo-mark"]')!;
    expect(mark.getAttribute('stroke')).toBe('#2F6BFF');
    expect([...mark.children].map((el) => el.tagName.toLowerCase())).toEqual(['path', 'rect', 'rect', 'ellipse']);
    fireEvent.click(screen.getByTestId('home-button'));
    expect(location.pathname).toBe('/');
  });
});

describe('TopBar 내보내기', () => {
  it('노드가 없으면 그림 내보내기는 비활성화, JSON은 가능', () => {
    const { room } = makeRoom();
    renderBar(room);
    expect(screen.queryByTestId('export-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('export-button'));
    expect((screen.getByTestId('export-png') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('export-copy-png') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('export-svg') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('export-json') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('import-json') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('export-menu').textContent).toContain('PNG로 저장');
    expect(screen.getByTestId('export-menu').textContent).toContain('JSON 불러오기…');
  });

  it('바깥을 누르거나 Esc를 누르면 닫힌다', () => {
    const { room } = makeRoom();
    renderBar(room);
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.pointerDown(screen.getByTestId('export-menu'));
    expect(screen.queryByTestId('export-menu')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('export-menu')).toBeNull();

    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('export-menu')).toBeNull();
  });

  it('제목으로 파일 이름을 만들고 결과를 알린다', async () => {
    const { room } = makeRoom();
    setTitle(room.doc, '도서관');
    addNode(room.doc, NODE);
    renderBar(room);

    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-png'));
    await waitFor(() => expect(toasts()).toContainEqual(['PNG를 저장했습니다', 'info']));
    expect(ex.downloadPng.mock.calls[0][2]).toBe('도서관.png');
    expect(ex.downloadPng.mock.calls[0][0]).toEqual([NODE]);
    expect(screen.queryByTestId('export-menu')).toBeNull();

    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-copy-png'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사했습니다', 'info']));

    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-svg'));
    await waitFor(() => expect(ex.downloadSvg).toHaveBeenCalled());
    expect(ex.downloadSvg.mock.calls[0][2]).toBe('도서관.svg');

    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-json'));
    expect(ex.downloadJson).toHaveBeenCalledWith(room.doc, '도서관.json');
  });

  it('실패(false 또는 예외)는 error 알림으로 알린다', async () => {
    const { room } = makeRoom();
    addNode(room.doc, NODE);
    renderBar(room);

    ex.copyPngToClipboard.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-copy-png'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사하지 못했습니다', 'error']));

    ex.downloadPng.mockRejectedValueOnce(new Error('그림이 너무 큽니다'));
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-png'));
    await waitFor(() => expect(toasts()).toContainEqual(['그림이 너무 큽니다', 'error']));
  });
});

describe('TopBar JSON 불러오기', () => {
  const FILE: ErdFile = { format: 'chen-erd', version: 1, title: '불러온 것', nodes: [{ ...NODE, id: 'f1' }], edges: [] };
  const pick = (text: string) => {
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    expect(input.accept).toBe('.json,application/json');
    const file = new File([text], 'backup.json', { type: 'application/json' });
    if (typeof file.text !== 'function') Object.defineProperty(file, 'text', { value: async () => text });
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('문서가 비어 있으면 묻지 않고 불러온 뒤 선택하고 화면을 맞춘다', async () => {
    const { room } = makeRoom();
    ex.parseErdFile.mockReturnValueOnce(FILE);
    ex.importErdFile.mockImplementationOnce((doc: unknown) => {
      addNode(doc as Y.Doc, { ...NODE, id: 'new1', x: 100, y: 200 });
      return ['new1'];
    });
    renderBar(room);
    pick('{}');
    await waitFor(() => expect(ex.importErdFile).toHaveBeenCalled());
    expect(ex.importErdFile.mock.calls[0][2]).toBe('replace');
    expect(screen.queryByTestId('import-dialog')).toBeNull();
    expect(useUi.getState().selection).toEqual(['new1']);
    expect(ex.zoomToRect.mock.calls[0][0]).toEqual({ x: 100, y: 200, w: 120, h: 60 });
    expect(toasts()).toContainEqual(['도형 1개를 불러왔습니다', 'info']);
  });

  it('내용이 있으면 추가/덮어쓰기/취소를 묻는다', async () => {
    const { room } = makeRoom();
    addNode(room.doc, NODE);
    ex.parseErdFile.mockReturnValue(FILE);
    renderBar(room);

    pick('{}');
    const dialog = await screen.findByTestId('import-dialog');
    expect(dialog.textContent).toContain('기존 내용에 추가');
    expect(dialog.textContent).toContain('기존 내용을 지우고 불러오기');
    fireEvent.click(screen.getByTestId('import-cancel'));
    expect(screen.queryByTestId('import-dialog')).toBeNull();
    expect(ex.importErdFile).not.toHaveBeenCalled();

    pick('{}');
    await screen.findByTestId('import-dialog');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('import-dialog')).toBeNull();
    expect(ex.importErdFile).not.toHaveBeenCalled();

    pick('{}');
    await screen.findByTestId('import-dialog');
    fireEvent.click(screen.getByTestId('import-merge'));
    expect(ex.importErdFile.mock.calls[0][2]).toBe('merge');
    expect(screen.queryByTestId('import-dialog')).toBeNull();

    pick('{}');
    await screen.findByTestId('import-dialog');
    fireEvent.click(screen.getByTestId('import-replace'));
    expect(ex.importErdFile.mock.calls[1][2]).toBe('replace');
    ex.parseErdFile.mockReset();
  });

  it('파싱 오류는 그 메시지를 error 알림으로 보여 준다', async () => {
    const { room } = makeRoom();
    ex.parseErdFile.mockImplementationOnce(() => {
      throw new Error('modelll 파일이 아닙니다');
    });
    renderBar(room);
    pick('not json');
    await waitFor(() => expect(toasts()).toContainEqual(['modelll 파일이 아닙니다', 'error']));
    expect(ex.importErdFile).not.toHaveBeenCalled();
  });
});

describe('TopBar 공유', () => {
  it('링크를 클립보드에 복사하고 알린다', async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, platform: 'MacIntel', userAgent: 'x' });
    const { room } = makeRoom();
    renderBar(room);
    const btn = screen.getByTestId('share-button');
    expect(btn.className).toContain('btn-primary');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(toasts()).toContainEqual(['링크를 복사했습니다. 이 링크를 받은 사람은 누구나 함께 편집할 수 있습니다', 'info']),
    );
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/r/testroom`);
    expect(screen.queryByTestId('share-popover')).toBeNull();
  });

  it('클립보드를 못 쓰면 링크를 입력창으로 보여 주고, Esc로 닫힌다', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'x' });
    const { room } = makeRoom();
    renderBar(room);
    fireEvent.click(screen.getByTestId('share-button'));
    const input = (await screen.findByTestId('share-link-input')) as HTMLInputElement;
    expect(input.value).toBe(`${location.origin}/r/testroom`);
    expect(input.readOnly).toBe(true);
    expect(toasts()).toEqual([]);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('share-popover')).toBeNull();

    // 복사가 거부된 경우에도 같은 팝오버를 보여 준다
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } });
    fireEvent.click(screen.getByTestId('share-button'));
    await screen.findByTestId('share-popover');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('share-popover')).toBeNull();
  });
});

describe('TopBar AI로 편집', () => {
  const stubClipboard = () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, platform: 'MacIntel', userAgent: 'x' });
    return writeText;
  };
  const ROOM_URL = () => `${location.origin}/r/testroom`;

  it('공유 버튼 앞에 있고, 누르면 CLI와 MCP 두 가지 방법을 보여 주며 다시 누르면 닫힌다', () => {
    const { room } = makeRoom();
    renderBar(room);
    const btn = screen.getByTestId('ai-button');
    expect(btn.textContent).toBe('AI로 편집');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    // 내보내기와 공유 사이에 놓인다
    const order = [...document.querySelectorAll('.topbar-right [data-testid$="-button"]')].map((el) => el.getAttribute('data-testid'));
    expect(order.slice(order.indexOf('export-button'), order.indexOf('share-button') + 1)).toEqual(['export-button', 'ai-button', 'share-button']);
    expect(screen.queryByTestId('ai-popover')).toBeNull();

    fireEvent.click(btn);
    const pop = screen.getByTestId('ai-popover');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(pop.getAttribute('aria-labelledby')!)!.textContent).toBe('AI로 이 다이어그램 편집하기');
    // 두 방법을 CLI와 MCP라는 이름으로 나란히 부른다. 로컬 MCP 서버를 추가하는 방법은 없다
    expect([...pop.querySelectorAll('.topbar-ai-way')].map((el) => el.getAttribute('data-testid'))).toEqual(['ai-way-cli', 'ai-way-mcp']);
    expect([...pop.querySelectorAll('.topbar-ai-name')].map((el) => el.textContent)).toEqual(['CLI로 사용하기', 'MCP로 연결하기']);
    expect(screen.getByTestId('ai-way-cli').textContent).toContain('Claude Code, Cursor, Codex처럼 명령을 실행할 수 있는 AI');
    expect(screen.getByTestId('ai-way-cli').textContent).toContain('npx -y modelll 명령으로');
    expect(screen.getByTestId('ai-way-mcp').textContent).toContain('claude.ai, ChatGPT, Cursor처럼 원격 MCP 서버를 지원하는 AI 도구');
    expect(screen.getByTestId('ai-way-mcp').textContent).toContain('원격 MCP 서버나 커넥터로 추가합니다');
    expect(pop.textContent).not.toContain('터미널');
    expect(pop.textContent).not.toContain('mcpServers');
    expect(pop.textContent).not.toContain('modelll mcp');
    // 원격 MCP 주소는 지금 열려 있는 사이트를 기준으로 만든다
    expect(screen.getByTestId('ai-mcp-text').textContent).toBe(`${location.origin}/mcp`);
    // 열리면 가장 많이 쓰는 지시문 복사 버튼이 포커스를 받는다
    expect(document.activeElement).toBe(screen.getByTestId('ai-prompt-copy'));

    fireEvent.click(btn);
    expect(screen.queryByTestId('ai-popover')).toBeNull();
  });

  it('지시문에는 이 방의 주소와 syntax, pull, push 명령이 들어 있고 바꿀 내용을 적는 자리에서 끝난다', () => {
    const { room } = makeRoom();
    renderBar(room);
    fireEvent.click(screen.getByTestId('ai-button'));
    expect(screen.getByTestId('ai-prompt-text').textContent).toBe(
      [
        `이 modelll ER 다이어그램을 고쳐 주세요. 방 주소는 ${ROOM_URL()} 입니다.`,
        '먼저 `npx -y modelll syntax`를 실행해 텍스트 형식을 읽어 주세요.',
        `그다음 \`npx -y modelll pull ${ROOM_URL()} -o model.mdl\`로 현재 다이어그램을 받아 파일을 고치고, \`npx -y modelll push ${ROOM_URL()} model.mdl\`로 방에 반영해 주세요.`,
        '바꿀 내용: ',
      ].join('\n'),
    );
  });

  it('복사 버튼마다 해당 글을 클립보드에 넣고 알림으로 알린다', async () => {
    const writeText = stubClipboard();
    const { room } = makeRoom();
    renderBar(room);
    fireEvent.click(screen.getByTestId('ai-button'));
    const prompt = screen.getByTestId('ai-prompt-text').textContent!;

    fireEvent.click(screen.getByTestId('ai-prompt-copy'));
    await waitFor(() =>
      expect(toasts()).toContainEqual(['지시문을 복사했습니다. AI에게 붙여 넣고 바꿀 내용을 이어서 적어 주세요', 'info']),
    );
    expect(writeText).toHaveBeenLastCalledWith(prompt);
    expect(prompt).toContain(ROOM_URL());

    fireEvent.click(screen.getByTestId('ai-mcp-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['주소를 복사했습니다', 'info']));
    expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/mcp`);
    // 복사한 뒤에도 다른 것을 이어서 복사할 수 있게 열어 둔다
    expect(screen.queryByTestId('ai-popover')).not.toBeNull();
    expect(screen.getByTestId('ai-mcp-copy').getAttribute('aria-label')).toBe('주소 복사');
    // 복사할 것은 지시문과 주소 둘뿐이다
    expect(screen.getByTestId('ai-popover').querySelectorAll('button')).toHaveLength(2);
  });

  it('클립보드를 쓸 수 없으면 error 알림으로 알리고 글은 직접 고를 수 있게 남겨 둔다', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'x' });
    const { room } = makeRoom();
    renderBar(room);
    fireEvent.click(screen.getByTestId('ai-button'));
    fireEvent.click(screen.getByTestId('ai-prompt-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사하지 못했습니다', 'error']));
    expect(screen.getByTestId('ai-prompt-text').textContent).toContain('npx -y modelll pull');

    // 복사가 거부된 경우도 같다
    useToasts.getState().clear();
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } });
    fireEvent.click(screen.getByTestId('ai-mcp-copy'));
    await waitFor(() => expect(toasts()).toContainEqual(['클립보드에 복사하지 못했습니다', 'error']));
  });

  it('Esc로 닫으면 포커스가 버튼으로 돌아가고, 바깥을 누르면 닫힌다', () => {
    const { room } = makeRoom();
    renderBar(room);
    const btn = screen.getByTestId('ai-button');
    fireEvent.click(btn);
    fireEvent.pointerDown(screen.getByTestId('ai-popover'));
    expect(screen.queryByTestId('ai-popover')).not.toBeNull();

    fireEvent.keyDown(screen.getByTestId('ai-prompt-copy'), { key: 'Escape' });
    expect(screen.queryByTestId('ai-popover')).toBeNull();
    expect(document.activeElement).toBe(btn);

    fireEvent.click(btn);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('ai-popover')).toBeNull();
  });

  it('Tab으로 팝오버 밖으로 나가면 닫힌다', () => {
    const { room } = makeRoom();
    renderBar(room);
    fireEvent.click(screen.getByTestId('ai-button'));
    // 팝오버 안에서 옮겨 다니는 동안에는 열려 있다
    fireEvent.blur(screen.getByTestId('ai-prompt-copy'), { relatedTarget: screen.getByTestId('ai-mcp-copy') });
    expect(screen.queryByTestId('ai-popover')).not.toBeNull();
    fireEvent.blur(screen.getByTestId('ai-mcp-copy'), { relatedTarget: screen.getByTestId('share-button') });
    expect(screen.queryByTestId('ai-popover')).toBeNull();
  });

  it('버튼과 팝오버 안의 키 입력이 window까지 올라가지 않는다(캔버스 단축키로 새지 않는다)', () => {
    const { room } = makeRoom();
    renderBar(room);
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    window.addEventListener('keyup', spy);
    fireEvent.keyDown(screen.getByTestId('ai-button'), { key: 'e', code: 'KeyE' });
    fireEvent.click(screen.getByTestId('ai-button'));
    for (const id of ['ai-prompt-copy', 'ai-prompt-text', 'ai-mcp-copy']) {
      fireEvent.keyDown(screen.getByTestId(id), { key: 'e', code: 'KeyE' });
      fireEvent.keyUp(screen.getByTestId(id), { key: 'e', code: 'KeyE' });
      fireEvent.keyDown(screen.getByTestId(id), { key: 'Backspace', code: 'Backspace' });
    }
    window.removeEventListener('keydown', spy);
    window.removeEventListener('keyup', spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('영어 화면에서는 지시문과 설명이 영어로 나오고 명령은 그대로다', async () => {
    const writeText = stubClipboard();
    await act(async () => {
      await setLocale('en', { persist: false });
    });
    try {
      const { room } = makeRoom();
      renderBar(room);
      const btn = screen.getByTestId('ai-button');
      expect(btn.textContent).toBe('Use with AI');
      fireEvent.click(btn);
      const prompt = [
        `Please edit this modelll ER diagram: ${ROOM_URL()}`,
        'First run `npx -y modelll syntax` to read the text format.',
        `Then fetch the current diagram with \`npx -y modelll pull ${ROOM_URL()} -o model.mdl\`, edit the file, and apply it with \`npx -y modelll push ${ROOM_URL()} model.mdl\`.`,
        'What to change: ',
      ].join('\n');
      expect(screen.getByTestId('ai-prompt-text').textContent).toBe(prompt);
      expect([...screen.getByTestId('ai-popover').querySelectorAll('.topbar-ai-name')].map((el) => el.textContent)).toEqual([
        'Use the CLI',
        'Connect over MCP',
      ]);
      expect(screen.getByTestId('ai-way-cli').textContent).toContain('edits the diagram with npx -y modelll commands');
      expect(screen.getByTestId('ai-way-mcp').textContent).toContain('Add this URL as a remote MCP server or connector');
      expect(screen.getByTestId('ai-mcp-text').textContent).toBe(`${location.origin}/mcp`);
      expect(screen.getByTestId('ai-popover').textContent).not.toMatch(/[ㄱ-ㆎ가-힣]/);
      fireEvent.click(screen.getByTestId('ai-prompt-copy'));
      await waitFor(() =>
        expect(toasts()).toContainEqual(['Prompt copied. Paste it into your assistant and add what you want changed', 'info']),
      );
      expect(writeText).toHaveBeenLastCalledWith(prompt);
    } finally {
      await act(async () => {
        await setLocale('ko', { persist: false });
      });
    }
  });
});

describe('Toaster', () => {
  it('TopBar가 알림을 한 번 그린다', async () => {
    const { room } = makeRoom();
    renderBar(room);
    const { toast } = await import('./toast');
    act(() => toast('알림입니다'));
    const el = screen.getByTestId('toast');
    expect(el.textContent).toBe('알림입니다');
    expect(document.querySelectorAll('.toast-stack')).toHaveLength(1);
    act(() => toast('오류입니다', 'error'));
    expect(screen.getAllByTestId('toast')[1].dataset.kind).toBe('error');
  });
});
