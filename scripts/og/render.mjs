/**
 * 검색 결과와 링크 미리보기에 쓰이는 그림을 만든다. 결과물은 public/ 에 놓이고 저장소에 함께 올린다.
 *
 *   node scripts/og/render.mjs            전부 다시 만든다
 *   node scripts/og/render.mjs og         미리보기 그림(og.png)만
 *   node scripts/og/render.mjs icons      아이콘만
 *
 * 로고 표식의 도형은 src/shared/logoMark.ts에서 가져온다(화면의 로고와 같은 값). TypeScript 파일을 바로 불러오므로
 * Node 22.18 이상에서 실행하고, 그보다 낮으면 `npx tsx scripts/og/render.mjs`로 실행한다.
 * 설치된 Chrome으로 그린다. 내려받은 Chromium을 쓰려면 OG_BROWSER_CHANNEL= 을 빈 값으로 준다.
 * 다른 폴더에 만들어 보려면 OG_OUT_DIR 로 폴더를 정한다.
 * 이 폴더는 빌드에 들어가지 않는다(index.html에서 불러오지 않고 public/ 밖에 있다).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { LOGO_BLUE, LOGO_BOX, LOGO_SHAPES, LOGO_SHAPES_SMALL, logoMarkMarkup } from '../../src/shared/logoMark.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.env.OG_OUT_DIR ?? path.join(here, '../../public'));
const channel = process.env.OG_BROWSER_CHANNEL ?? 'chrome';

const PAPER = '#ffffff';

/**
 * 아이콘 그림. 로고 표식(src/shared/logoMark.ts)을 그대로 그린다.
 * tile이 없으면 바탕이 투명하고 표식이 그림을 꽉 채운다(브라우저 탭용). 탭 바탕이 밝든 어둡든 파란 선이 보인다.
 * tile이 있으면 흰 바탕을 모서리까지 채우고 표식을 가운데에 tile 비율만큼의 크기로 둔다
 * (홈 화면 아이콘용. 기기가 스스로 모양을 잘라 쓰므로 가장자리가 잘려도 표식이 남게 여백을 둔다).
 * small이면 선이 굵은 작은 크기용 모양을 쓴다.
 */
function iconSvg({ small = false, tile = 0 } = {}) {
  const mark = logoMarkMarkup(small ? LOGO_SHAPES_SMALL : LOGO_SHAPES, LOGO_BLUE);
  if (!tile) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_BOX} ${LOGO_BOX}">${mark}</svg>\n`;
  const box = LOGO_BOX / tile;
  const pad = (box - LOGO_BOX) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${box} ${box}"><rect x="${-pad}" y="${-pad}" width="${box}" height="${box}" fill="${PAPER}"/>${mark}</svg>\n`;
}

/** 이 크기 이하로 그릴 때는 작은 크기용 모양을 쓴다 */
const SMALL_MAX = 32;

/** 만들 PNG 아이콘. 구글은 한 변이 48의 배수인 파비콘을 요구한다 */
const ICONS = [
  { file: 'favicon-48.png', size: 48 },
  { file: 'favicon-96.png', size: 96 },
  { file: 'apple-touch-icon.png', size: 180, tile: 0.62 },
  // 매니페스트가 maskable로도 쓰므로 표식이 가운데 원(지름 80%) 안에 들어가게 한다
  { file: 'icon-192.png', size: 192, tile: 0.54 },
  { file: 'icon-512.png', size: 512, tile: 0.54 },
];
/** favicon.ico 안에 넣을 크기 */
const ICO_SIZES = [16, 32, 48];

async function renderSvg(browser, svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return png;
}

/** PNG 여러 장을 그대로 담은 ICO 파일을 만든다 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function renderIcons(browser) {
  // 브라우저는 탭에 SVG 파비콘을 먼저 쓰므로 작은 크기용 모양으로 둔다
  await fs.writeFile(path.join(outDir, 'favicon.svg'), iconSvg({ small: true }));
  for (const { file, size, tile } of ICONS) {
    await fs.writeFile(path.join(outDir, file), await renderSvg(browser, iconSvg({ small: size <= SMALL_MAX, tile }), size));
  }
  const ico = [];
  for (const size of ICO_SIZES) ico.push({ size, png: await renderSvg(browser, iconSvg({ small: size <= SMALL_MAX }), size) });
  await fs.writeFile(path.join(outDir, 'favicon.ico'), buildIco(ico));
}

async function renderOg(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'og.html')).href, { waitUntil: 'networkidle' });
  // 이름 옆의 표식은 화면의 로고와 같은 도형으로 채운다
  await page.evaluate(
    ({ box, mark }) => {
      const svg = document.querySelector('.brand svg');
      svg.setAttribute('viewBox', `0 0 ${box} ${box}`);
      svg.innerHTML = mark;
    },
    { box: LOGO_BOX, mark: logoMarkMarkup(LOGO_SHAPES, LOGO_BLUE) },
  );
  // 글꼴을 다 받은 뒤에 찍는다
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(outDir, 'og.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await page.close();
}

const what = process.argv[2] ?? 'all';
await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch(channel ? { channel } : {});
try {
  if (what === 'all' || what === 'icons') await renderIcons(browser);
  if (what === 'all' || what === 'og') await renderOg(browser);
} finally {
  await browser.close();
}
console.log(`${what} -> ${outDir}`);
