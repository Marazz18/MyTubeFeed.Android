'use strict';
const VERSION = '1.0.0';
const TTL = 15 * 60 * 1000, NEW_DAYS = 14, SEEN_MARK = 5;
const $ = s => document.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) Object.assign(e, props);
  kids.flat().forEach(k => { if (k != null && k !== false) e.append(k); });
  return e;
}

/* ---------- nativní most (Java) ---------- */
const A = window.Android || { http() {}, open(t, u) { window.open(u, '_blank'); }, share() {}, copy() {}, paste() { return ''; }, getShared() { return ''; } };
const pend = new Map();
let hid = 0;
window.__http = (id, status, body) => { const r = pend.get(id); if (r) { pend.delete(id); r({ status, body }); } };
const http = url => new Promise(res => {
  const id = ++hid;
  pend.set(id, res);
  setTimeout(() => { if (pend.delete(id)) res({ status: -2, body: 'timeout' }); }, 30000);
  A.http(id, url);
});

/* ---------- stav ---------- */
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const S = load('mtf') || {};
S.db = S.db || {}; S.db.folders = S.db.folders || {}; S.db.channels = S.db.channels || {};
S.watched = S.watched || {};
S.settings = Object.assign({ hideSeen: false, hideShorts: true, openWith: 'firefox', inApp: false, sel: null }, S.settings);
const cache = load('mtf-cache') || {};
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem('mtf', JSON.stringify(S)); localStorage.setItem('mtf-cache', JSON.stringify(cache)); } catch (e) { /* plné úložiště */ }
  }, 300);
}
let tab = 'feed';
const pending = new Set();
const SR = { q: '', kind: 'videos', busy: false, err: '', videos: null, channels: null };

/* ---------- pomocné ---------- */
const watchUrl = id => 'https://www.youtube.com/watch?v=' + id;
const isSeen = id => ((S.watched[id] || {}).t || 0) >= SEEN_MARK;
const markSeen = id => { S.watched[id] = { t: SEEN_MARK, at: Date.now() }; save(); };
const unmarkSeen = id => { delete S.watched[id]; save(); };
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!(s >= 0)) return '';
  if (s < 3600) return 'před ' + Math.max(1, Math.round(s / 60)) + ' min';
  if (s < 86400) return 'před ' + Math.round(s / 3600) + ' h';
  const d = Math.round(s / 86400);
  if (d === 1) return 'včera';
  if (d < 30) return 'před ' + d + ' dny';
  return new Date(iso).toLocaleDateString('cs-CZ');
}
function durSec(t) {
  if (!t) return 0;
  const p = t.split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return p.reduce((a, x) => a * 60 + x, 0);
}
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2800);
}
const ov = $('#overlay');
function closeOverlay() { ov.replaceChildren(); ov.hidden = true; ov.className = ''; }
function sheet(title, nodes) {
  ov.className = 'sheet'; ov.hidden = false;
  ov.replaceChildren(
    h('div', { className: 'backdrop', onclick: closeOverlay }),
    h('div', { className: 'panel' }, title ? h('div', { className: 'ptitle', textContent: title }) : null, nodes));
}
const row = (label, fn) => h('button', { className: 'row', textContent: label, onclick: fn });
function askText(title, placeholder, value) {
  return new Promise(res => {
    const inp = h('input', { type: 'text', placeholder, value: value || '', className: 'txt' });
    const done = v => { closeOverlay(); res(v); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); };
    sheet(title, [inp, h('div', { className: 'btns' },
      h('button', { textContent: 'Zrušit', onclick: () => done(null) }),
      h('button', { className: 'primary', textContent: 'OK', onclick: () => done(inp.value.trim() || null) }))]);
    setTimeout(() => inp.focus(), 80);
  });
}
function confirmDlg(msg) {
  return new Promise(res => {
    const done = v => { closeOverlay(); res(v); };
    sheet(msg, [h('div', { className: 'btns' },
      h('button', { textContent: 'Zrušit', onclick: () => done(false) }),
      h('button', { className: 'primary', textContent: 'Ano', onclick: () => done(true) }))]);
  });
}

