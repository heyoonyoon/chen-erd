// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { setIndexable } from './seo';

const robots = () => [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="robots"]')].map((m) => m.content);
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href') ?? null;

describe('검색 로봇 표시', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="robots" content="max-image-preview:large"><link rel="canonical" href="https://modelll.app/">';
  });

  it('방 화면에서는 noindex를 붙이고 대표 주소를 뗀다', () => {
    setIndexable(false);
    setIndexable(false);
    expect(robots()).toEqual(['max-image-preview:large', 'noindex, nofollow']);
    expect(canonical()).toBeNull();
  });

  it('첫 화면으로 돌아오면 원래대로 돌린다', () => {
    setIndexable(false);
    setIndexable(true);
    setIndexable(true);
    expect(robots()).toEqual(['max-image-preview:large']);
    expect(canonical()).toBe('https://modelll.app/');
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  });
});
