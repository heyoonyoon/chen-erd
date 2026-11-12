import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** 이름이 저장된 상태로 새 접속자를 만든다(이름 입력 창이 뜨지 않게). */
async function join(browser: Browser, id: string, name: string, color: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([i, n, c]) => {
      if (!localStorage.getItem('chen-erd.identity')) localStorage.setItem('chen-erd.identity', JSON.stringify({ id: i, name: n, color: c }));
    },
    [id, name, color],
  );
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return { ctx, page: await ctx.newPage() };
}

/** 캔버스 영역 기준 좌표를 화면 좌표로 바꾼다. */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('canvas-svg').boundingBox();
  if (!box) throw new Error('캔버스를 찾지 못했습니다');
  return { x: box.x + x, y: box.y + y };
}

async function place(page: Page, preset: string, x: number, y: number, text: string): Promise<void> {
  await page.getByTestId(`tool-place:${preset}`).click();
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  await editor.fill(text);
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
}

/** 수업 표기. 기본키는 글자가 아니라 밑줄 서식으로 표시한다(KEYS) */
const MODEL = [
  '학과 (학과코드, 학과명)',
  '학생 (학번, 이름, 학과코드)',
  'Foreign Key (학과코드) references 학과',
  '과목 (과목코드, 과목명)',
  '수강 (학번, 과목코드, 성적)',
  'Foreign Key (학번) references 학생',
  'Foreign Key (과목코드) references 과목 (과목코드)',
];
/** [줄(0부터), 이름]: 밑줄을 그을 기본키 */
const KEYS: Array<[number, string]> = [
  [0, '학과코드'],
  [1, '학번'],
  [3, '과목코드'],
  [4, '학번'],
  [4, '과목코드'],
];
const LOCKER = ['사물함 (번호, 학번)', 'Foreign Key (학번) references 학생'];

/** 편집기에서 n번째 줄의 이름을 고른다 */
async function selectWord(page: Page, line: number, word: string): Promise<void> {
  await page.getByTestId('relational-editor').evaluate(
    (el: HTMLTextAreaElement, [l, w]) => {
      const lines = el.value.split('\n');
      const start = lines.slice(0, l as number).reduce((n, s) => n + s.length + 1, 0) + lines[l as number].indexOf(w as string);
      el.focus();
      el.setSelectionRange(start, start + (w as string).length);
    },
    [line, word] as [number, string],
  );
}

/** 거울 층에 그린 밑줄 글자들 */
const underlined = (page: Page) => page.locator('.rel-editor-marks .rel-ul');