/* ---------- načítání kanálů (RSS) ---------- */
async function fetchChannel(id, force) {
  const c = cache[id];
  if (pending.has(id) || (c && !force && Date.now() - c.t < TTL)) return false;
  pending.add(id);
  try {
    const r = await http('https://www.youtube.com/feeds/videos.xml?channel_id=' + id);
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const xml = new DOMParser().parseFromString(r.body, 'text/xml');
    const items = [...xml.getElementsByTagName('entry')].map(e => ({
      id: (e.getElementsByTagName('yt:videoId')[0] || {}).textContent,
      title: (e.getElementsByTagName('title')[0] || {}).textContent || '',
      published: (e.getElementsByTagName('published')[0] || {}).textContent,
      channel: ((e.getElementsByTagName('author')[0] || e).getElementsByTagName('name')[0] || {}).textContent || '',
      short: /\/shorts\//.test((e.getElementsByTagName('link')[0] || { getAttribute() { return ''; } }).getAttribute('href') || '')
        || /#shorts?\b/i.test((e.getElementsByTagName('title')[0] || {}).textContent || ''),
      cid: id
    })).filter(i => i.id);
    cache[id] = { t: Date.now(), items };
    const ch = S.db.channels[id] = S.db.channels[id] || {};
    if (!ch.name) {
      const a = xml.getElementsByTagName('author')[0];
      const nm = a && a.getElementsByTagName('name')[0];
      if (nm) ch.name = nm.textContent;
    }
  } catch (err) {
    cache[id] = { t: (c && c.t) || 0, items: (c && c.items) || [], error: String(err) };
  } finally {
    pending.delete(id);
  }
  return true;
}
let renderT;
const schedule = () => { clearTimeout(renderT); renderT = setTimeout(render, 250); };
async function refreshAll(force) {
  const ids = [...new Set(Object.values(S.db.folders).flat())];
  let i = 0;
  const worker = async () => { while (i < ids.length) { if (await fetchChannel(ids[i++], force)) schedule(); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  save(); render();
}

/* ---------- přidání kanálu ---------- */
const ID_RES = [
  /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
  /"externalId":"(UC[\w-]{22})"/,
  /"channelId":"(UC[\w-]{22})"/,
  /channel_id=(UC[\w-]{22})/
];
async function resolveInput(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const direct = t.match(/(UC[\w-]{22})/);
  if (direct) return { id: direct[1] };
  const url = (t.match(/https?:\/\/\S+/) || [t])[0];
  let page = null;
  const v = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/);
  if (v) page = watchUrl(v[1]);
  else if (/youtube\.com\//.test(url)) page = url.startsWith('http') ? url : 'https://' + url;
  else if (/^@?[\w.-]+$/.test(url)) page = 'https://www.youtube.com/' + (url.startsWith('@') ? url : '@' + url);
  if (!page) return null;
  const r = await http(page);
  if (r.status === 451) throw new Error('YouTube vyžaduje souhlas s cookies');
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  for (const re of ID_RES) {
    const m = r.body.match(re);
    if (m) {
      const nm = r.body.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/);
      let name = '';
      try { name = nm ? JSON.parse('"' + nm[1] + '"') : ''; } catch (e) { name = ''; }
      return { id: m[1], name };
    }
  }
  return null;
}
function addChannel(id, name, folder) {
  const ch = S.db.channels[id] = S.db.channels[id] || {};
  if (name && !ch.name) ch.name = name;
  const list = S.db.folders[folder] = S.db.folders[folder] || [];
  if (!list.includes(id)) list.push(id);
  save();
  fetchChannel(id, true).then(() => { save(); render(); });
  render();
}
function addToFolderFlow(id, name) {
  const names = Object.keys(S.db.folders);
  const label = name || (S.db.channels[id] || {}).name || id;
  sheet('Přidat „' + label + '“ do složky', [
    ...names.map(n => row((S.db.folders[n].includes(id) ? '✓ ' : '') + n, () => { closeOverlay(); addChannel(id, name, n); toast('Přidáno do složky ' + n); })),
    row('＋ Nová složka…', async () => {
      closeOverlay();
      const n = await askText('Nová složka', 'Název složky');
      if (!n) return;
      if (!S.db.folders[n]) S.db.folders[n] = [];
      addChannel(id, name, n);
      toast('Přidáno do složky ' + n);
    })
  ]);
}
async function addFromInput(text) {
  toast('Zjišťuji kanál…');
  try {
    const r = await resolveInput(text);
    if (!r) { toast('Kanál se nepodařilo zjistit.'); return; }
    addToFolderFlow(r.id, r.name);
  } catch (e) { toast(String(e.message || e)); }
}
window.onShared = () => {
  const t = A.getShared();
  if (t) addFromInput(t);
};

/* ---------- přehrávání ---------- */
function play(item, how) {
  markSeen(item.id);
  const mode = how || (S.settings.inApp ? 'app' : S.settings.openWith);
  if (mode === 'app') openPlayer(item);
  else A.open(mode, watchUrl(item.id));
  setTimeout(render, 400);
}
function openPlayer(i) {
  const src = 'https://www.youtube-nocookie.com/embed/' + i.id + '?autoplay=1&playsinline=1&rel=0&origin=' + encodeURIComponent(location.origin);
  const frame = h('iframe', { src, allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
  frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
  ov.className = 'player'; ov.hidden = false;
  ov.replaceChildren(
    h('div', { className: 'phead' }, h('button', { className: 'icon', textContent: '✕', onclick: closeOverlay }), h('div', { className: 'ptitle', textContent: i.title })),
    h('div', { className: 'frame' }, frame),
    h('div', { className: 'prow' },
      h('div', { className: 'nocom', textContent: '💬 Komentáře jsou vypnuté (přehrávač v aplikaci je nezobrazuje).' }),
      h('button', { textContent: '🦊 Firefox', onclick: () => A.open('firefox', watchUrl(i.id)) }),
      h('button', { textContent: '📺 LibreTube', onclick: () => A.open('libretube', watchUrl(i.id)) })));
}
function cardMenu(i) {
  sheet(i.title, [
    row(isSeen(i.id) ? '○ Označit jako nezhlédnuté' : '✓ Označit jako zhlédnuté', () => { isSeen(i.id) ? unmarkSeen(i.id) : markSeen(i.id); closeOverlay(); render(); }),
    row('▶ Přehrát v aplikaci (bez komentářů)', () => { closeOverlay(); play(i, 'app'); }),
    row('🦊 Otevřít ve Firefoxu', () => { closeOverlay(); play(i, 'firefox'); }),
    row('📺 Otevřít v LibreTube', () => { closeOverlay(); play(i, 'libretube'); }),
    i.cid ? row('＋ Přidat kanál do složky', () => { closeOverlay(); addToFolderFlow(i.cid, i.channel); }) : null,
    row('🔗 Sdílet odkaz', () => { closeOverlay(); A.share(i.title, watchUrl(i.id)); })
  ]);
}

/* ---------- zobrazení ---------- */
function card(i) {
  const seen = isSeen(i.id);
  const isNew = i.published && !seen && Date.now() - new Date(i.published).getTime() < NEW_DAYS * 86400000;
  const sub = [i.channel, i.ago || (i.published ? ago(i.published) : ''), i.views].filter(Boolean).join(' · ');
  return h('div', { className: 'card' + (seen ? ' seen' : ''), onclick: () => play(i) },
    h('div', { className: 'thumb' },
      h('img', { src: 'https://i.ytimg.com/vi/' + i.id + '/mqdefault.jpg', loading: 'lazy', alt: '' }),
      isNew ? h('span', { className: 'dot', textContent: 'NOVÉ' }) : null,
      i.len ? h('span', { className: 'len', textContent: i.len }) : null),
    h('div', { className: 'meta' }, h('div', { className: 'title', textContent: i.title }), h('div', { className: 'sub', textContent: sub })),
    h('button', { className: 'more', textContent: '⋯', onclick: e => { e.stopPropagation(); cardMenu(i); } }));
}
function feedItems() {
  const names = Object.keys(S.db.folders);
  const sel = S.settings.sel || names;
  const ids = [...new Set(sel.flatMap(f => S.db.folders[f] || []))];
  let items = ids.flatMap(id => (cache[id] || {}).items || []);
  if (S.settings.hideShorts) items = items.filter(i => !i.short);
  if (S.settings.hideSeen) items = items.filter(i => !isSeen(i.id));
  return { ids, items: items.sort((a, b) => new Date(b.published) - new Date(a.published)).slice(0, 120) };
}
function viewFeed() {
  const out = [];
  const names = Object.keys(S.db.folders);
  if (!names.length) {
    out.push(h('p', { className: 'empty', textContent: 'Zatím nemáš žádné složky. Vytvoř složku tlačítkem +, nebo načti zálohu z rozšíření (⚙ → Import zálohy). Kanály přidáš sdílením videa z YouTube do této aplikace nebo na záložce Hledat.' }));
    return out;
  }
  const { ids, items } = feedItems();
  if (pending.size) out.push(h('div', { className: 'status', textContent: 'Načítám kanály… (' + pending.size + ')' }));
  else {
    const bad = ids.filter(id => cache[id] && cache[id].error).length;
    if (bad) out.push(h('div', { className: 'status warn', textContent: bad + ' kanálů se nepodařilo načíst – zkus ⚙ → Obnovit feed.' }));
  }
  if (!items.length && !pending.size) out.push(h('p', { className: 'empty', textContent: ids.length ? 'Nic k zobrazení (zkontroluj „Skrýt zhlédnutá“ a výběr složek).' : 'V „Můj feed“ nejsou vybrané žádné složky s kanály. Vyber je tlačítkem „Složky ▾“.' }));
  items.forEach(i => out.push(card(i)));
  return out;
}
function viewFolders() {
  const out = [];
  const inp = h('input', { type: 'text', className: 'txt', placeholder: 'Odkaz na kanál nebo video, @handle…' });
  const go = () => { const v = inp.value.trim(); if (v) { inp.value = ''; addFromInput(v); } };
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  out.push(h('div', { className: 'addrow' }, inp, h('button', { className: 'primary', textContent: 'Přidat', onclick: go })));
  const names = Object.keys(S.db.folders);
  if (!names.length) out.push(h('p', { className: 'empty', textContent: 'Žádné složky. Vytvoř je tlačítkem + nahoře.' }));
  names.forEach(n => {
    const ids = S.db.folders[n];
    out.push(h('div', { className: 'folder' },
      h('div', { className: 'fhead' },
        h('span', { className: 'fname', textContent: n + ' (' + ids.length + ')' }),
        h('button', { textContent: '✎', title: 'Přejmenovat', onclick: () => renameFolder(n) }),
        h('button', { textContent: '🗑', title: 'Smazat složku', onclick: () => deleteFolder(n) })),
      ids.map(id => h('div', { className: 'chrow' },
        h('span', { textContent: (S.db.channels[id] || {}).name || id }),
        h('button', { textContent: '✕', title: 'Odebrat ze složky', onclick: () => { S.db.folders[n] = S.db.folders[n].filter(x => x !== id); save(); render(); } })))));
  });
  return out;
}
async function renameFolder(n) {
  const nn = await askText('Přejmenovat složku', 'Nový název', n);
  if (!nn || nn === n || S.db.folders[nn]) return;
  const f = {};
  Object.keys(S.db.folders).forEach(k => { f[k === n ? nn : k] = S.db.folders[k]; });
  S.db.folders = f;
  if (S.settings.sel) S.settings.sel = S.settings.sel.map(k => (k === n ? nn : k));
  save(); render();
}
async function deleteFolder(n) {
  if (!(await confirmDlg('Smazat složku „' + n + '“?'))) return;
  delete S.db.folders[n];
  if (S.settings.sel) S.settings.sel = S.settings.sel.filter(k => k !== n);
  save(); render();
}
function filterSheet() {
  const names = Object.keys(S.db.folders);
  if (!names.length) { sheet('Složky', [h('p', { className: 'hint', textContent: 'Nemáš žádné složky.' })]); return; }
  const sel = new Set(S.settings.sel || names);
  const apply = () => { S.settings.sel = [...sel]; save(); render(); filterSheet(); };
  sheet('Složky v „Můj feed“', [
    ...names.map(n => row((sel.has(n) ? '☑ ' : '☐ ') + n + ' (' + S.db.folders[n].length + ')', () => { sel.has(n) ? sel.delete(n) : sel.add(n); apply(); })),
    row('Vybrat vše', () => { names.forEach(n => sel.add(n)); apply(); })
  ]);
}

/* ---------- hledání ---------- */
function ytData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
function collect(o, key, out) {
  if (Array.isArray(o)) o.forEach(x => collect(x, key, out));
  else if (o && typeof o === 'object') for (const k in o) { if (k === key) out.push(o[k]); else collect(o[k], key, out); }
  return out;
}
const txt = o => (o && (o.simpleText || (o.runs && o.runs.map(r => r.text).join('')))) || '';
function parseVideos(data) {
  return collect(data, 'videoRenderer', []).map(v => {
    const run = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0]) || (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0]) || {};
    const url = (((v.navigationEndpoint || {}).commandMetadata || {}).webCommandMetadata || {}).url || '';
    return {
      id: v.videoId, title: txt(v.title), channel: run.text || '',
      cid: ((run.navigationEndpoint || {}).browseEndpoint || {}).browseId || '',
      len: txt(v.lengthText), ago: txt(v.publishedTimeText), views: txt(v.viewCountText),
      short: /^\/shorts\//.test(url)
    };
  }).filter(v => v.id && !v.short && !(S.settings.hideShorts && v.len && durSec(v.len) <= 60));
}
function parseChannels(data) {
  return collect(data, 'channelRenderer', []).map(c => {
    let th = ((c.thumbnail || {}).thumbnails || [])[0];
    th = th ? (th.url.startsWith('//') ? 'https:' + th.url : th.url) : '';
    return { id: c.channelId, name: txt(c.title), subs: txt(c.subscriberCountText) || txt(c.videoCountText), img: th };
  }).filter(c => c.id);
}
async function doSearch() {
  SR.busy = true; SR.err = ''; render();
  const sp = SR.kind === 'videos' ? 'EgIQAQ%3D%3D' : 'EgIQAg%3D%3D';
  const r = await http('https://www.youtube.com/results?search_query=' + encodeURIComponent(SR.q) + '&sp=' + sp + '&hl=cs&gl=CZ');
  SR.busy = false;
  if (r.status === 451) SR.err = 'YouTube vyžaduje souhlas s cookies a nepustil dotaz dál.';
  else if (r.status !== 200) SR.err = 'Hledání selhalo (' + (r.status < 0 ? r.body : 'HTTP ' + r.status) + ').';
  else {
    const data = ytData(r.body);
    if (!data) SR.err = 'Výsledky se nepodařilo přečíst (YouTube pravděpodobně změnil stránku).';
    else if (SR.kind === 'videos') SR.videos = parseVideos(data);
    else SR.channels = parseChannels(data);
  }
  render();
}
function viewSearch() {
  const inp = h('input', { type: 'search', className: 'txt', placeholder: 'Hledat na YouTube…', value: SR.q });
  inp.enterKeyHint = 'search';
  const go = () => { SR.q = inp.value.trim(); if (SR.q) doSearch(); };
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  const seg = h('div', { className: 'seg' }, ['videos', 'channels'].map(k => h('button', {
    className: SR.kind === k ? 'on' : '', textContent: k === 'videos' ? 'Videa' : 'Kanály',
    onclick: () => { SR.q = inp.value.trim() || SR.q; SR.kind = k; if (SR.q) doSearch(); else render(); }
  })));
  const out = [h('div', { className: 'addrow' }, inp, h('button', { className: 'primary', textContent: 'Hledat', onclick: go })), seg];
  if (SR.busy) out.push(h('div', { className: 'status', textContent: 'Hledám…' }));
  if (SR.err) out.push(h('div', { className: 'status warn', textContent: SR.err }));
  const res = SR.kind === 'videos' ? SR.videos : SR.channels;
  if (res && !SR.busy && !SR.err) {
    if (!res.length) out.push(h('p', { className: 'empty', textContent: 'Nic nenalezeno.' }));
    if (SR.kind === 'videos') res.forEach(i => out.push(card(i)));
    else res.forEach(c => out.push(h('div', { className: 'chan' },
      h('img', { src: c.img, alt: '' }),
      h('div', { className: 'meta' }, h('div', { className: 'title', textContent: c.name }), h('div', { className: 'sub', textContent: c.subs })),
      h('button', { className: 'primary', textContent: '＋', onclick: () => addToFolderFlow(c.id, c.name) }))));
  }
  return out;
}

