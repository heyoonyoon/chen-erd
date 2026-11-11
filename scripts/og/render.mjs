/**
 * 검색 결과와 링크 미리보기에 쓰이는 그림을 만든다. 결과물은 public/ 에 놓이고 저장소에 함께 올린다.
 *
 *   node scripts/og/render.mjs            전부 다시 만든다
 *   node scripts/og/render.mjs og         미리보기 그림(og.png)만
 *   node scripts/og/render.mjs icons      아이콘만
 *
 * 설치된 Chrome으로 그린다. 내려받은 Chromium을 쓰려면 OG_BROWSER_CHANNEL= 을 빈 값으로 준다.
 * 다른 폴더에 만들어 보려면 OG_OUT_DIR 로 폴더를 정한다.
 * 이 폴더는 빌드에 들어가지 않는다(index.html에서 불러오지 않고 public/ 밖에 있다).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.env.OG_OUT_DIR ?? path.join(here, '../../public'));
const channel = process.env.OG_BROWSER_CHANNEL ?? 'chrome';

const INK = '#171717';
const PAPER = '#ffffff';

/**
 * 아이콘 그림. 어두운 바탕에 흰 마름모 하나를 둔다(첫 화면 로고와 같은 비율).
 * 작은 크기에서도 선이 보이도록 로고보다 선을 굵게 긋는다.
 * rounded가 아니면 모서리까지 채운다(기기가 스스로 모양을 잘라 쓰는 아이콘용).
 */
function iconSvg({ rounded }) {
  const bg = rounded ? `<rect width="48" height="48" rx="11" fill="${INK}"/>` : `<rect width="48" height="48" fill="${INK}"/>`;
  // 모서리까지 채우는 아이콘은 가장자리가 잘려도 마름모가 남도록 조금 작게 그린다
  const mark = rounded
    ? `<path d="M24 11.5 37.5 24 24 36.5 10.5 24Z" fill="none" stroke="${PAPER}" stroke-width="4" stroke-linejoin="round"/>`
    : `<path d="M24 13.5 35.5 24 24 34.5 12.5 24Z" fill="none" stroke="${PAPER}" stroke-width="3.5" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${bg}${mark}</svg>\n`;
}

/** 만들 PNG 아이콘. 구글은 한 변이 48의 배수인 파비콘을 요구한다 */
const ICONS = [
  { file: 'favicon-48.png', size: 48, rounded: true },
  { file: 'favicon-96.png', size: 96, rounded: true },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
  { file: 'icon-192.png', size: 192, rounded: false },
  { file: 'icon-512.png', size: 512, rounded: false },
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
  await fs.writeFile(path.join(outDir, 'favicon.svg'), iconSvg({ rounded: true }));
  for (const { file, size, rounded } of ICONS) {
    await fs.writeFile(path.join(outDir, file), await renderSvg(browser, iconSvg({ rounded }), size));
  }
  const ico = [];
  for (const size of ICO_SIZES) ico.push({ size, png: await renderSvg(browser, iconSvg({ rounded: true }), size) });
  await fs.writeFile(path.join(outDir, 'favicon.ico'), buildIco(ico));
}

async function renderOg(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'og.html')).href, { waitUntil: 'networkidle' });
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
