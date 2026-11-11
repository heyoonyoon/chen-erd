/**
 * 첫 화면 상단에 보여 줄 GitHub 저장소의 별 수. 공개 API를 한 번 부르고 한 시간 동안 브라우저에 기억해 둔다.
 */
import { useEffect, useState } from 'react';

export const REPO_URL = 'https://github.com/heyoonyoon/chen-erd';
const API_URL = 'https://api.github.com/repos/heyoonyoon/chen-erd';
const CACHE_KEY = 'chen-erd.stars';
const CACHE_MS = 60 * 60 * 1000;

/** 1234 → 1.2k, 121500 → 121.5k */
export function formatStars(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count < 1000) return String(Math.floor(count));
  const k = Math.floor(count / 100) / 10;
  return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
}

function readCache(now: number): { count: number; fresh: boolean } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { count?: unknown; at?: unknown };
    if (typeof saved.count !== 'number' || typeof saved.at !== 'number') return null;
    return { count: saved.count, fresh: now - saved.at < CACHE_MS };
  } catch {
    return null;
  }
}

/** 별 수. 아직 모르거나 가져오지 못했으면 null */
export function useGithubStars(): number | null {
  const [count, setCount] = useState<number | null>(() => readCache(Date.now())?.count ?? null);
  useEffect(() => {
    // 테스트에서는 바깥으로 요청을 보내지 않는다
    if (import.meta.env.MODE === 'test' || typeof fetch !== 'function') return;
    if (readCache(Date.now())?.fresh) return;
    let alive = true;
    fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { stargazers_count?: unknown } | null) => {
        const stars = body?.stargazers_count;
        if (typeof stars !== 'number') return;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ count: stars, at: Date.now() }));
        } catch {
          // 저장하지 못해도 화면에는 보여 준다
        }
        if (alive) setCount(stars);
      })
      .catch(() => {
        // 요청 한도에 걸리거나 오프라인이면 숫자 없이 로고만 보인다
      });
    return () => {
      alive = false;
    };
  }, []);
  return count;
}