/* ---------- menu ⚙ ---------- */
const menu = $('#menu');
function setMenu(open) { menu.hidden = !open; if (open) buildMenu(); }
function buildMenu() {
  const radio = (v, label) => h('button', {
    className: 'row', textContent: (S.settings.openWith === v ? '● ' : '○ ') + label,
    onclick: () => { S.settings.openWith = v; save(); buildMenu(); }
  });
  menu.replaceChildren(
    row('↻ Obnovit feed', () => { setMenu(false); refreshAll(true); render(); }),
    h('div', { className: 'mlabel', textContent: 'Otevírat videa v:' }),
    radio('firefox', 'Firefox'), radio('libretube', 'LibreTube'),
    row((S.settings.inApp ? '☑ ' : '☐ ') + '💬 Vypnout komentáře (přehrát v aplikaci)', () => { S.settings.inApp = !S.settings.inApp; save(); buildMenu(); }),
    h('hr'),
    row('⬇ Export zálohy', () => { setMenu(false); A.share('MyTube Feed záloha', JSON.stringify({ db: S.db, wl: [], watched: S.watched }, null, 2)); }),
    row('⬆ Import zálohy', () => { setMenu(false); importDialog(); }),
    h('div', { className: 'verinfo', textContent: 'MyTube Feed pro Android v' + VERSION }));
}
function importDialog() {
  const ta = h('textarea', { className: 'txt', rows: 6, placeholder: 'Sem vlož obsah zálohy (JSON z rozšíření nebo z aplikace)…' });
  sheet('Import zálohy', [ta, h('div', { className: 'btns' },
    h('button', { textContent: 'Vložit ze schránky', onclick: () => { ta.value = A.paste() || ''; } }),
    h('button', { className: 'primary', textContent: 'Importovat', onclick: () => doImport(ta.value) }))]);
}
function doImport(text) {
  try {
    const n = JSON.parse(text);
    const d = n.db || n;
    for (const [k, v] of Object.entries(d.folders || {})) S.db.folders[k] = [...new Set([...(S.db.folders[k] || []), ...v])];
    Object.assign(S.db.channels, d.channels || {});
    Object.assign(S.watched, n.watched || {});
    save(); closeOverlay(); render(); refreshAll(false);
    toast('Záloha načtena');
  } catch (e) { toast('Neplatná záloha.'); }
}

