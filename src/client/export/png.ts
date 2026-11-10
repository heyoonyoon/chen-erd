/**
 * PNG 내보내기 보조 함수(순수 함수, DOM을 쓰지 않는다). [담당: export 에이전트]
 */

/** 브라우저 canvas의 안전한 한계. 넘으면 빈 그림이 나오거나 탭이 죽는다. */
export const MAX_CANVAS_SIDE = 16000;
/** 전체 픽셀 수 한계(약 8000 x 8000). 픽셀당 4바이트라 이 정도가 메모리 256MB */
export const MAX_CANVAS_AREA = 64_000_000;

/**
 * 가로세로 w x h(px)짜리 그림을 scale배로 그릴 때 canvas 한계를 넘지 않는 배율.
 * 한계 안이면 scale을 그대로 돌려준다.
 */
export function fitScale(
  w: number,
  h: number,
  scale: number,
  maxSide: number = MAX_CANVAS_SIDE,
  maxArea: number = MAX_CANVAS_AREA,
): number {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 2;
  if (!(w > 0) || !(h > 0)) return s;
  return Math.min(s, maxSide / w, maxSide / h, Math.sqrt(maxArea / (w * h)));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, from: number, to: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = from; i < to; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

/**
 * PNG에 해상도 정보(pHYs)를 넣는다.
 * 2배로 그린 PNG에 192dpi라고 적어 두면 워드, 한글에 넣었을 때 화면에서 보던 크기로 들어가고 인쇄는 선명하다.
 * (정보가 없으면 96dpi로 보고 두 배 크기로 들어간다.) PNG가 아니면 받은 그대로 돌려준다.
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!Number.isFinite(dpi) || dpi <= 0) return png;
  if (png.length < 8 + 25) return png;
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIGNATURE[i]) return png;
  if (chunkType(png, 8) !== 'IHDR') return png;

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 12 + view.getUint32(8);
  if (ihdrEnd > png.length) return png;

  // IDAT 앞에 이미 pHYs가 있으면 그 자리는 건너뛰고 새로 쓴다
  const keep: Array<[number, number]> = [[0, ihdrEnd]];
  let pos = ihdrEnd;
  while (pos + 12 <= png.length) {
    const end = pos + 12 + view.getUint32(pos);
    if (end > png.length) return png;
    const type = chunkType(png, pos);
    if (type === 'IDAT') break;
    if (type !== 'pHYs') keep.push([pos, end]);
    pos = end;
  }
  keep.push([pos, png.length]);

  const phys = new Uint8Array(21);
  const pv = new DataView(phys.buffer);
  const perMeter = Math.round(dpi / 0.0254);
  pv.setUint32(0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  pv.setUint32(8, perMeter);
  pv.setUint32(12, perMeter);
  phys[16] = 1; // 단위: 미터
  pv.setUint32(17, crc32(phys, 4, 17));

  const total = keep.reduce((sum, [a, b]) => sum + (b - a), 0) + phys.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  let o = 0;
  keep.forEach(([a, b], i) => {
    out.set(png.subarray(a, b), o);
    o += b - a;
    if (i === 0) {
      out.set(phys, o);
      o += phys.length;
    }
  });
  return out;
}

/** PNG의 pHYs에 적힌 dpi를 읽는다(테스트, 확인용). 없으면 null */
export function readPngDpi(png: Uint8Array): number | null {
  if (png.length < 8) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = chunkType(png, pos);
    if (type === 'pHYs' && len === 9) return Math.round(view.getUint32(pos + 8) * 0.0254);
    if (type === 'IDAT' || type === 'IEND') return null;
    pos += 12 + len;
  }
  return null;
}
