/**
 * 방문 통계(Cloudflare Web Analytics). 쿠키를 쓰지 않고 방문 수와 유입 경로만 모은다.
 * 운영 주소에서만 켠다. 로컬 실행과 테스트에서는 바깥으로 아무것도 보내지 않는다.
 */
const ANALYTICS_HOST = 'modelll.app';
/** 페이지에 그대로 실려 나가는 공개 값이다 */
const BEACON_TOKEN = '2121c5e5c97d43e99b16d643f942c07a';
const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** 통계를 켜도 되는 주소인지 */
export function analyticsEnabled(hostname: string): boolean {
  return hostname === ANALYTICS_HOST;
}

export function startAnalytics(): void {
  if (typeof document === 'undefined' || !analyticsEnabled(location.hostname)) return;
  if (document.querySelector('script[data-cf-beacon]')) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = BEACON_SRC;
  script.setAttribute('data-cf-beacon', JSON.stringify({ token: BEACON_TOKEN }));
  document.head.appendChild(script);
}
