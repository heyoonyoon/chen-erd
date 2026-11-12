#!/usr/bin/env node
/**
 * 첫 화면 세 단계 구역에 넣는 실제 서비스 화면 영상을 녹화한다.
 *
 *   node scripts/record-landing.mjs                 # 세 단계 모두
 *   node scripts/record-landing.mjs physical        # 하나만 다시
 *   BASE=http://localhost:5213 node scripts/record-landing.mjs
 *
 * 떠 있는 앱(BASE, 기본 http://localhost:5213)에 녹화용 방을 새로 만들고(모델 API) 설치된 Chrome에서 한 사람이 혼자
 * 실제로 조작하는 화면을 찍는다. 연출용 화면이나 덧붙인 그림은 없다. 다만 헤드리스 화면에는 마우스 포인터가 찍히지 않으므로
 * macOS 기본 화살표 모양 포인터를 페이지에 넣고 실제 mousemove, mousedown 이벤트를 그대로 따라가게 한다.
 * 마우스는 사람처럼 휘는 길로 감속하며 움직이고(순간이동 없음), 글자는 60~120ms 간격으로 친다.
 *
 * 화면은 1024×640을 2배 밀도로 찍어 1280×800으로 줄여 인코딩한다. 스크롤에 맞춰 영상을 앞뒤로 움직이므로(scroll scrubbing)
 * 키프레임을 5프레임마다 넣는다(20fps). 인코딩 때 1.25배로 아주 살짝 빠르게 튼다(SPEED로 바꿀 수 있다). public/landing/<단계>.mp4(H.264)와 .jpg(첫 화면 그림)를 만든다. webm(VP9)은 Chrome에서 되감을 때 디코딩 오류가 나서 만들지 않는다. 소리는 없다.
 * 방 이름과 사람 이름은 한국어 화면 기준이다.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'landing');
const BASE = process.env.BASE ?? 'http://localhost:5213';
const SIZE = { width: 1024, height: 640 };
const SCALE = 2;
const OUT_SIZE = { width: 1280, height: 800 };
const FPS = 20;
const GOP = 5;
/** 인코딩 때 아주 살짝 빠르게 튼다(손이 부자연스러울 만큼 빠르지 않게) */
const SPEED = Number(process.env.SPEED ?? 1.25);

const ME = { id: 'landing-recorder', name: '지민', color: '#E5484D' };

const CHEN = `title "학적 관리"
entity 학생 { 학번 key, 이름 }
entity 학과 { 학과코드 key, 학과명 }
relationship 소속 (학생 N total, 학과 1)`;
const RELATIONAL = ['학과 (학과코드, 학과명)', '학생 (학번, 이름, 학과코드)', 'Foreign Key (학과코드) references 학과 (학과코드)'];
/** 관계 모델 글의 기본키 밑줄 표기(_이름_)를 넣은 글 */
const RELATIONAL_MARKED = ['학과 (_학과코드_, 학과명)', '학생 (_학번_, 이름, 학과코드)', RELATIONAL[2]].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

// ───────────────────────── 방과 브라우저 ─────────────────────────

