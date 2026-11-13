/**
 * 관리자 페이지의 HTML. 의존성 없이 서버가 그대로 내보내고, 화면은 /api/summary 와 /api/daily 를 받아 인라인 SVG로 그린다.
 * 스크립트와 스타일은 응답마다 받은 nonce로만 실행된다(CSP). style 속성은 쓰지 않는다(CSP가 막는다).
 * 화면에 넣는 값은 모두 esc()를 거친다.
 */

/** HTML 본문과 속성에 넣을 문자열을 이스케이프한다 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c] as string);
}

const STYLE = `
:root { --bg: #f7f7f8; --panel: #fff; --border: #e2e4e8; --text: #1a1a1a; --dim: #6b7280; --faint: #9ca3af; --accent: #0d6efd; --soft: #e7f1ff; --green: #198754; --orange: #e08a00; --red: #dc3545; --purple: #7c3aed;
  --font: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font); font-size: 13px; line-height: 1.45; color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; word-break: keep-all; }
h1, h2, h3, p { margin: 0; }
.top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 24px; background: rgba(255,255,255,.92); backdrop-filter: blur(6px); border-bottom: 1px solid var(--border); }
.top h1 { font-size: 15px; font-weight: 700; }
.top .badge { font-size: 11px; color: var(--dim); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }
.top .grow { flex: 1; }
.top .updated { color: var(--dim); font-size: 12px; }
.btn { height: 30px; padding: 0 12px; border: 1px solid #c9ccd2; border-radius: 6px; background: #fff; cursor: pointer; font: inherit; }
.btn:hover { background: #f1f3f5; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { background: #0b5ed7; }
main { max-width: 1240px; margin: 0 auto; padding: 20px 24px 64px; }
section { margin-top: 28px; }
.sec-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.sec-head h2 { font-size: 14px; font-weight: 700; }
.sec-head p { color: var(--dim); font-size: 12px; }
.sec-head .grow { flex: 1; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 10px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.card .label { font-size: 12px; color: var(--dim); font-weight: 600; }
.card .value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin-top: 2px; font-variant-numeric: tabular-nums; }
.card .value small { font-size: 13px; font-weight: 500; color: var(--dim); margin-left: 4px; }
.card .desc { font-size: 11.5px; color: var(--faint); margin-top: 4px; }
.card.live .value { color: var(--accent); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); margin-right: 6px; vertical-align: 1px; }
.segmented { display: inline-flex; border: 1px solid #c9ccd2; border-radius: 6px; overflow: hidden; background: #fff; }
.segmented button { height: 28px; min-width: 44px; padding: 0 10px; border: 0; border-right: 1px solid var(--border); background: transparent; cursor: pointer; font: inherit; }
.segmented button:last-child { border-right: 0; }
.segmented button.on { background: var(--accent); color: #fff; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 10px; }
.chart { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px 8px; }
.chart h3 { font-size: 13px; font-weight: 700; }
.chart .desc { font-size: 11.5px; color: var(--faint); margin: 2px 0 6px; }
.chart .legend { display: flex; gap: 12px; font-size: 11.5px; color: var(--dim); margin-bottom: 2px; }
.chart .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.chart svg { display: block; width: 100%; height: auto; }
.chart .total { font-size: 12px; color: var(--dim); }
.grid2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 10px; }
.box { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.box h3 { font-size: 13px; font-weight: 700; }
.box .desc { font-size: 11.5px; color: var(--faint); margin: 2px 0 8px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #f0f1f3; vertical-align: middle; }
th { font-size: 11.5px; color: var(--dim); font-weight: 600; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.bar { width: 96px; }
td .sub { color: var(--faint); font-size: 11.5px; }
tr.pending td { color: var(--faint); }
.empty { color: var(--faint); padding: 8px 0; }
.funnel-row { display: grid; grid-template-columns: 170px 1fr 92px; align-items: center; gap: 10px; padding: 4px 0; }
.funnel-row .name { font-size: 12.5px; }
.funnel-row .name .sub { display: block; font-size: 11px; color: var(--faint); }
.funnel-row svg { display: block; width: 100%; height: 22px; }
.funnel-row .num { text-align: right; font-variant-numeric: tabular-nums; }
.funnel-row .num .sub { display: block; font-size: 11px; color: var(--dim); }
.note { margin-top: 32px; color: var(--faint); font-size: 11.5px; }
.err { color: var(--red); }
.err:empty { display: none; }
@media (max-width: 640px) { main { padding: 12px 16px 48px; } .top { padding: 0 16px; } .charts, .grid2 { grid-template-columns: 1fr; } }
`;

/** 로그인 화면 */
export function loginPageHtml(opts: { nonce: string; csrf: string; message: string | null; disabled: boolean }): string {
  const nonce = escapeHtml(opts.nonce);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>modelll 관리자 로그인</title>
<style nonce="${nonce}">${STYLE}
.login { max-width: 360px; margin: 14vh auto 0; padding: 0 16px; }
.login .box { padding: 22px; }
.login h1 { font-size: 17px; margin-bottom: 4px; }
.login p { color: var(--dim); margin-bottom: 16px; }
.login label { display: block; font-size: 12px; font-weight: 600; color: var(--dim); margin-bottom: 4px; }
.login input[type=password] { width: 100%; height: 36px; padding: 0 10px; border: 1px solid #c9ccd2; border-radius: 6px; font: inherit; }
.login input[type=password]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--soft); }
.login .btn { width: 100%; height: 36px; margin-top: 12px; }
.login .msg { margin: -4px 0 12px; color: var(--red); font-size: 12.5px; }
</style></head>
<body><div class="login"><div class="box">
<h1>modelll 관리자</h1>
<p>서비스 지표를 보려면 비밀번호를 입력합니다.</p>
${opts.message ? `<p class="msg" role="alert">${escapeHtml(opts.message)}</p>` : ''}
${opts.disabled ? '<p class="msg" role="alert">서버에 ADMIN_PASSWORD_HASH가 없어 로그인할 수 없습니다.</p>' : ''}
<form method="post" action="/login" autocomplete="off">
<input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}">
<label for="pw">비밀번호</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus maxlength="1024">
<button class="btn btn-primary" type="submit">로그인</button>
</form></div></div></body></html>`;
}

/** 화면을 그리는 스크립트. 문자열 이어 붙이기만 쓰고, 넣는 값은 모두 esc()를 거친다 */
const SCRIPT = String.raw`
'use strict';
var $ = function (id) { return document.getElementById(id); };
function esc(v) { return String(v).replace(/[&<>"'\x60]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\x60': '&#96;' }[c]; }); }
function fmt(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 + '%' : '–'; }
function dur(sec) { sec = Math.round(Number(sec) || 0); if (sec < 60) return sec + '초'; var m = Math.floor(sec / 60); if (m < 60) return m + '분 ' + (sec % 60) + '초'; return Math.floor(m / 60) + '시간 ' + (m % 60) + '분'; }
function U(row, k) { return (row && row.u && row.u[k]) || 0; }
function C(row, k) { return (row && row.c && row.c[k]) || 0; }
function prefixed(obj, prefix) { var out = []; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && k.indexOf(prefix) === 0) out.push([k.slice(prefix.length), obj[k]]); return out; }
function sumRows(rows, part, prefix) { var acc = {}; rows.forEach(function (r) { prefixed(r[part] || {}, prefix).forEach(function (e) { acc[e[0]] = (acc[e[0]] || 0) + e[1]; }); }); return Object.keys(acc).map(function (k) { return [k, acc[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
function total(rows, f) { var s = 0; rows.forEach(function (r) { s += f(r); }); return s; }

var COLORS = { blue: '#0d6efd', sky: '#7cb3ff', green: '#198754', mint: '#7fcfa6', orange: '#e08a00', purple: '#7c3aed', lilac: '#b79cf5', red: '#dc3545', gray: '#9ca3af' };

function card(label, value, desc, extra) {
  return '<div class="card' + (extra || '') + '"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div><div class="desc">' + esc(desc) + '</div></div>';
}

/** 막대그래프(여러 계열이면 쌓는다). 값과 날짜는 <title>로 */
function bars(rows, series) {
  var W = 560, H = 150, L = 34, R = 6, T = 8, B = 20;
  var n = rows.length, max = 0;
  rows.forEach(function (r) { var s = 0; series.forEach(function (se) { s += se.get(r); }); if (s > max) max = s; });
  var top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  var cw = (W - L - R) / Math.max(1, n), bw = Math.max(1, Math.min(18, cw * 0.72));
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (var g = 0; g <= 4; g++) {
    var y = T + (H - T - B) * (1 - g / 4);
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#eef0f2"/>';
    out += '<text x="' + (L - 6) + '" y="' + (y + 3.5) + '" font-size="10" fill="#9ca3af" text-anchor="end">' + esc(fmt(top * g / 4)) + '</text>';
  }
  rows.forEach(function (r, i) {
    var x = L + cw * i + (cw - bw) / 2, base = H - B, tip = [];
    series.forEach(function (se) {
      var v = se.get(r); tip.push(se.label + ' ' + fmt(v));
      if (v <= 0) return;
      var h = (H - T - B) * v / top;
      base -= h;
      out += '<rect x="' + x.toFixed(1) + '" y="' + base.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + se.color + '"/>';
    });
    out += '<rect x="' + (L + cw * i).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent"><title>' + esc(r.day + '\n' + tip.join('\n')) + '</title></rect>';
  });
  var ticks = n <= 1 ? [0] : n <= 8 ? rows.map(function (_, i) { return i; }) : [0, Math.floor((n - 1) / 2), n - 1];
  ticks.forEach(function (i) {
    var x = L + cw * i + cw / 2;
    out += '<text x="' + x.toFixed(1) + '" y="' + (H - 5) + '" font-size="10" fill="#9ca3af" text-anchor="middle">' + esc(rows[i].day.slice(5)) + '</text>';
  });
  return out + '</svg>';
}

function chart(title, desc, rows, series, totalText) {
  var legend = series.length > 1 ? '<div class="legend">' + series.map(function (s) { return '<span><i class="sw-' + esc(s.cls) + '"></i>' + esc(s.label) + '</span>'; }).join('') + '</div>' : '';
  return '<div class="chart"><h3>' + esc(title) + (totalText ? ' <span class="total">' + esc(totalText) + '</span>' : '') + '</h3><p class="desc">' + esc(desc) + '</p>' + legend + bars(rows, series) + '</div>';
}

function meter(v, max, color) {
  var w = max > 0 ? Math.max(1, Math.round(88 * v / max)) : 0;
  return '<svg viewBox="0 0 90 8" width="90" height="8"><rect width="90" height="8" rx="2" fill="#f1f3f5"/><rect width="' + w + '" height="8" rx="2" fill="' + (color || COLORS.blue) + '"/></svg>';
}

/** 분포 표. names로 키를 사람이 읽는 이름으로 바꾼다(없으면 키를 그대로, 이스케이프해서) */
function dist(title, desc, entries, names, unit) {
  if (!entries.length) return '<div class="box"><h3>' + esc(title) + '</h3><p class="desc">' + esc(desc) + '</p><p class="empty">아직 기록이 없습니다.</p></div>';
  var sum = 0, max = 0; entries.forEach(function (e) { sum += e[1]; if (e[1] > max) max = e[1]; });
  var shown = entries.slice(0, 15), rest = entries.slice(15);
  if (rest.length) { var r = 0; rest.forEach(function (e) { r += e[1]; }); shown.push(['(나머지 ' + rest.length + '개)', r]); }
  var body = shown.map(function (e) {
    var name = names && Object.prototype.hasOwnProperty.call(names, e[0]) ? names[e[0]] : e[0];
    return '<tr><td>' + esc(name) + '</td><td class="bar">' + meter(e[1], max) + '</td><td class="num">' + esc(fmt(e[1])) + (unit ? '<span class="sub">' + esc(unit) + '</span>' : '') + '</td><td class="num"><span class="sub">' + esc(pct(e[1], sum)) + '</span></td></tr>';
  }).join('');
  return '<div class="box"><h3>' + esc(title) + '</h3><p class="desc">' + esc(desc) + '</p><table>' + body + '</table></div>';
}

var SEARCH = ['google.', 'naver.com', 'bing.com', 'daum.net', 'duckduckgo.com', 'yahoo.', 'baidu.com', 'yandex.', 'ecosia.org', 'search.brave.com', 'zum.com'];
function refName(d) { if (d === 'direct') return '직접 입력·북마크'; for (var i = 0; i < SEARCH.length; i++) if (d.indexOf(SEARCH[i]) === 0 || d.indexOf('.' + SEARCH[i]) >= 0) return '검색 · ' + d; return d; }

var state = { days: 30, summary: null, rows: [] };

function renderLive(live) {
  $('live').innerHTML =
    card('현재 접속자', '<span class="dot"></span>' + esc(fmt(live.users)), '지금 방에 연결된 고유 브라우저 수(봇 제외)', ' live') +
    card('현재 연결 수', esc(fmt(live.connections)), '열린 웹소켓 연결 전체(탭마다 하나)', ' live') +
    card('열린 방', esc(fmt(live.openRooms)), '지금 누군가 연결해 있는 방', ' live') +
    card('협업 중인 방', esc(fmt(live.collabRooms)), '서로 다른 두 사람 이상이 함께 있는 방', ' live');
}

function renderToday(s) {
  var t = s.today, ai = 0;
  prefixed(t.c, 'cli:').forEach(function (e) { ai += e[1]; }); prefixed(t.c, 'mcp:').forEach(function (e) { ai += e[1]; });
  $('today').innerHTML =
    card('방문자', esc(fmt(U(t, 'visitors'))), '오늘 첫 화면이나 방을 연 고유 브라우저') +
    card('첫 화면 방문자', esc(fmt(U(t, 'home'))), '첫 화면을 연 고유 브라우저') +
    card('앱 사용자', esc(fmt(U(t, 'app'))), '방에 들어온 고유 브라우저') +
    card('신규 / 재방문', esc(fmt(U(t, 'new'))) + '<small>/ ' + esc(fmt(U(t, 'returning'))) + '</small>', '오늘 처음 온 사람 / 전에 온 적 있는 사람') +
    card('새 방', esc(fmt(U(t, 'r:new'))), '오늘 처음 저장된 방(사람과 AI 모두)') +
    card('활성 방', esc(fmt(U(t, 'r:active'))), '접속자가 편집한 방') +
    card('협업 방', esc(fmt(U(t, 'r:collab'))), '동시에 두 사람 이상 있었던 방') +
    card('최대 동시 접속', esc(fmt(t.peak)), '하루 중 같은 순간 연결된 고유 브라우저의 최댓값') +
    card('체류 시간', esc(dur(t.sess.med)) + '<small>평균 ' + esc(dur(t.sess.avg)) + '</small>', '방 연결 세션 길이의 중앙값(세션 ' + fmt(t.sess.n) + '개)') +
    card('편집 횟수', esc(fmt(C(t, 'edits'))), '접속자가 보낸 Yjs 업데이트 수') +
    card('초대 링크 진입', esc(fmt(U(t, 'invite'))), '방을 만들지 않고 처음 보는 방 링크로 들어온 사람') +
    card('AI 호출', esc(fmt(ai)), 'CLI(모델 API)와 MCP 도구 호출 합계') +
    card('WAU / MAU', esc(fmt(s.active.wau)) + '<small>/ ' + esc(fmt(s.active.mau)) + '</small>', '최근 7일 / 30일 동안 온 고유 브라우저');
}

function renderTotals(s) {
  var x = s.totals;
  $('totals').innerHTML =
    card('누적 방문자', esc(fmt(x.visitors)), '지표를 모으기 시작한 뒤 온 고유 브라우저') +
    card('누적 앱 사용자', esc(fmt(x.appUsers)), '방에 한 번이라도 들어온 고유 브라우저') +
    card('누적 방', esc(fmt(x.rooms)), '새로 만들어 저장된 방') +
    card('누적 AI 호출', esc(fmt(x.cli + x.mcp)) + '<small>CLI ' + esc(fmt(x.cli)) + ' · MCP ' + esc(fmt(x.mcp)) + '</small>', 'CLI 명령과 MCP 도구 호출') +
    card('누적 SQL 생성', esc(fmt(x.sql)), 'SQL pane 열기, CLI sql, MCP diagram_to_sql') +
    card('AI로 만든 방', esc(fmt(x.aiRooms)), 'CLI new나 MCP create_diagram으로 만든 방') +
    card('관계 모델이 있는 방', esc(fmt(x.relRooms)), '관계 모델 글을 한 번이라도 쓴 방');
}

function renderTrends(rows) {
  var sum = function (f) { return '기간 합계 ' + fmt(total(rows, f)); };
  var cliSum = function (r) { var s = 0; prefixed(r.c, 'cli:').forEach(function (e) { s += e[1]; }); return s; };
  var mcpSum = function (r) { var s = 0; prefixed(r.c, 'mcp:').forEach(function (e) { s += e[1]; }); return s; };
  $('trends').innerHTML =
    chart('방문자', '하루 고유 방문자. 신규와 재방문으로 나눈다', rows, [
      { label: '신규', cls: 'blue', color: COLORS.blue, get: function (r) { return U(r, 'new'); } },
      { label: '재방문', cls: 'sky', color: COLORS.sky, get: function (r) { return U(r, 'returning'); } }], sum(function (r) { return U(r, 'visitors'); })) +
    chart('앱 사용자', '방에 들어온 고유 브라우저', rows, [{ label: '앱 사용자', cls: 'green', color: COLORS.green, get: function (r) { return U(r, 'app'); } }], sum(function (r) { return U(r, 'app'); })) +
    chart('새 방', '처음 저장된 방. AI로 만든 방은 따로 보인다', rows, [
      { label: '사람', cls: 'orange', color: COLORS.orange, get: function (r) { return Math.max(0, U(r, 'r:new') - U(r, 'r:ainew')); } },
      { label: 'AI', cls: 'purple', color: COLORS.purple, get: function (r) { return U(r, 'r:ainew'); } }], sum(function (r) { return U(r, 'r:new'); })) +
    chart('AI 호출', 'CLI(모델 API 경로)와 MCP 도구 호출 수', rows, [
      { label: 'CLI', cls: 'purple', color: COLORS.purple, get: cliSum },
      { label: 'MCP', cls: 'lilac', color: COLORS.lilac, get: mcpSum }], sum(function (r) { return cliSum(r) + mcpSum(r); })) +
    chart('활성 방 · 협업 방', '편집이 일어난 방과 그중 두 사람 이상이 함께 있었던 방', rows, [
      { label: '협업', cls: 'green', color: COLORS.green, get: function (r) { return U(r, 'r:collab'); } },
      { label: '혼자', cls: 'mint', color: COLORS.mint, get: function (r) { return Math.max(0, U(r, 'r:active') - U(r, 'r:collab')); } }]) +
    chart('최대 동시 접속', '하루 중 같은 순간 연결된 고유 브라우저의 최댓값', rows, [{ label: '동시 접속', cls: 'blue', color: COLORS.blue, get: function (r) { return r.peak || 0; } }]) +
    chart('WAU · MAU', '그날 기준 최근 7일, 30일 동안 온 고유 브라우저', rows, [{ label: 'MAU', cls: 'sky', color: COLORS.sky, get: function (r) { return r.mau || 0; } }]) +
    chart('편집 횟수', '접속자가 보낸 Yjs 업데이트 수', rows, [{ label: '편집', cls: 'orange', color: COLORS.orange, get: function (r) { return C(r, 'edits'); } }], sum(function (r) { return C(r, 'edits'); })) +
    chart('체류 시간(중앙값, 초)', '방 연결 세션 길이의 중앙값', rows, [{ label: '중앙값', cls: 'green', color: COLORS.green, get: function (r) { return (r.sess && r.sess.med) || 0; } }]) +
    chart('안정성', '서버 5xx 응답과 웹소켓 비정상 종료(1006 등)', rows, [
      { label: '5xx', cls: 'red', color: COLORS.red, get: function (r) { return C(r, 'err5xx'); } },
      { label: 'WS 비정상 종료', cls: 'gray', color: COLORS.gray, get: function (r) { return C(r, 'wsAbnormal'); } }], sum(function (r) { return C(r, 'err5xx') + C(r, 'wsAbnormal'); }));
}

function renderFunnel(rows) {
  var steps = [
    ['home', '첫 화면 방문', '첫 화면을 연 사람'],
    ['f:create', '새 다이어그램 만들기', '만들기 버튼을 누른 사람'],
    ['f:shape', '첫 도형 추가', 'ERD에 도형을 추가한 사람'],
    ['f:rel', '관계 모델 작성', '관계 모델 글을 고친 사람'],
    ['f:ie', 'IE 편집', '타입, NULL, 키, 이름을 고친 사람'],
    ['f:sqlview', 'SQL 확인', 'SQL 탭을 연 사람'],
    ['f:sqlexport', 'SQL 복사·내려받기', '.sql 복사나 내려받기를 한 사람']];
  var vals = steps.map(function (s) { return total(rows, function (r) { return U(r, s[0]); }); });
  var first = vals[0], max = Math.max.apply(null, vals.concat([1]));
  $('funnel').innerHTML = steps.map(function (s, i) {
    var v = vals[i], w = Math.max(v > 0 ? 2 : 0, Math.round(600 * v / max));
    return '<div class="funnel-row"><div class="name">' + esc(s[1]) + '<span class="sub">' + esc(s[2]) + '</span></div>' +
      '<svg viewBox="0 0 600 22" preserveAspectRatio="none" height="22"><rect width="600" height="22" rx="3" fill="#f1f3f5"/><rect width="' + w + '" height="22" rx="3" fill="' + (i === 0 ? COLORS.sky : COLORS.blue) + '"/></svg>' +
      '<div class="num">' + esc(fmt(v)) + '<span class="sub">' + (i === 0 ? '기준' : esc(pct(v, first)) + ' · 전 단계 ' + esc(pct(v, vals[i - 1]))) + '</span></div></div>';
  }).join('');
}

function renderUsage(rows, s) {
  var u = function (k) { return total(rows, function (r) { return U(r, k); }); };
  var c = function (k) { return total(rows, function (r) { return C(r, k); }); };
  var opened = u('r:open');
  var tr = function (name, desc, v, of) { return '<tr><td>' + esc(name) + '<br><span class="sub">' + esc(desc) + '</span></td><td class="num">' + esc(fmt(v)) + '</td><td class="num"><span class="sub">' + (of ? esc(of) : '') + '</span></td></tr>'; };
  $('usage').innerHTML =
    '<div class="box"><h3>기능 사용</h3><p class="desc">기간 동안 날마다 센 고유 사람(또는 방) 수의 합</p><table>' +
    tr('관계 모델을 쓴 방', '관계 모델 글이 고쳐진 방(사람과 AI)', u('r:rel'), '열린 방의 ' + pct(u('r:rel'), opened)) +
    tr('검증 패널 열기', '검증 패널을 연 사람', u('u:validate')) +
    tr('표기 안내 열기', '표기법 안내를 연 사람', u('u:legend')) +
    tr('도움말 열기', '도움말을 연 사람', u('u:help')) +
    tr('pane 배치 바꾸기', 'pane을 열고 닫거나 옮긴 사람', u('u:layout')) +
    tr('내보내기', '그림이나 JSON을 내보낸 사람', u('u:export')) +
    tr('링크 복사(초대)', '방 링크를 복사한 횟수', c('share')) +
    tr('SQL 생성', 'SQL pane 열기, CLI sql, MCP diagram_to_sql 횟수', c('sql')) +
    '</table></div>' +
    '<div class="box"><h3>AI</h3><p class="desc">CLI는 서버 API 경로로, MCP는 도구 이름으로 구분한다. validate와 syntax는 서버를 거치지 않아 CLI에선 세지 않는다</p><table>' +
    tr('AI로 만든 방', 'CLI new, MCP create_diagram', u('r:ainew')) +
    tr('AI가 고친 방', 'CLI push·relational push, MCP update_diagram', u('r:aimod')) +
    '</table>' + miniTable('CLI 명령별', sumRows(rows, 'c', 'cli:'), { new: 'new (새 방)', push: 'push (방 고치기)', pull: 'pull (모델 읽기)', diagram: 'diagram (JSON 읽기)', relational: 'relational (관계 모델 읽기)', 'relational-push': 'relational push', sql: 'sql' }) +
    miniTable('MCP 도구별', sumRows(rows, 'c', 'mcp:')) + '</div>';
}

function miniTable(title, entries, names) {
  if (!entries.length) return '<p class="desc">' + esc(title) + ': 기록 없음</p>';
  var max = entries[0][1];
  return '<table><tr><th>' + esc(title) + '</th><th></th><th class="num">횟수</th></tr>' + entries.map(function (e) {
    var name = names && Object.prototype.hasOwnProperty.call(names, e[0]) ? names[e[0]] : e[0];
    return '<tr><td>' + esc(name) + '</td><td class="bar">' + meter(e[1], max, COLORS.purple) + '</td><td class="num">' + esc(fmt(e[1])) + '</td></tr>';
  }).join('') + '</table>';
}

function renderDist(rows) {
  var refs = sumRows(rows, 'c', 'ref:').map(function (e) { return [refName(e[0]), e[1]]; });
  var land = sumRows(rows, 'c', 'land:');
  $('dist').innerHTML =
    dist('유입 도메인', '페이지를 처음 연 때 직전 사이트의 도메인(전체 주소는 남기지 않는다)', refs) +
    dist('진입 경로', '페이지를 처음 연 곳: 첫 화면 / 초대 링크(처음 보는 방) / 전에 연 내 방', land, { home: '첫 화면', link: '초대 링크', room: '내 방 주소' }) +
    dist('UTM source', '주소에 utm_source가 있었던 방문', sumRows(rows, 'c', 'utm:')) +
    dist('DBMS 선택', 'SQL·IE에서 DBMS를 고른 횟수', sumRows(rows, 'c', 'dbms:'), { postgresql: 'PostgreSQL', mysql: 'MySQL', oracle: 'Oracle' }) +
    dist('내보내기 종류', '내보내기 횟수(SQL 복사·내려받기 포함)', sumRows(rows, 'c', 'exp:').concat(sumRows(rows, 'c', 'sqlx:').map(function (e) { return ['sql_' + e[0], e[1]]; })),
      { png: 'PNG 저장', copy_png: 'PNG 복사', svg: 'SVG 저장', json: 'JSON 저장', sql_copy: 'SQL 복사', sql_download: '.sql 내려받기' }) +
    dist('언어', '화면 언어별 고유 사람(날마다 센 값의 합)', sumRows(rows, 'u', 'lang:')) +
    dist('기기', '모바일과 데스크톱(날마다 센 고유 사람의 합)', sumRows(rows, 'u', 'dev:'), { m: '모바일', d: '데스크톱' }) +
    dist('방에 들어온 방법', '방 화면을 연 횟수: 새로 만듦 / 첫 화면에서 / 내 방 주소 / 초대 링크', sumRows(rows, 'c', 'entry:'), { new: '새로 만듦', home: '첫 화면에서 코드·최근 목록', recent: '내 방 주소로 바로', link: '초대 링크' });
}

function renderRetention(s) {
  var cell = function (v, n, ready) { return '<td class="num">' + (n > 0 ? esc(pct(v, n)) + ' <span class="sub">' + esc(fmt(v)) + (ready ? '' : ' 진행 중') + '</span>' : '<span class="sub">–</span>') + '</td>'; };
  var rows = s.retention.filter(function (r) { return r.n > 0; });
  var body = rows.length ? rows.map(function (r) {
    return '<tr><td>' + esc(r.day) + '</td><td class="num">' + esc(fmt(r.n)) + '</td>' + cell(r.d1, r.n, r.ready[0]) + cell(r.d7, r.n, r.ready[1]) + cell(r.d30, r.n, r.ready[2]) + '</tr>';
  }).join('') : '<tr><td colspan="5" class="empty">아직 신규 사용자가 없습니다.</td></tr>';
  var rooms = s.roomNextDay.filter(function (r) { return r.created > 0; });
  var rbody = rooms.length ? rooms.map(function (r) {
    return '<tr' + (r.ready ? '' : ' class="pending"') + '><td>' + esc(r.day) + '</td><td class="num">' + esc(fmt(r.created)) + '</td><td class="num">' + esc(fmt(r.reopened)) + '</td><td class="num">' + (r.ready ? esc(pct(r.reopened, r.created)) : '진행 중') + '</td></tr>';
  }).join('') : '<tr><td colspan="4" class="empty">아직 새 방이 없습니다.</td></tr>';
  $('retention').innerHTML =
    '<div class="box"><h3>재방문율(코호트)</h3><p class="desc">첫 방문일별 신규 사용자 가운데 1일, 7일, 30일 안에 다시 온 비율. 기간이 아직 안 끝난 칸은 진행 중</p><table><tr><th>첫 방문일</th><th class="num">신규</th><th class="num">D1</th><th class="num">D7</th><th class="num">D30</th></tr>' + body + '</table></div>' +
    '<div class="box"><h3>다음 날 다시 열린 방</h3><p class="desc">만든 날별 새 방 가운데 다음 날 다시 누가 연 방의 비율</p><table><tr><th>만든 날</th><th class="num">새 방</th><th class="num">다음 날 열림</th><th class="num">비율</th></tr>' + rbody + '</table></div>';
}

function get(url) {
  return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function stamp(iso) { $('updated').textContent = '갱신 ' + new Date(iso).toLocaleTimeString('ko-KR'); }

function loadAll() {
  return Promise.all([get('/api/summary'), get('/api/daily' + (state.days ? '?days=' + state.days : ''))]).then(function (res) {
    var s = res[0], rows = res[1].rows;
    state.summary = s; state.rows = rows;
    renderLive(s.live); renderToday(s); renderTotals(s); renderTrends(rows); renderFunnel(rows); renderUsage(rows, s); renderDist(rows); renderRetention(s);
    $('period-note').textContent = rows.length ? rows[0].day + ' ~ ' + rows[rows.length - 1].day + ' (' + rows.length + '일)' : '';
    stamp(s.now);
    $('error').textContent = '';
  }).catch(function (e) { $('error').textContent = '불러오지 못했습니다: ' + e.message; });
}

function refreshLive() {
  get('/api/live').then(function (live) { renderLive(live); stamp(live.now); }).catch(function () {});
}

document.querySelectorAll('#period button').forEach(function (b) {
  b.addEventListener('click', function () {
    state.days = Number(b.getAttribute('data-days')) || 0;
    document.querySelectorAll('#period button').forEach(function (x) { x.classList.toggle('on', x === b); });
    loadAll();
  });
});
loadAll();
setInterval(refreshLive, 10000);
setInterval(loadAll, 5 * 60 * 1000);
`;

/** 대시보드 */
export function adminPageHtml(opts: { nonce: string; csrf: string }): string {
  const nonce = escapeHtml(opts.nonce);
  const swatches = Object.entries({ blue: '#0d6efd', sky: '#7cb3ff', green: '#198754', mint: '#7fcfa6', orange: '#e08a00', purple: '#7c3aed', lilac: '#b79cf5', red: '#dc3545', gray: '#9ca3af' })
    .map(([k, v]) => `.sw-${k} { background: ${v}; }`)
    .join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>modelll 관리자</title>
<style nonce="${nonce}">${STYLE}
${swatches}</style></head>
<body>
<header class="top"><h1>modelll 관리자</h1><span class="badge">SSH 터널 전용</span><span class="grow"></span><span class="updated" id="updated"></span>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}"><button class="btn" type="submit">로그아웃</button></form></header>
<main>
<p class="err" id="error" role="alert"></p>
<section><div class="sec-head"><h2>실시간</h2><p>10초마다 갱신</p></div><div class="cards" id="live"></div></section>
<section><div class="sec-head"><h2>오늘</h2><p>Asia/Seoul 자정부터</p></div><div class="cards" id="today"></div></section>
<section><div class="sec-head"><h2>누적</h2><p>지표를 모으기 시작한 뒤 전체</p></div><div class="cards" id="totals"></div></section>
<section><div class="sec-head"><h2>일별 추이</h2><p id="period-note"></p><span class="grow"></span>
<div class="segmented" id="period" role="group" aria-label="기간"><button type="button" data-days="7">7일</button><button type="button" data-days="30" class="on">30일</button><button type="button" data-days="90">90일</button><button type="button" data-days="0">전체</button></div></div>
<div class="charts" id="trends"></div></section>
<section><div class="sec-head"><h2>퍼널</h2><p>단계마다 기간 동안 날마다 센 고유 사람 수의 합. 각 단계는 따로 센다(앞 단계를 거쳤는지 묻지 않는다)</p></div><div class="box" id="funnel"></div></section>
<section><div class="sec-head"><h2>기능 사용 · AI</h2></div><div class="grid2" id="usage"></div></section>
<section><div class="sec-head"><h2>유입 · 분포</h2><p>선택한 기간</p></div><div class="grid2" id="dist"></div></section>
<section><div class="sec-head"><h2>리텐션</h2><p>최근 30일 코호트</p></div><div class="grid2" id="retention"></div></section>
<p class="note">개인정보는 저장하지 않습니다. 사람은 브라우저가 만든 익명 ID를 서버 비밀 솔트로 해시한 값으로만 구분하고, 봇은 세지 않습니다.</p>
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body></html>`;
}
