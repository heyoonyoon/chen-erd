/**
 * 첫 화면의 세 단계 구역. 이름 modelll의 l 세 개가 데이터베이스 설계의 세 단계(개념적, 논리적, 물리적)다.
 * 넓은 화면에서는 이 구역을 스크롤하는 동안 이름과 설명이 화면에 고정되고, 고정 구간을 세 칸으로 나눠
 * 스크롤 위치가 들어간 칸이 지금 단계가 된다. 단계가 바뀌면 이름 끝에 l이 하나 튀어나오고(되돌리면 들어가고)
 * 설명과 영상 묶음이 옆으로 빠져나간 뒤 새 묶음이 들어온다. 지금 단계의 영상은 처음부터 보통 속도로 반복 재생한다.
 * 움직임 줄이기에서는 튀어나오기와 찢어짐 없이 짧게 겹쳐 바뀌고 영상은 재생 버튼으로 본다.
 * 좁은 화면에서는 고정 없이 세 단계를 차례로 쌓는다.
 * 영상은 scripts/record-landing.mjs가 실제 앱을 녹화해 public/landing/ 아래에 만든다.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { APP_NAME, useT, type MessageKey, type TFunction } from '../i18n';
import { runMosaic, SKIP_ATTR } from './mosaic';

/** 관계 모델 표기 한 줄. 논리적 설계 설명 문장 안에 넣는다 */
export function relationExample(t: TFunction): string {
  return `${t('home.sample.student')} (${t('home.sample.studentId')}, ${t('home.sample.name')}, ${t('home.sample.deptCode')})`;
}

export const STAGES: Array<{ id: 'conceptual' | 'logical' | 'physical'; name: MessageKey; title: MessageKey; body: MessageKey }> = [
  { id: 'conceptual', name: 'home.stage.conceptual.name', title: 'home.stage.conceptual.title', body: 'home.stage.conceptual.body' },
  { id: 'logical', name: 'home.stage.logical.name', title: 'home.stage.logical.title', body: 'home.stage.logical.body' },
  { id: 'physical', name: 'home.stage.physical.name', title: 'home.stage.physical.title', body: 'home.stage.physical.body' },
];

/** 영상 파일의 자리. public/landing/ 아래에 있다 */
export const videoSrc = (id: string, ext: 'mp4' | 'jpg') => `/landing/${id}.${ext}`;

/** 상단 바 높이. 고정된 이름은 이 아래에 붙는다 */
const NAV_H = 64;
/** 고정해서 보여 주는 넓은 화면의 기준 */
const PIN_QUERY = '(min-width: 961px) and (min-height: 640px)';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** 고정 구간을 지나온 정도(0~1)가 몇째 칸인지. 칸은 단계 수만큼 고르게 나눈다 */
export function stageAt(p: number, count = STAGES.length): number {
  if (!(p > 0)) return 0;
  return Math.min(count - 1, Math.floor(p * count));
}

/** 칸 경계의 여유(칸 하나 대비 비율) */
const HYST = 0.04;
/** 단계가 바뀔 때의 시간(ms). 설명이 올라오는 움직임은 다른 구역의 Reveal(home-reveal)과 같다 */
const MOSAIC_MS = 750;
/** l 하나가 늘어나 떨어져 나오는 시간(ms). 되돌릴 때는 같은 움직임을 거꾸로 돌린다 */
const GOO_MS = 560;

function useMedia(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [match, setMatch] = useState(() => supported && window.matchMedia(query).matches);
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query, supported]);
  return match;
}

/**
 * 고정 구간에서 지금 단계와 구역이 화면에 걸쳐 있는지. 첫 화면은 .home이 스크롤되므로 어느 요소의 스크롤이든 잡는다.
 */