/** 녹화용 방을 새로 만든다. 사용자의 방은 건드리지 않는다 */
async function createRoom(stage, { chen = false, relational = false } = {}) {
  const id = `landing-${stage}-${Date.now().toString(36)}`;
  const put = async (path, text) => {
    const res = await fetch(`${BASE}/api/rooms/${id}/${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  };
  // 빈 방도 제목 한 줄로 만들어 둔다(없는 방에는 관계 모델 글을 넣을 수 없다)
  await put('model?relayout=1', chen ? CHEN : 'title "학적 관리"');
  // relational: true면 완성된 관계 모델 글, 문자열이면 그 글을 넣는다
  if (relational) await put('relational', relational === true ? RELATIONAL_MARKED : relational);
  return id;
}

/** macOS 기본 화살표 포인터. 실제 마우스 이벤트를 따라가고 누르는 동안만 살짝 작아진다 */
function injectPointer() {
  const install = () => {
    if (document.getElementById('__rec-pointer')) return;
    const el = document.createElement('div');
    el.id = '__rec-pointer';
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)';
    el.innerHTML =
      '<svg width="17" height="25" viewBox="0 0 17 25" style="position:absolute;left:-1px;top:-1px;transform-origin:1px 1px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))">' +
      '<path d="M1.5 1.5v18.2l4.4-4.2 2.9 6.8 3.1-1.3-2.9-6.7h6.1z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(el);
    const svg = el.firstChild;
    const move = (e) => {
      el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener('pointermove', move, { capture: true, passive: true });
    window.addEventListener('mousemove', move, { capture: true, passive: true });
    window.addEventListener(
      'pointerdown',
      (e) => {
        move(e);
        svg.style.transform = 'scale(0.9)';
      },
      { capture: true },
    );
    window.addEventListener(
      'pointerup',
      () => {
        svg.style.transform = '';
      },
      { capture: true },
    );
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

async function open(browser, room, layout = null) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: SCALE, locale: 'ko-KR', colorScheme: 'light' });
  await ctx.addInitScript(
    ([w, l]) => {
      localStorage.setItem('chen-erd.identity', JSON.stringify(w));
      // 배치는 이 브라우저에만 저장된다(키 'modelll.layout'). 장면에 맞는 배치를 미리 넣어 둔다
      if (l) localStorage.setItem('modelll.layout', JSON.stringify(l));
      else localStorage.removeItem('modelll.layout');
    },
    [ME, layout],
  );
  await ctx.addInitScript(injectPointer);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/r/${room}`);
  await page.getByTestId('connection-status').and(page.locator('[data-status="connected"]')).waitFor();
  const nick = page.getByTestId('nickname-input');
  if (await nick.isVisible().catch(() => false)) {
    await nick.fill(ME.name);
    await page.getByTestId('nickname-submit').click();
  }
  await sleep(600);
  return { ctx, page, mouse: new Hand(page) };
}

// ───────────────────────── 사람 손 ─────────────────────────

/** 사람처럼 움직이는 마우스. 휘는 길을 따라 부드럽게 출발해 목표 근처에서 느려진다. 자판은 글자마다 60~120ms 쉰다 */
class Hand {
  constructor(page) {
    this.page = page;
    this.x = SIZE.width * 0.6;
    this.y = SIZE.height * 0.8;
  }
  async park(x, y) {
    this.x = x;
    this.y = y;
    await this.page.mouse.move(x, y);
  }
  async move(x, y, speed = 1) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 1) return;
    const dur = Math.min(460, Math.max(120, 130 + d * 0.45)) / speed;
    const steps = Math.max(6, Math.round(dur / 16));
    const bend = rand(-0.12, 0.12);
    const c = { x: (this.x + x) / 2 - (y - this.y) * bend, y: (this.y + y) / 2 + (x - this.x) * bend };
    const a = { x: this.x, y: this.y };
    // 이벤트 전송에 걸리는 시간까지 쳐서 실제 시각에 맞춰 움직인다(안 그러면 정한 시간보다 두 배쯤 느려진다)
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 천천히 출발해 빨라졌다가 목표 근처에서 느려진다
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const u = 1 - e;
      await this.page.mouse.move(u * u * a.x + 2 * u * e * c.x + e * e * x, u * u * a.y + 2 * u * e * c.y + e * e * y);
      await sleep(Math.max(0, t0 + t * dur - Date.now()));
    }
    this.x = x;
    this.y = y;
  }
  async to(locator, fx = 0.5, fy = 0.5) {
    const b = await locator.boundingBox();
    if (!b) throw new Error(`보이지 않는 요소: ${locator}`);
    await this.move(b.x + b.width * fx, b.y + b.height * fy);
  }
  /** 누르기 전에 잠깐 멈칫한다 */
  async click() {
    await sleep(rand(70, 120));
    await this.page.mouse.down();
    await sleep(rand(50, 80));
    await this.page.mouse.up();
  }
  async clickOn(locator, fx, fy) {
    await this.to(locator, fx, fy);
    await this.click();
  }
  async drag(x, y) {
    await sleep(rand(60, 100));
    await this.page.mouse.down();
    await sleep(60);
    await this.move(x, y, 0.9);
    await sleep(50);
    await this.page.mouse.up();
  }
  async type(text) {
    for (const ch of Array.from(text)) {
      await this.page.keyboard.type(ch);
      await sleep(rand(60, 120));
    }
  }
}

// ───────────────────────── 녹화 ─────────────────────────

/** DevTools 화면 전송으로 프레임을 모은다. stop()은 프레임 파일과 시각 목록을 돌려준다 */
async function startCapture(page, dir) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: SIZE.width * SCALE, maxHeight: SIZE.height * SCALE, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    const end = Date.now() / 1000;
    await cdp.detach();
    return { frames, end };
  };
}