test('관계 모델을 적으면 IE와 SQL이 따라오고, 팀원의 화면에도 바로 나타난다', async ({ browser }) => {
  const a = await join(browser, 'e2e-panes-a', '철수', '#E5484D');
  const page = a.page;
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

  // 기본 배치: 왼쪽 ERD, 오른쪽 위 관계 모델, 오른쪽 아래 IE(SQL은 같은 그룹의 탭)
  const erdPane = page.locator('.dock-content > [data-pane="erd"]');
  const relPane = page.locator('.dock-content > [data-pane="relational"]');
  const iePane = page.locator('.dock-content > [data-pane="ie"]');
  await expect(erdPane).toBeVisible();
  await expect(relPane).toBeVisible();
  await expect(iePane).toBeVisible();
  await expect(page.locator('[role="tab"][data-tab="steps"]')).toHaveCount(0);
  const erdBox = (await erdPane.boundingBox())!;
  const relBox = (await relPane.boundingBox())!;
  const ieBox = (await iePane.boundingBox())!;
  expect(erdBox.x + erdBox.width).toBeLessThanOrEqual(relBox.x + 1);
  expect(erdBox.width).toBeGreaterThan(relBox.width);
  expect(relBox.y + relBox.height).toBeLessThanOrEqual(ieBox.y + 1);
  await expect(page.getByTestId('ie-empty')).toBeVisible();

  // ERD에 도형 하나를 그려 둔다(편집기의 키가 도형을 지우지 않는지 보려고)
  await place(page, 'entity', 160, 200, '학생');
  await expect(page.locator('[data-node-id]')).toHaveCount(1);

  // 1. 관계 모델을 적는다
  const editor = page.getByTestId('relational-editor');
  await expect(editor).toHaveAttribute('placeholder', '학생 (학번, 이름, 학과코드)\nForeign Key (학과코드) references 학과 (학과코드)');
  await editor.click();
  await page.keyboard.type(MODEL.join('\n'));
  await expect(editor).toHaveValue(MODEL.join('\n'));

  // 편집기 안의 키는 편집기에만 간다: Delete, Backspace, 되돌리기가 도형에 닿지 않는다
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  // 되돌리기는 잠깐 사이의 입력을 묶으므로 쉬었다가 친 'y'만 되돌린다
  await page.waitForTimeout(700);
  await page.keyboard.type('y');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(MODEL.join('\n'));
  await expect(page.locator('[data-node-id]')).toHaveCount(1);

  // 2. 기본키를 골라 밑줄 단축키(⌘U, Ctrl+U)로 긋는다. 밑줄이 없으면 외래키가 가리킬 기본키가 없어 오류다
  const ie = page.getByTestId('ie-diagram');
  await expect(page.getByTestId('ie-problem-badge')).toHaveAttribute('aria-label', /^오류 \d+개/);
  await selectWord(page, 1, '학번');
  await page.keyboard.press('ControlOrMeta+u');
  await expect(underlined(page)).toHaveText(['학번']);
  // 3. IE가 기본키로 보인다
  await expect(ie.locator('[data-table="학생"] [data-column="학번"] .ie-col')).toHaveClass(/is-pk/);
  await expect(page.getByTestId('relational-underline')).toHaveAttribute('aria-pressed', 'true');
  for (const [line, word] of KEYS) {
    if (line === 1) continue;
    await selectWord(page, line, word);
    await page.keyboard.press('ControlOrMeta+u');
  }
  await expect(underlined(page)).toHaveText(['학과코드', '학번', '과목코드', '학번', '과목코드']);
  // 밑줄도 되돌릴 수 있다
  await page.keyboard.press('ControlOrMeta+z');
  await expect(underlined(page)).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(underlined(page)).toHaveCount(5);

  // IE에 테이블과 선이 나온다(식별 관계는 실선, 비식별은 점선)
  await expect(ie.locator('g.ie-table')).toHaveCount(4);
  await expect(ie.locator('.ie-link')).toHaveCount(3);
  await expect(ie.locator('.ie-link[data-identifying="true"]')).toHaveCount(2);
  await expect(ie.locator('.ie-link[data-identifying="false"] .ie-link-line.is-dashed')).toHaveCount(1);
  await expect(page.getByTestId('ie-problem-badge')).toHaveCount(0);

  // 3. SQL 탭에서 타입을 정하면 SQL 글에 나온다
  await page.locator('[role="tab"][data-tab="sql"]').click();
  const missing = page.getByTestId('sql-missing-types');
  await expect(missing).toHaveText('타입을 정하지 않은 컬럼 10개');
  const type = page.getByTestId('type-input-학생.이름');
  await type.fill('VARCHAR(20)');
  await type.press('Enter');
  await expect(page.getByTestId('sql-code')).toContainText('`이름` VARCHAR(20)');
  await expect(missing).toHaveText('타입을 정하지 않은 컬럼 9개');
  await page.getByTestId('null-select-학생.학과코드').selectOption('null');
  await expect(page.getByTestId('null-select-학생.학번')).toBeDisabled();

  // 3-1. IE 그림 안에서 바로 고친다: 타입 칸을 누르면 그 자리에 입력칸이 열리고, SQL에 반영된다
  await page.locator('[role="tab"][data-tab="ie"]').click();
  // 글을 적는 동안 상자 크기가 바뀌었으니 전체가 보이게 맞춘다
  await ie.getByRole('button', { name: '전체 보기' }).click();
  await ie.getByTestId('ie-type-학생.학번').click();
  const ieType = ie.getByTestId('ie-type-input-학생.학번');
  await expect(ieType).toBeFocused();
  await ieType.fill('CHAR(8)');
  await ieType.press('Enter');
  await expect(ieType).toHaveCount(0);
  await expect(ie.locator('[data-table="학생"] [data-column="학번"]')).toHaveAttribute('data-type', 'CHAR(8)');
  // 입력 중의 키는 그림과 캔버스로 가지 않는다(Backspace가 ERD 도형을 지우지 않는다)
  await ie.getByTestId('ie-type-학생.이름').click();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-node-id]')).toHaveCount(1);
  await expect(ie.locator('[data-table="학생"] [data-column="이름"]')).toHaveAttribute('data-type', 'VARCHAR(20)');
  // NULL 칸을 누르면 메뉴(미지정, NOT NULL, NULL)가 뜨고 고른 값이 들어간다
  const ieNull = ie.getByTestId('ie-null-수강.성적');
  const pickNull = async (value: string) => {
    await ieNull.click();
    await page.getByTestId(`ie-null-menu-${value}`).click();
    await expect(page.getByTestId('ie-null-menu')).toHaveCount(0);
    await expect(ieNull).toHaveAttribute('data-value', value);
  };
  await expect(ieNull).toHaveAttribute('data-value', 'unset');
  await pickNull('not-null');
  await pickNull('null');
  await pickNull('unset');
  await pickNull('not-null');
  // 기본키의 NULL 칸은 언제나 NOT NULL
  await expect(ie.getByTestId('ie-null-학생.학번')).toHaveAttribute('data-value', 'not-null');
  await page.locator('[role="tab"][data-tab="sql"]').click();
  await expect(page.getByTestId('sql-code')).toContainText('`학번` CHAR(8) NOT NULL');
  await expect(page.getByTestId('sql-code')).toContainText('`성적` /* 타입 미지정 */ NOT NULL');
  await expect(page.getByTestId('null-select-수강.성적')).toHaveValue('not-null');
  await expect(page.getByTestId('type-input-학생.학번')).toHaveValue('CHAR(8)');

  // 4. 두 번째 사람이 들어오면 글이 그대로 보이고, 서로 고친 것이 바로 보인다
  const b = await join(browser, 'e2e-panes-b', '영희', '#0090FF');
  await b.page.goto(page.url());
  await expect(b.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  const editorB = b.page.getByTestId('relational-editor');
  await expect(editorB).toHaveValue(MODEL.join('\n'));
  // 4. 영희의 화면에도 같은 밑줄이 보인다
  await expect(underlined(b.page)).toHaveText(['학과코드', '학번', '과목코드', '학번', '과목코드']);
  await expect(b.page.locator('[data-table="수강"] [data-column="과목코드"] .ie-col')).toHaveClass(/is-pk/);
  await editorB.click();
  await editorB.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  // 영희는 고른 것 없이 밑줄을 켜고 친 다음 끈다(문서 편집기처럼)
  await b.page.keyboard.type('\n사물함 (');
  await b.page.keyboard.press('ControlOrMeta+u');
  await b.page.keyboard.type('번호');
  await b.page.keyboard.press('ControlOrMeta+u');
  await b.page.keyboard.type(', 학번)\nForeign Key (학번) references 학생');
  await expect(editor).toHaveValue(`${MODEL.join('\n')}\n${LOCKER.join('\n')}`);
  await expect(underlined(page)).toHaveText(['학과코드', '학번', '과목코드', '학번', '과목코드', '번호']);
  await page.locator('[role="tab"][data-tab="ie"]').click();
  await expect(ie.locator('g.ie-table')).toHaveCount(5);
  await expect(page.getByTestId('ie-problem-badge')).toHaveCount(0);
  // 철수가 정한 타입이 영희의 IE에도 있다
  await expect(b.page.locator('[data-table="학생"] [data-column="이름"]')).toHaveAttribute('data-type', 'VARCHAR(20)');

  // 철수가 첫 줄 앞에 적어도 영희의 캐럿은 영희가 치던 자리에 남는다
  await editor.click();
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.type('# 수강 신청\n');
  await expect(editorB).toHaveValue(`# 수강 신청\n${MODEL.join('\n')}\n${LOCKER.join('\n')}`);
  await b.page.keyboard.type(' ');
  await expect(editorB).toHaveValue(`# 수강 신청\n${MODEL.join('\n')}\n${LOCKER.join('\n')} `);
  // 밑줄은 글자와 함께 옮겨 간다
  await expect(underlined(b.page)).toHaveText(['학과코드', '학번', '과목코드', '학번', '과목코드', '번호']);

  // 복사하고 붙이면 밑줄도 함께 온다(클립보드의 HTML). 일반 텍스트에는 밑줄 표시 문자가 없다
  await selectWord(b.page, 8, '사물함 (번호, 학번)');
  await b.page.keyboard.press('ControlOrMeta+c');
  const plain = await b.page.evaluate(() => navigator.clipboard.readText());
  expect(plain).toBe('사물함 (번호, 학번)');
  await editorB.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await b.page.keyboard.press('Enter');
  await b.page.keyboard.press('ControlOrMeta+v');
  await expect(underlined(page)).toHaveText(['학과코드', '학번', '과목코드', '학번', '과목코드', '번호', '번호']);
  await b.page.keyboard.press('ControlOrMeta+z');
  await b.page.keyboard.press('Backspace');
  await expect(editorB).toHaveValue(`# 수강 신청\n${MODEL.join('\n')}\n${LOCKER.join('\n')} `);

  // 오류가 있으면 IE에 배지가 뜨고, 누르면 편집기의 그 줄로 간다
  await b.page.keyboard.type('\n교수 (교수번호');
  await expect(page.getByTestId('ie-problem-badge')).toHaveAttribute('aria-label', /^오류 \d+개/);
  await expect(page.locator('.rel-gutter span[data-problem="error"]')).toHaveCount(1);
  await page.getByTestId('ie-problem-badge').click();
  await expect(editor).toBeFocused();

  await b.ctx.close();
  await a.ctx.close();
});