function useScrollStage(ref: React.RefObject<HTMLElement | null>, enabled: boolean): { stage: number; onScreen: boolean } {
  const [state, setState] = useState({ stage: 0, onScreen: false });
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      // 아직 그려지지 않았으면(높이 0) 첫 단계에 둔다
      if (!r.height) return;
      const vh = window.innerHeight;
      const range = Math.max(1, r.height - (vh - NAV_H));
      const p = (NAV_H - r.top) / range;
      const onScreen = r.top < vh && r.bottom > NAV_H;
      setState((s) => {
        // 칸 경계에서 조금 흔들려도 단계가 오가지 않게, 지금 칸을 경계 너머로 조금(HYST) 벗어나야 바꾼다
        const raw = p * STAGES.length;
        const stage = raw > s.stage - HYST && raw < s.stage + 1 + HYST ? s.stage : stageAt(p);
        return s.stage === stage && s.onScreen === onScreen ? s : { stage, onScreen };
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
  return state;
}

/**
 * 실제 서비스 화면 영상. 소리가 없고 끝나면 처음부터 다시 돈다.
 *  - auto: 고정된 넓은 화면. 지금 단계가 되면 처음부터 재생하고, 다른 단계가 되면 멈춘다.
 *  - button: 좁은 화면과 움직임 줄이기. 첫 화면 그림(poster)과 재생 버튼을 두고 누르면 재생한다.
 * 구역 가까이 오기 전에는 내려받지 않는다(load).
 */
function StageVideo({ id, label, mode, load, playing }: { id: string; label: string; mode: 'auto' | 'button'; load: boolean; playing: boolean }) {
  const t = useT();
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || mode !== 'auto' || typeof el.play !== 'function') return;
    if (!playing) {
      // 멈출 때 처음으로 돌려 둔다. 다음에 이 단계가 되면 첫 장면이 이미 준비되어 있어 모자이크와 재생이 튀지 않는다
      el.pause();
      if (el.currentTime > 0 && el.readyState >= 1) el.currentTime = 0;
      return;
    }
    // 지금 단계가 되면 처음부터 한 번만 재생을 건다. 다시 불러오기(load)나 반복 재시도는 하지 않는다
    // (둘 다 재생 위치를 0으로 되돌려 영상이 뒤로 튀는 원인이었다)
    let off = false;
    const start = () => {
      if (off) return;
      el.muted = true;
      el.play()?.catch(() => undefined);
    };
    if (el.currentTime > 0) el.currentTime = 0;
    if (el.readyState >= 2) start();
    else {
      if (el.readyState === 0 && el.networkState !== el.NETWORK_LOADING) el.load();
      el.addEventListener('canplay', start, { once: true });
    }
    return () => {
      off = true;
      el.removeEventListener('canplay', start);
      el.pause();
    };
  }, [mode, playing]);
  const start = () => {
    const el = ref.current;
    if (!el) return;
    setStarted(true);
    el.controls = true;
    el.play()?.catch(() => undefined);
  };
  return (
    <div className="home-story-video" data-testid={`home-stage-video-${id}`}>
      <video ref={ref} muted loop playsInline preload={mode === 'auto' && load ? 'auto' : 'none'} poster={videoSrc(id, 'jpg')} width={1280} height={800} aria-label={label}>
        {/* H.264 mp4 하나만 쓴다. 키프레임을 촘촘히 넣은 VP9 webm은 Chrome에서 처음으로 되감을 때 디코딩 오류가 나 멈췄다 */}
        <source src={videoSrc(id, 'mp4')} type="video/mp4" />
      </video>
      {mode === 'button' && !started && (
        <button type="button" className="home-story-play" onClick={start} aria-label={t('home.story.play', { label })}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 4.2v11.6L15.5 10z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}

const posters = new Map<string, HTMLImageElement>();
function posterOf(id: string): HTMLImageElement {
  let img = posters.get(id);
  if (!img) {
    img = new Image();
    img.src = videoSrc(id, 'jpg');
    posters.set(id, img);
  }
  return img;
}

/**
 * 영상 상자 안쪽 크기(CSS px)의 첫 화면 그림. 모자이크가 이 그림을 덮었다가 푼다.
 * 영상의 첫 프레임인 poster를 쓰고, 못 받으면 영상의 지금 프레임을 그린다.
 */
async function frameOf(box: HTMLElement, id: string): Promise<HTMLCanvasElement | null> {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return null;
  const video = box.querySelector('video');
  // 영상이 막 처음부터 재생을 시작했으니 지금 프레임(첫 장면)을 쓴다. poster는 완성된 마지막 장면이라
  // 그걸로 덮으면 모자이크가 풀린 뒤 빈 첫 장면으로 바뀌며 튀어 보인다. 영상 데이터가 아직 없을 때만 poster를 쓴다
  let src: CanvasImageSource | null = video && video.readyState >= 2 ? video : null;
  if (!src) {
    const img = posterOf(id);
    try {
      await img.decode();
      src = img;
    } catch {
      return null;
    }
  }
  if (!src) return null;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, W, H);
  return out;
}

/** li 안 영상 상자의 지금 화면을 상자 크기(CSS px)의 canvas로 찍는다. 못 찍으면 null */
function grabFrame(li: HTMLElement): HTMLCanvasElement | null {
  const box = li.querySelector<HTMLElement>('.home-story-video');
  const video = box?.querySelector('video');
  if (!box || !video || video.readyState < 2) return null;
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return null;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  // 영상은 상자 안에 비율을 지켜(contain) 들어 있으므로 같은 자리에 그린다
  ctx.fillStyle = getComputedStyle(box).backgroundColor || '#fff';
  ctx.fillRect(0, 0, W, H);
  const vw = video.videoWidth || W;
  const vh = video.videoHeight || H;
  const k = Math.min(W / vw, H / vh);
  const dw = vw * k;
  const dh = vh * k;
  try {
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } catch {
    return null;
  }
  return c;
}

/** 영상 상자를 모자이크로 덮었다가 히어로 화면 예시처럼 대각선으로 풀어 드러낸다. 멈추는 함수를 돌려준다 */
function revealVideo(li: HTMLElement, id: string, reverse: boolean, under: HTMLCanvasElement | null): () => void {
  const box = li.querySelector<HTMLElement>('.home-story-video');
  if (!box) return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'home-mosaic';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute(SKIP_ATTR, '');
  box.appendChild(canvas);
  const remove = () => canvas.remove();
  const stop = runMosaic(box, canvas, { duration: MOSAIC_MS, immediate: true, reverse, under, source: () => frameOf(box, id), onDone: remove });
  return () => {
    stop();
    remove();
  };
}

/**
 * 지금 단계가 바뀌면 이전 묶음은 짧게 사라지고, 새 묶음의 설명은 아래에서 올라오며 영상은 모자이크가 풀리며 드러난다.
 * 움직이는 도중에 또 바뀌면 진행 중인 움직임을 걷고 새 단계의 움직임을 바로 시작한다.
 */
function useStageSwitch(listRef: React.RefObject<HTMLOListElement | null>, shown: number, reduced: boolean) {
  const prev = useRef(shown);
  const mosaics = useRef(new Map<number, () => void>());
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = shown;
    const list = listRef.current;
    if (!list || shown < 0 || from < 0 || from === shown) return;
    const items = [...list.children] as HTMLElement[];
    const out = items[from];
    const inn = items[shown];
    if (!out || !inn) return;
    const reset = (i: number) => {
      mosaics.current.get(i)?.();
      mosaics.current.delete(i);
    };
    reset(from);
    reset(shown);
    if (reduced) return;
    // 설명이 올라오는 움직임과 이전 묶음이 사라지는 움직임은 CSS(is-active)가 맡는다. 여기서는 영상 모자이크만 건다
    // 위로 거꾸로 돌아갈 때는 오른쪽 아래에서 왼쪽 위로 푼다
    // 이전 단계 영상의 지금 화면을 찍어 둔다(이 뒤에 멈추고 처음으로 되감긴다). 모자이크 경계가 닿기 전까지는 이 화면이 그대로 보인다
    mosaics.current.set(shown, revealVideo(inn, STAGES[shown].id, shown < from, grabFrame(out)));
  }, [listRef, shown, reduced]);
  useEffect(() => {
    const map = mosaics.current;
    return () => map.forEach((stop) => stop());
  }, []);
}