/** 프레임을 실제 시각대로 이어 붙여 webm, mp4, 첫 화면 그림을 만든다. 앞뒤로 움직이기 쉽게 키프레임을 촘촘히 넣는다 */
function encode(stage, { frames, end }, dir) {
  if (frames.length === 0) throw new Error(`${stage}: 프레임이 없습니다`);
  const list = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    list.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
  }
  list.push(`file '${frames[frames.length - 1].file}'`);
  const listFile = join(dir, 'frames.txt');
  writeFileSync(listFile, list.join('\n'));
  const input = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile];
  const vf = `setpts=PTS/${SPEED},fps=${FPS},scale=${OUT_SIZE.width}:${OUT_SIZE.height}:flags=lanczos,format=yuv420p`;
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, `${stage}.mp4`);
  const jpg = join(OUT, `${stage}.jpg`);
  const gop = ['-g', String(GOP), '-keyint_min', String(GOP)];
  execFileSync('ffmpeg', [...input, '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '31', '-tune', 'stillimage', ...gop, '-sc_threshold', '0', '-movflags', '+faststart', mp4]);
  // 첫 화면 그림은 영상의 마지막 장면(완성된 모습)이다. 영상을 재생하지 않는 사용자가 보는 그림이다
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-sseof', '-0.3', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg]);
  for (const f of [mp4, jpg]) console.log(`  ${f.replace(ROOT + '/', '')}  ${(statSync(f).size / 1024).toFixed(0)} KB`);
}

// ───────────────────────── 조작 도우미 ─────────────────────────

/** 캔버스 기준 좌표를 화면 좌표로 */
async function at(page, x, y) {
  const box = await page.getByTestId('canvas-svg').boundingBox();
  return { x: box.x + x, y: box.y + y };
}

/** 도구 막대에서 도구를 고르고 캔버스를 눌러 놓은 뒤 이름을 적는다 */
async function place(hand, preset, x, y, text) {
  const { page } = hand;
  await hand.clickOn(page.getByTestId(`tool-place:${preset}`));
  const p = await at(page, x, y);
  await hand.move(p.x, p.y);
  await hand.click();
  await page.getByTestId('text-editor').waitFor();
  await sleep(rand(60, 100));
  await hand.type(text);
  await sleep(80);
  await page.keyboard.press('Enter');
  await sleep(rand(100, 150));
}

/** 글자로 캔버스의 도형 id를 찾는다 */
async function nodeId(page, text) {
  const id = await page.getByTestId('canvas-svg').evaluate((svg, t) => {
    for (const g of svg.querySelectorAll('[data-node-id]')) if (g.textContent.trim() === t) return g.getAttribute('data-node-id');
    return null;
  }, text);
  if (!id) throw new Error(`도형을 찾지 못함: ${text}`);
  return id;
}

/**
 * 실제 앱처럼 연결 점으로 잇는다. 도형에 마우스를 올리면 테두리 바깥 상하좌우에 연결 점(동그라미)이 뜨고,
 * 그 점을 끌어 다른 도형에 놓으면 선이 이어진다. to가 [x, y](캔버스 좌표)면 빈 곳에 놓아 새 속성을 단다
 */
async function connect(hand, fromText, side, to) {
  const { page } = hand;
  const id = await nodeId(page, fromText);
  const node = page.locator(`[data-node-id="${id}"]`).first();
  const nb = await node.boundingBox();
  // 도형 위로 가져가 연결 점을 띄운다(선택돼 있으면 이미 떠 있다). 점 쪽 가장자리로 다가간다
  const dot = page.locator(`[data-connect-from="${id}"][data-side="${side}"] .canvas-connect-dot-mark`);
  if (!(await dot.isVisible().catch(() => false))) {
    const fx = side === 'right' ? 0.9 : side === 'left' ? 0.1 : 0.5;
    const fy = side === 'bottom' ? 0.85 : side === 'top' ? 0.15 : 0.5;
    await hand.move(nb.x + nb.width * fx, nb.y + nb.height * fy);
    await dot.waitFor();
  }
  await hand.to(dot);
  let b;
  if (Array.isArray(to)) b = await at(page, ...to);
  else {
    const tb = await page.locator(`[data-node-id="${await nodeId(page, to)}"]`).first().boundingBox();
    b = { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 };
  }
  await hand.drag(b.x, b.y);
  await sleep(rand(120, 200));
}

/** 편집기 글에서 n번째 줄 낱말의 화면 자리(앞 끝, 뒤 끝, 세로 가운데). 같은 글꼴의 거울 상자로 잰다 */
async function wordBox(page, line, word) {
  return page.getByTestId('relational-editor').evaluate(
    (el, [l, w]) => {
      const lines = el.value.split('\n');
      const start = lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + lines[l].indexOf(w);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const div = document.createElement('div');
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'wordBreak', 'overflowWrap', 'tabSize']) div.style[p] = cs[p];
      div.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;white-space:pre-wrap;visibility:hidden;border-style:solid;border-color:transparent`;
      div.append(el.value.slice(0, start));
      const span = document.createElement('span');
      span.textContent = w;
      div.append(span, el.value.slice(start + w.length));
      document.body.appendChild(div);
      const b = span.getBoundingClientRect();
      div.remove();
      return { x1: b.left, x2: b.right, y: b.top + b.height / 2 - el.scrollTop };
    },
    [line, word],
  );
}

// ───────────────────────── 장면 ─────────────────────────

const SCENES = {
  /** 개념적 설계: 도구 막대에서 엔티티와 관계를 골라 놓고, 연결 점을 끌어 잇고(카디널리티 N), 빈 곳에 끌어 놓아 키 속성을 단다 */
  async conceptual(browser, dir) {
    const room = await createRoom('conceptual');
    const { ctx, page, mouse } = await open(browser, room);
    // ERD 칸을 크게 본다
    await page.getByTestId('dock-maximize-g1').click();
    await sleep(500);
    await mouse.park(200, 300);
    const stop = await startCapture(page, dir);
    await sleep(200);
    await place(mouse, 'entity', 190, 330, '학생');
    await place(mouse, 'relationship', 370, 330, '소속');
    await place(mouse, 'entity', 550, 330, '학과');
    // 연결 점을 끌어 잇는다. 이은 선이 선택되므로 바로 카디널리티를 고른다
    await connect(mouse, '학생', 'right', '소속');
    await mouse.clickOn(page.getByTestId('inspector-cardinality-N'));
    await connect(mouse, '소속', 'right', '학과');
    // 학생의 위쪽 연결 점을 빈 곳에 놓으면 속성이 생긴다. 이름을 적고 속성 패널의 종류에서 키 속성을 고르면 밑줄이 그어진다
    await connect(mouse, '학생', 'top', [190, 205]);
    await page.getByTestId('text-editor').waitFor();
    await sleep(rand(60, 100));
    await mouse.type('학번');
    await sleep(80);
    await page.keyboard.press('Enter');
    await sleep(120);
    await mouse.clickOn(page.getByTestId('inspector-preset-key-attribute'));
    await sleep(600);
    const shot = await stop();
    encode('conceptual', shot, dir);
    await ctx.close();
  },

  /**
   * 논리적 설계: 첫 줄(학과)이 적힌 편집기에 학생 줄과 외래키 줄을 이어 적고, 학번을 끌어 골라 밑줄 버튼으로 기본키를 정하면
   * 아래 IE에 표 두 개와 선이 그려진다. IE가 잘리지 않게 관계 모델 칸은 낮게, IE 칸은 크게 둔다
   */
  async logical(browser, dir) {
    const room = await createRoom('logical', { chen: true, relational: RELATIONAL_MARKED.split('\n')[0] });
    const layout = {
      version: 1,
      root: {
        type: 'split',
        id: 's1',
        direction: 'row',
        sizes: [0.42, 0.58],
        children: [
          { type: 'group', id: 'g1', panes: ['erd'], active: 'erd' },
          {
            type: 'split',
            id: 's2',
            direction: 'column',
            sizes: [0.3, 0.7],
            children: [
              { type: 'group', id: 'g2', panes: ['relational'], active: 'relational' },
              { type: 'group', id: 'g3', panes: ['ie', 'sql'], active: 'ie' },
            ],
          },
        ],
      },
      maximized: null,
      lastGroup: 'g2',
    };
    const { ctx, page, mouse } = await open(browser, room, layout);
    const editor = page.getByTestId('relational-editor');
    const fit = page.getByTestId('ie-diagram').getByRole('button', { name: '전체 보기' });
    await fit.click().catch(() => undefined);
    await mouse.park(760, 560);
    const stop = await startCapture(page, dir);
    await sleep(250);
    // 글 끝 아래 빈 곳을 눌러 커서를 끝에 둔다
    await mouse.clickOn(editor, 0.6, 0.85);
    const eb = await editor.boundingBox();
    await mouse.move(eb.x + eb.width * 0.85, eb.y + eb.height * 0.9);
    for (const line of RELATIONAL.slice(1)) {
      await page.keyboard.press('Enter');
      await sleep(rand(120, 200));
      await mouse.type(line);
      await sleep(rand(120, 200));
    }
    // 기본키: 학번을 끌어 고르고 밑줄 버튼
    const w = await wordBox(page, 1, '학번');
    await mouse.move(w.x1 + 1, w.y);
    await mouse.drag(w.x2 - 1, w.y);
    await sleep(200);
    await mouse.clickOn(page.getByTestId('relational-underline'));
    await sleep(300);
    // IE 전체 보기로 두 표와 선을 한눈에 맞춘다
    await mouse.clickOn(fit);
    await sleep(900);
    const shot = await stop();
    encode('logical', shot, dir);
    await ctx.close();
  },

  /**
   * 물리적 설계: 왼쪽 IE, 오른쪽 SQL을 나란히 놓고 IE 표에서만 고친다. 타입 칸은 콤보박스 목록에서 고르고,
   * NULL 칸은 메뉴에서 NOT NULL을 고르면 옆의 SQL이 바로 바뀐다. 마지막에 DBMS를 바꾸면 SQL이 그 방언이 된다.
   * IE 편집 UI(타입 콤보박스, NULL 메뉴, DBMS 선택)가 바뀌면 이 장면만 다시 찍는다.
   */
  async physical(browser, dir) {
    const room = await createRoom('physical', { chen: true, relational: true });
    const layout = {
      version: 1,
      root: {
        type: 'split',
        id: 's1',
        direction: 'row',
        sizes: [0.52, 0.48],
        children: [
          { type: 'group', id: 'g1', panes: ['ie'], active: 'ie' },
          { type: 'group', id: 'g2', panes: ['sql'], active: 'sql' },
        ],
      },
      maximized: null,
      lastGroup: 'g1',
    };
    const { ctx, page, mouse } = await open(browser, room, layout);
    await page.locator('.dock-content > [data-pane="sql"]').waitFor();
    const ie = page.getByTestId('ie-diagram');
    await ie.getByRole('button', { name: '전체 보기' }).click().catch(() => undefined);
    await mouse.park(300, 560);
    await sleep(400);
    const stop = await startCapture(page, dir);
    await sleep(200);
    /** 타입 칸을 누르고 몇 글자 적어 목록을 좁힌 뒤 목록에서 고르고 괄호 안 길이를 고쳐 쓴다 */
    const pickType = async (col, typed, option, size) => {
      await mouse.clickOn(page.getByTestId(`ie-type-${col}`));
      await sleep(150);
      await mouse.type(typed);
      await sleep(200);
      const item = page.getByTestId(`ie-type-input-${col}-options`).getByRole('option', { name: option, exact: true });
      await mouse.clickOn(item, 0.4, 0.5);
      await sleep(150);
      await mouse.type(size);
      await sleep(120);
      await page.keyboard.press('Enter');
      await sleep(300);
    };
    await pickType('학생.학번', 'CH', 'CHAR(10)', '8');
    await pickType('학생.이름', 'VAR', 'VARCHAR(255)', '20');
    // NULL 칸: 메뉴에서 NOT NULL을 고른다
    await mouse.clickOn(page.getByTestId('ie-null-학생.이름'));
    await sleep(200);
    await mouse.clickOn(page.getByTestId('ie-null-menu-not-null'), 0.4, 0.5);
    await sleep(400);
    // DBMS를 바꾸면 옆의 SQL이 그 방언으로 바뀐다. DBMS 버튼을 눌러 목록을 펼치고, 펼친 목록을 잠시 보인 뒤 항목을 누른다
    const dialectButton = page.getByTestId('ie-dialect');
    for (const dialect of ['postgresql', 'oracle']) {
      await mouse.clickOn(dialectButton);
      await page.getByTestId('ie-dialect-menu').waitFor();
      await sleep(550);
      await mouse.clickOn(page.getByTestId(`ie-dialect-menu-${dialect}`), 0.4, 0.5);
      await sleep(dialect === 'oracle' ? 1300 : 900);
    }
    const shot = await stop();
    encode('physical', shot, dir);
    await ctx.close();
  },
};

const wanted = process.argv.slice(2).filter((a) => a in SCENES);
const order = wanted.length ? wanted : Object.keys(SCENES);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const stage of order) {
    const dir = mkdtempSync(join(tmpdir(), `landing-${stage}-`));
    console.log(`● ${stage}`);
    try {
      await SCENES[stage](browser, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
