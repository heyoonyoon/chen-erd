/**
 * AI가 다이어그램을 읽고 쓰는 두 가지 길(CLI, MCP)에서 화면이 함께 쓰는 값.
 * 방의 상단 바와 첫 화면이 같은 값을 쓴다. 명령과 도구 이름은 번역하지 않는다.
 */

/** MCP로 연결할 때 클라이언트에 추가하는 원격 MCP 서버 주소. 지금 열려 있는 사이트를 기준으로 만들어 로컬에서 띄운 서버에서도 맞는 값이 나온다 */
export function remoteMcpUrl(): string {
  return `${location.origin}/mcp`;
}

/**
 * 글자를 클립보드에 넣는다. 성공하면 true.
 * 클립보드 API를 쓸 수 없으면(보안 연결이 아닌 주소 등) 보이지 않는 입력창을 선택해 복사하는 옛 방식으로 한 번 더 시도한다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 거부되면 아래 방식으로 넘어간다 */
  }
  const active = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(area);
  let ok = false;
  try {
    area.select();
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  // 복사하느라 옮긴 포커스를 누른 버튼으로 되돌린다
  if (active instanceof HTMLElement) active.focus();
  return ok;
}