/**
 * 이름 끝 l 한 글자의 폭(--lw)을 잰다.
 * 새 l은 이 폭만큼 자리를 벌리며 나온다.
 */
function useLetterWidth(logoRef: React.RefObject<HTMLParagraphElement | null>, enabled: boolean, lw: React.MutableRefObject<number>) {
  useLayoutEffect(() => {
    const logo = logoRef.current;
    const first = logo?.querySelector<HTMLElement>('.home-story-slot');
    if (!enabled || !logo || !first) return;
    const measure = () => {
      lw.current = first.getBoundingClientRect().width;
      logo.style.setProperty('--lw', `${lw.current}px`);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(first);
    return () => ro.disconnect();
  }, [logoRef, enabled, lw]);
}

/** 끈적한 다리: l 획 세로 가운데(0.42em)에서 위아래로 떨어진 자리(em)와 끊기는 시점(진행도). 아래, 위, 가운데 차례로 끊긴다 */
const BRIDGES = [
  { dy: 0.24, cut: 0.42 },
  { dy: -0.24, cut: 0.52 },
  { dy: 0, cut: 0.64 },
];
/** 마지막 다리가 끊기는 시점 */
const RELEASE = 0.64;
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

/** 진행도 t(0~1)에서 새 l의 가로 위치(한 글자 폭 단위)와 세로 배율. 처음엔 빠르게 나가다 다리에 붙들려 느려지고, 끊기면 작게 반동한다 */
function gooPose(t: number): { x: number; sy: number } {
  if (t < RELEASE) {
    const x = 0.95 * ease(t / RELEASE);
    return { x, sy: 0.1 + 0.9 * ease(t / 0.4) };
  }
  const s = (t - RELEASE) / (1 - RELEASE);
  const damp = Math.exp(-4 * s);
  const x = 1 + (-0.05 * Math.cos(2.4 * Math.PI * s) + 0.075 * Math.sin(2.4 * Math.PI * s)) * damp * (1 - s);
  return { x, sy: 1 - (x - 1) * 0.6 };
}

/** 진행도 t에서 필터 번짐의 비율. 마지막 다리가 끊긴 뒤 서서히 0으로 줄여 실제 글자 모양으로 모은다 */
const blurAt = (t: number) => (t <= RELEASE ? 1 : Math.max(0, 1 - (t - RELEASE) / (0.96 - RELEASE)));

/**
 * l이 앞 l의 세로 가운데에서 그물 펼치듯 위아래로 늘어나며 오른쪽으로 빠르게 나가고, 두 l 사이의 끈적한 다리 세 가닥이
 * 늘어지다 시간차를 두고 끊기면 작게 반동하며 제자리에 앉는다. 거꾸로 가면 같은 움직임을 거꾸로 돌려 앞 l 속으로 빨려 들어간다.
 * 끈적함은 흐림 + 알파 대비 필터(goo)로 내고, 움직이는 동안에만 필터를 씌운 사본(home-story-goo)을 보인다.
 * 끝으로 갈수록 흐림을 0으로 줄여 사본이 원래 글자 모양과 같아진 뒤 선명한 글자로 바꾼다.
 */
function useLetterGoo(logoRef: React.RefObject<HTMLParagraphElement | null>, count: number, enabled: boolean, lw: React.MutableRefObject<number>) {
  const prev = useRef(count);
  const runs = useRef(new Map<number, { anims: Animation[]; dir: 1 | -1; frame: number }>());
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = count;
    const logo = logoRef.current;
    if (!enabled || !logo || before === count || !lw.current) return;
    const slots = [...logo.querySelectorAll<HTMLElement>('.home-story-slot')];
    const w = lw.current;
    const fs = Number.parseFloat(getComputedStyle(logo).fontSize) || 100;
    const changed: number[] = [];
    for (let i = 1; i < slots.length; i++) if (i < before !== i < count) changed.push(i);
    // 여러 칸을 한 번에 건너뛰면 차례로 움직인다(나올 때는 앞에서부터, 들어갈 때는 뒤에서부터)
    const dir: 1 | -1 = count > before ? 1 : -1;
    if (dir < 0) changed.reverse();
    changed.forEach((i, k) => {
      const slot = slots[i];
      const goo = slot.querySelector<HTMLElement>('.home-story-goo');
      const real = slot.querySelector<HTMLElement>('.home-story-l');
      const b = slot.querySelector<HTMLElement>('.home-story-goo-b');
      const bridges = [...slot.querySelectorAll<HTMLElement>('.home-story-goo-bridge')];
      const blur = logo.querySelector(`[data-goo="${i}"] feGaussianBlur`);
      const contrast = logo.querySelector(`[data-goo="${i}"] feColorMatrix`);
      if (!goo || !real || !b || bridges.length !== BRIDGES.length || typeof slot.animate !== 'function') return;
      // 진행 중이던 움직임이 있으면 그 자리(진행도)에서 거꾸로 이어 간다
      const running = runs.current.get(i);
      let at = 0;
      if (running) {
        const t = Number(running.anims[0]?.currentTime ?? 0);
        if (running.anims[0]?.playState === 'running' && running.dir !== dir) at = Math.max(0, GOO_MS - t);
        running.anims.forEach((a) => a.cancel());
        cancelAnimationFrame(running.frame);
      }
      const opts: KeyframeAnimationOptions = { duration: GOO_MS, direction: dir > 0 ? 'normal' : 'reverse', delay: at ? 0 : k * 140, fill: 'backwards', easing: 'linear' };
      // 곡선을 잘게 나눠 그대로 따라가게 한다
      const N = 28;
      const ts = Array.from({ length: N + 1 }, (_, n) => n / N);
      const poses = ts.map(gooPose);
      const px = (v: number) => `${v.toFixed(2)}px`;
      const anims = [
        slot.animate(poses.map((p) => ({ width: px(Math.max(0, p.x * w)) })), opts),
        b.animate(poses.map((p) => ({ transform: `translateX(${px(p.x * w)}) scaleY(${p.sy.toFixed(3)})` })), opts),
        ...bridges.map((el, j) =>
          el.animate(
            ts.map((t, n) => {
              const { cut, dy } = BRIDGES[j];
              // 늘어날수록 가늘어지다 끊긴다. 새 l이 위아래로 펼쳐지는 만큼 다리도 벌어진다
              const th = t < cut ? Math.pow(1 - t / cut, 0.8) : 0;
              return { transform: `translateY(${px(dy * fs * poses[n].sy)}) scale(${poses[n].x.toFixed(3)}, ${th.toFixed(3)})` };
            }),
            opts,
          ),
        ),
        goo.animate([{ visibility: 'visible' }, { visibility: 'visible' }], opts),
        real.animate([{ opacity: 0 }, { opacity: 0 }], opts),
      ];
      if (at) anims.forEach((a) => (a.currentTime = at));
      const base = Math.max(2, fs * 0.04);
      const run = { anims, dir, frame: 0 };
      const tick = () => {
        const p = anims[0].effect?.getComputedTiming().progress;
        if (typeof p === 'number') {
          // 번짐과 알파 대비를 함께 줄여 끝에서는 필터가 아무것도 바꾸지 않게 한다
          const f = blurAt(p);
          blur?.setAttribute('stdDeviation', (base * f).toFixed(2));
          contrast?.setAttribute('values', `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${(1 + 19 * f).toFixed(2)} ${(-7 * f).toFixed(2)}`);
        }
        if (anims[0].playState === 'running') run.frame = requestAnimationFrame(tick);
      };
      tick();
      runs.current.set(i, run);
      anims[0].finished.then(
        () => {
          cancelAnimationFrame(run.frame);
          if (runs.current.get(i) === run) runs.current.delete(i);
        },
        () => undefined,
      );
    });
  }, [logoRef, count, enabled, lw]);
}

