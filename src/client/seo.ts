/**
 * 검색 로봇에게 주는 표시를 지금 화면에 맞춘다.
 * 방은 주소를 받은 사람만 들어오는 곳이라 검색에 나오면 안 된다. 서버도 /r/ 응답에 X-Robots-Tag를 붙인다(src/server/http.ts).
 * 여기서는 새로 고침 없이 화면이 바뀔 때 문서 머리가 어긋나지 않게 한다.
 */

const MARK = 'data-route-robots';

/** index.html에 적힌 대표 주소 표시. 방 화면에서는 떼어 두었다가 첫 화면으로 돌아오면 다시 붙인다 */
let canonical: HTMLLinkElement | null = null;

/** indexable이 false면 noindex 표시를 붙이고 대표 주소 표시를 뗀다. true면 원래대로 돌린다 */
export function setIndexable(indexable: boolean): void {
  const head = document.head;
  canonical = head.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? canonical;
  const meta = head.querySelector(`meta[${MARK}]`);

  if (indexable) {
    meta?.remove();
    if (canonical && !canonical.isConnected) head.appendChild(canonical);
    return;
  }
  if (!meta) {
    const el = document.createElement('meta');
    el.name = 'robots';
    el.content = 'noindex, nofollow';
    el.setAttribute(MARK, '');
    head.appendChild(el);
  }
  // 방 주소가 첫 화면과 같은 문서라고 알리지 않는다
  canonical?.remove();
}
