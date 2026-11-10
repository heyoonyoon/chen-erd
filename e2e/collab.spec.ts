import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** 이름이 저장된 상태로 새 접속자를 만든다(이름 입력 창이 뜨지 않게). */
async function join(browser: Browser, name: string, color: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([n, c]) => {
      if (!localStorage.getItem('chen-erd.identity')) {
        localStorage.setItem('chen-erd.identity', JSON.stringify({ id: `e2e-${n}`, name: n, color: c }));
      }
    },
    [name, color],
  );
  const page = await ctx.newPage();
  return { ctx, page };
}

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test('두 사람이 같은 방에서 동시에 그리고 서로의 커서가 보인다', async ({ browser }) => {
  const a = await join(browser, '철수', '#E5484D');
  const b = await join(browser, '영희', '#0090FF');

  // 철수가 방을 만든다
  await a.page.goto('/');
  await a.page.getByTestId('create-room').click();
  await a.page.waitForURL(/\/r\/[a-z0-9]+$/);
  const url = a.page.url();
  await ready(a.page);

  // 영희가 같은 링크로 들어온다
  await b.page.goto(url);
  await ready(b.page);
  await expect(a.page.getByTestId('avatar')).toHaveCount(2);
  await expect(b.page.getByTestId('avatar')).toHaveCount(2);

  // 철수가 엔티티를 놓으면 영희 화면에 나타난다
  await place(a.page, 'entity', 400, 300, '학생');
  await expect(b.page.locator('[data-node-id]')).toHaveCount(1);
  await expect(b.page.locator('[data-node-id]').first()).toContainText('학생');

  // 영희가 관계를 놓으면 철수 화면에 나타난다
  await place(b.page, 'relationship', 700, 300, '수강');
  await expect(a.page.locator('[data-node-id]')).toHaveCount(2);

  // 철수가 연결 도구로 둘을 잇는다
  await a.page.getByTestId('tool-connect').click();
  await drag(a.page, await at(a.page, 400, 300), await at(a.page, 700, 300));
  await expect(a.page.locator('[data-edge-id]')).toHaveCount(1);
  await expect(b.page.locator('[data-edge-id]')).toHaveCount(1);

  // 철수가 마우스를 움직이면 영희 화면에 철수의 포인터가 보인다
  const p = await at(a.page, 550, 450);
  await a.page.mouse.move(p.x, p.y, { steps: 3 });
  // 포인터를 감싼 요소는 크기가 0이라 안쪽의 이름표로 보이는지 확인한다
  const cursor = b.page.locator('[data-testid="remote-cursor"][data-user-name="철수"]');
  await expect(cursor.locator('.presence-cursor-name')).toBeVisible();
  await expect(cursor.locator('.presence-cursor-name')).toHaveText('철수');
  // 이름표는 포인터 끝의 오른쪽 아래에 붙는다. 움직임 보간이 끝난 뒤의 위치를 확인한다
  await expect
    .poll(async () => {
      const tag = await cursor.locator('.presence-cursor-name').boundingBox();
      return tag ? Math.hypot(tag.x - p.x, tag.y - p.y) : Infinity;
    })
    .toBeLessThan(40);
  if (process.env.E2E_SHOTS) await b.page.screenshot({ path: `${process.env.E2E_SHOTS}/b-sees-cursor.png` });

  // 영희가 엔티티를 끌어 옮기면 철수 화면에서도 움직인다
  await b.page.getByTestId('tool-select').click();
  const before = await a.page.locator('[data-node-id]', { hasText: '학생' }).boundingBox();
  await drag(b.page, await at(b.page, 400, 300), await at(b.page, 400, 480));
  await expect
    .poll(async () => (await a.page.locator('[data-node-id]', { hasText: '학생' }).boundingBox())?.y ?? 0)
    .toBeGreaterThan((before?.y ?? 0) + 100);

  // 실행 취소는 자기 변경만 되돌린다: 영희가 되돌리면 이동만 취소되고 철수가 만든 도형과 선은 남는다
  await b.page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await a.page.locator('[data-node-id]', { hasText: '학생' }).boundingBox())?.y ?? 0)
    .toBeLessThan((before?.y ?? 0) + 5);
  await expect(a.page.locator('[data-edge-id]')).toHaveCount(1);

  await a.ctx.close();
  await b.ctx.close();

  // 모두 나갔다 다시 들어와도 내용이 남아 있다
  const c = await join(browser, '민수', '#46A758');
  await c.page.goto(url);
  await ready(c.page);
  await expect(c.page.locator('[data-node-id]')).toHaveCount(2);
  await expect(c.page.locator('[data-edge-id]')).toHaveCount(1);
  await c.ctx.close();
});

test('처음 들어오면 이름을 묻고, 입력한 이름이 다른 사람에게 보인다', async ({ browser }) => {
  const a = await join(browser, '철수', '#E5484D');
  await a.page.goto('/');
  await a.page.getByTestId('create-room').click();
  await a.page.waitForURL(/\/r\/[a-z0-9]+$/);
  await ready(a.page);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(a.page.url());
  await page.getByTestId('nickname-input').fill('새내기');
  await page.getByTestId('nickname-submit').click();
  await expect(page.getByTestId('nickname-input')).toHaveCount(0);

  await expect(a.page.locator('[data-testid="avatar"][title*="새내기"]')).toHaveCount(1);
  await ctx.close();
  await a.ctx.close();
});