export function HomeStages() {
  const t = useT();
  const titleId = useId();
  const gooId = `home-goo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pinned = useMedia(PIN_QUERY);
  const reduced = useMedia(REDUCE_QUERY);
  const trackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const logoRef = useRef<HTMLParagraphElement>(null);
  const lw = useRef(0);
  const { stage, onScreen } = useScrollStage(trackRef, pinned);
  // 구역에 한 번 가까이 오면 영상을 내려받기 시작한다
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (onScreen) setNear(true);
  }, [onScreen]);
  const relation = relationExample(t);
  // 고정된 동안: 들어간 칸이 지금 단계다. 고정하지 않으면 세 단계가 다 켜진 채로 쌓인다
  const shown = pinned ? stage : -1;
  const goo = pinned && !reduced;
  useStageSwitch(listRef, shown, reduced);
  useLetterWidth(logoRef, pinned, lw);
  useLetterGoo(logoRef, shown + 1, goo, lw);
  const lit = (i: number) => !pinned || i <= shown;
  return (
    <section className={pinned ? 'home-story is-pinned' : 'home-story'} aria-labelledby={titleId} data-testid="home-stages" data-stage={pinned ? STAGES[shown].id : undefined}>
      <div ref={trackRef} className="home-story-track">
        <div className="home-story-pin">
          <h2 id={titleId} className="home-story-lead">
            {t('home.story.lead', { name: APP_NAME })}
          </h2>
          {/* 이름의 끝 세 글자가 각 단계다. 뜻은 위의 문장과 단계 이름이 전하므로 보조 기술에는 읽히지 않게 한다 */}
          <p ref={logoRef} className="home-story-logo" aria-hidden="true" data-testid="home-story-logo">
            <span className="home-story-model">{APP_NAME.slice(0, -STAGES.length)}</span>
            {STAGES.map((st, i) => (
              <span key={st.id} className={lit(i) ? 'home-story-slot is-on' : 'home-story-slot'}>
                <span className={lit(i) ? 'home-story-l is-on' : 'home-story-l'} data-testid="home-story-l">
                  l
                </span>
                {goo && i > 0 && (
                  // 끈적하게 나오는 동안만 보이는 사본: 앞 l, 다리, 새 l
                  <span className="home-story-goo" style={{ filter: `url("#${gooId}-${i}")` }}>
                    <span className="home-story-goo-a">l</span>
                    {BRIDGES.map((_, j) => (
                      <span key={j} className="home-story-goo-bridge" />
                    ))}
                    <span className="home-story-goo-b">l</span>
                  </span>
                )}
              </span>
            ))}
            {goo && (
              // 흐리게 번진 뒤 알파 대비를 세게 줘서 가까운 두 모양이 끈적하게 붙어 보이게 한다
              <svg className="home-story-defs" width="0" height="0" aria-hidden="true" focusable="false">
                {STAGES.slice(1).map((st, j) => (
                  // 칸마다 따로 둔다. 움직이는 동안 번짐(stdDeviation)을 칸마다 따로 줄인다
                  <filter key={st.id} id={`${gooId}-${j + 1}`} data-goo={j + 1} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b" />
                    <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -7" />
                  </filter>
                ))}
              </svg>
            )}
          </p>
          <ol ref={listRef} className="home-story-stages">
            {STAGES.map((st, i) => (
              <li
                key={st.id}
                className={i === shown || !pinned ? 'home-story-stage is-active' : 'home-story-stage'}
                data-testid={`home-stage-${st.id}`}
                aria-hidden={pinned && i !== shown ? true : undefined}
              >
                <div className="home-story-text">
                  <h3 className="home-stage-name">
                    <span>{i + 1}</span>
                    {t(st.name)}
                  </h3>
                  <p className="home-story-title">{t(st.title)}</p>
                  <p className="home-story-body">{t(st.body, { relation })}</p>
                </div>
                <StageVideo
                  id={st.id}
                  label={t('home.story.video', { stage: t(st.name) })}
                  mode={pinned && !reduced ? 'auto' : 'button'}
                  load={near}
                  playing={pinned && !reduced && onScreen && i === shown}
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