/* ---------- hlavní vykreslení a události ---------- */
function render() {
  const main = $('#main'), sc = main.scrollTop;
  main.replaceChildren(...(tab === 'feed' ? viewFeed() : tab === 'folders' ? viewFolders() : viewSearch()));
  main.scrollTop = sc;
  $('#filterBtn').hidden = tab !== 'feed';
  $('#hideSeen').checked = !!S.settings.hideSeen;
  $('#hideShorts').checked = !!S.settings.hideShorts;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}
function setTab(t) { tab = t; render(); $('#main').scrollTop = 0; }
document.querySelectorAll('.tabs [data-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
$('#filterBtn').onclick = filterSheet;
$('#hideSeen').onchange = e => { S.settings.hideSeen = e.target.checked; save(); render(); };
$('#hideShorts').onchange = e => { S.settings.hideShorts = e.target.checked; save(); render(); if (tab === 'search' && SR.q) doSearch(); };
$('#newFolder').onclick = async () => {
  const n = await askText('Nová složka', 'Název složky');
  if (n && !S.db.folders[n]) { S.db.folders[n] = []; save(); render(); }
};
$('#menuBtn').onclick = e => { e.stopPropagation(); setMenu(menu.hidden); };
document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
window.__back = () => {
  if (!ov.hidden) { closeOverlay(); return true; }
  if (!menu.hidden) { setMenu(false); return true; }
  if (tab !== 'feed') { setTab('feed'); return true; }
  return false;
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { window.onShared(); schedule(); }
});

render();
refreshAll(false);
window.onShared();
