// =====================================================================
// Who Is He? · 공통 도구 (교사 화면과 학생 화면이 함께 사용)
// =====================================================================

// 1) Supabase 연결 ------------------------------------------------------
const db = supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_KEY);

// 2) 아바타와 색 ----------------------------------------------------------
const AVATARS = {
  zebra: '🦓', panda: '🐼', lion: '🦁', tiger: '🐯',
  koala: '🐨', rabbit: '🐰', bear: '🐻', fox: '🦊'
};
const AVATAR_COLORS = ['#8B6FD6', '#F08A9B', '#5CC7A8', '#6FB6F0', '#F5B841'];
function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// 3) 서버 시계 맞추기: 모든 화면이 같은 시계(DB 서버 시각)를 기준으로 ---------
let clockOffset = 0;
function syncClock(serverNowText, sentAt) {
  const receivedAt = Date.now();
  clockOffset = new Date(serverNowText).getTime() - (sentAt + receivedAt) / 2;
}
function serverNow() { return Date.now() + clockOffset; }
function secondsLeft(endsAt) {
  if (!endsAt) return 0;
  return Math.max(0, (new Date(endsAt).getTime() - serverNow()) / 1000);
}
function mmss(sec) {
  const s = Math.ceil(sec);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// 4) DB 함수 부르기 (오류는 알아듣기 쉬운 말로) ------------------------------
const ERROR_TEXT = {
  room_not_found: '방 번호를 다시 확인해 주세요.',
  name_taken: '같은 이름이 이미 있어요. 다른 이름을 써 주세요.',
  players_name_check: '이름은 1~10글자로 써 주세요.',
  not_host: '이 방을 만든 선생님 화면에서만 할 수 있어요.',
  not_waiting: '이미 시작한 게임이에요.',
  invalid_player: '입장 정보가 없어요. 다시 들어와 주세요.',
  word_ids_check: '단어를 4개 이상 골라 주세요.',
  'Failed to fetch': '인터넷 연결을 확인해 주세요.'
};
function friendly(message) {
  for (const key in ERROR_TEXT) if (String(message).includes(key)) return ERROR_TEXT[key];
  return '문제가 생겼어요: ' + message;
}
async function call(fn, args) {
  const sentAt = Date.now();
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(friendly(error.message));
  if (data && data.server_now) syncClock(data.server_now, sentAt);
  return data;
}

// 5) 실시간 구독 + 연결이 안 되면 자동 새로고침(폴링)으로 대신 -----------------
//    tables: [{ table: 'players', filter: 'room_id=eq.xxx' }, ...]
function watch({ name, tables, onChange, refresh, pollMs = 2000 }) {
  let pollTimer = null;
  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(refresh, pollMs);
    setConn('poll');
  };
  const channel = db.channel(name);
  for (const t of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t.table, filter: t.filter }, onChange);
  }
  const fallback = setTimeout(startPolling, 6000);   // 6초 안에 연결이 안 되면 폴링
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(fallback);
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      setConn('live');
      refresh();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      startPolling();
    }
  });
  const safety = setInterval(refresh, 10000);        // 혹시 놓친 알림이 있어도 10초마다 맞춤
  return { stop() { clearTimeout(fallback); clearInterval(pollTimer); clearInterval(safety); db.removeChannel(channel); } };
}
function setConn(mode) {
  let el = document.querySelector('.conn');
  if (!el) { el = document.createElement('div'); el.className = 'conn'; document.body.appendChild(el); }
  el.classList.toggle('poll', mode === 'poll');
  el.textContent = mode === 'poll' ? '자동 새로고침 중' : '실시간 연결됨';
}

// 6) 작은 도구들 -----------------------------------------------------------
function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast pop';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));   // 글자는 항상 textNode로 (이름에 HTML이 섞여도 안전)
  }
  return node;
}
function avatarEl(player, size = 44) {
  return el('span', {
    class: 'avatar',
    style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;background:${colorFor(player.id)}`,
    'aria-hidden': 'true'
  }, AVATARS[player.avatar] || '🙂');
}
function sortPlayers(list) {
  return [...list].sort((a, b) =>
    b.score - a.score || b.correct - a.correct || new Date(a.joined_at) - new Date(b.joined_at));
}
function withJosa(name, a, b) {   // 받침이 있으면 a(이), 없으면 b(가)
  const code = name.charCodeAt(name.length - 1);
  const hasFinal = code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 !== 0;
  return name + (hasFinal ? a : b);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
