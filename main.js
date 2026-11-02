const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, globalShortcut } = require('electron');

// 关掉 ClearType 子像素抗锯齿：彩色小字在透明窗口上会出现蓝/黄色边，
// 缩小看就像被一条亮线横穿（"Hobbit" 那道横线就是它）
app.commandLine.appendSwitch('disable-lcd-text');
const path = require('path');
const fs = require('fs');

/* ---------------- 配置持久化 ---------------- */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  pinnedId: '',
  alwaysOnTop: true,
  intervalSec: 15,
  bounds: null,
  size: 'large',         // large | medium | small
  opacity: 1,            // 0.8 / 0.9 / 1
  theme: 'dark',         // dark 黑夜 / light 白天
  rounded: true          // true 透明圆角窗口（桌面透出）/ false 不透明
};
let config = { ...DEFAULT_CONFIG };
function loadConfig() {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (e) { config = { ...DEFAULT_CONFIG }; }
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8'); } catch (e) {}
}

/* ---------------- 5E 接口 ---------------- */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': 'https://event.5eplay.com/',
  'Origin': 'https://event.5eplay.com',
  'Accept': 'application/json, text/plain, */*'
};
const LIST_URL = 'https://app.5eplay.com/api/tournament/session_list?game_status=1&game_type=1&grades=&page=1&limit=60';
const detailUrl = (id) => `https://esports-data.5eplaycdn.com/v1/api/csgo/matches/${id}/data`;
const logUrl = (id, ver) => `https://esports-data.5eplaycdn.com/v1/api/csgo/match/${id}/event/log?update_version=${ver}&limit=1000`;

async function apiFetch(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json || json.success === false) throw new Error(json && json.message ? json.message : '接口返回异常');
    return json;
  } finally { clearTimeout(t); }
}

const STATUS = { 0: 'upcoming', 1: 'live', 2: 'finished' };

/** 把 /data 的 detail 结构整理成渲染层用的模型 */
function normalizeDetail(d) {
  const m = d.match || {};
  const mc = m.mc_info || {};
  const gs = m.global_state || {};
  const tt = m.tt_info || {};

  // 选手数据：整场（global_state）和单图（bouts_state[].t1_pr_stats）字段一致
  const pickPlayer = (p) => ({
    id: p.id || '',
    name: p.name || '',
    kill: Number(p.kill || 0),
    death: Number(p.death || 0),
    assist: Number(p.assist || 0),
    adr: p.adr === '' || p.adr === undefined ? '' : Number(p.adr),
    kd: p.kd_rate === '' || p.kd_rate === undefined ? '' : Number(p.kd_rate),
    rating: p.rating === '' || p.rating === undefined ? '' : Number(p.rating),
    kast: p.kast || '',
    hs: p.head_shot_rate || '',
    kpr: p.kpr === '' || p.kpr === undefined ? '' : Number(p.kpr),
    fb: Number(p.first_blood_num || 0),
    portrait: p.portrait || '',
    country: p.country_logo || ''
  });

  const maps = (m.bouts_state || []).map((b) => {
    const s1 = b.t1_stats || {};
    const s2 = b.t2_stats || {};
    const fh1 = Number(s1.fh_score || 0);
    const fh2 = Number(s2.fh_score || 0);
    const sh1 = Number(s1.sh_score || 0);
    const sh2 = Number(s2.sh_score || 0);
    // 每回合胜负：1 表示 t1 赢下该回合
    const fhData = (s1.fh_data || []).slice(0, Math.min(12, fh1 + fh2));
    const shData = (s1.sh_data || []).slice(0, Math.min(12, sh1 + sh2));
    const otData = (s1.ot_data || []).slice(0, Number(s1.ot_score || 0) + Number(s2.ot_score || 0));
    const pips = [...fhData, ...shData, ...otData].map((v) => (Number(v) ? 1 : 0));

    return {
      num: Number(b.bout_num || 0),
      pick: b.bp_act || '',            // t1_pick / t2_pick / left
      name: b.map_name || '',
      status: Number(b.status || 0),           // 2 已结束 / 1 进行中 / -1 未开始
      score: [Number(s1.all_score || 0), Number(s2.all_score || 0)],
      played: s1.all_score !== '' && s1.all_score !== undefined,
      half: [fh1, fh2],
      halfDone: fh1 + fh2 >= 12,
      round: Number(b.curr_round_num || 0),
      stage: b.curr_bout_stage || '',          // fh 上半 / sh 下半
      bomb: String(b.bomb_planted || ''),
      role: [s1.role || '', s2.role || ''],
      winner: b.result === 't1' ? 0 : b.result === 't2' ? 1 : -1,
      pips,
      // 单图选手数据（只有打完的图才有）
      players: {
        t1: (b.t1_pr_stats || []).map(pickPlayer),
        t2: (b.t2_pr_stats || []).map(pickPlayer)
      }
    };
  });

  const status = STATUS[Number(gs.status)] || 'upcoming';
  const cur = maps.find((x) => x.status === 1) || null;

  // 选手数据总览（KD / ADR / Rating…）
  const players = {
    t1: (gs.t1_player_stats || []).map(pickPlayer),
    t2: (gs.t2_player_stats || []).map(pickPlayer),
    mvp: gs.mvp_player_stats && gs.mvp_player_stats.name ? pickPlayer(gs.mvp_player_stats) : null
  };

  return {
    id: mc.id || '',
    status,
    liveStatus: String(gs.live_status || ''),
    format: Number(mc.format || 3),
    startTs: Number(mc.plan_ts || 0),
    stageDesc: mc.tt_stage_desc || mc.tt_stage || '',
    event: { name: tt.disp_name || '', grade: tt.grade_label || '', logo: tt.logo || '' },
    teams: [
      { name: (mc.t1_info && mc.t1_info.disp_name) || 'TBD', logo: (mc.t1_info && mc.t1_info.logo) || '', rank: (mc.t1_info && mc.t1_info.rank) || '' },
      { name: (mc.t2_info && mc.t2_info.disp_name) || 'TBD', logo: (mc.t2_info && mc.t2_info.logo) || '', rank: (mc.t2_info && mc.t2_info.rank) || '' }
    ],
    mapsWon: [Number(gs.t1_score || 0), Number(gs.t2_score || 0)],
    odds: [gs.t1_odds_percent || '', gs.t2_odds_percent || ''],
    maps,
    players,
    current: cur ? { ...cur, mapIndex: maps.indexOf(cur) } : null
  };
}

async function getDetail(id) { return normalizeDetail((await apiFetch(detailUrl(id))).data || {}); }

/* ---------------- 对局事件（击杀 / 下包 / 拆包 / 回合结束） ---------------- */
const logCache = new Map();   // matchId -> { ver, events, lastRound }

function getLogState(id) {
  if (!logCache.has(id)) logCache.set(id, { ver: 0, events: [], lastRound: {}, roundStart: {}, lastRoundEnd: {} });
  const st = logCache.get(id);
  if (!st.roundStart) st.roundStart = {};
  if (!st.lastRoundEnd) st.lastRoundEnd = {};
  return st;
}

/** 把一条原始日志解析成结构化事件，解析不出来返回 null */
function parseLogItem(it) {
  let o;
  try { o = JSON.parse(it.log_info); } catch (e) { return null; }
  const base = { mapNum: Number(it.bout_num || 0), map: it.map_name || '', ts: Number(it.update_version || 0) };

  const k = o.kill || {};
  if (k.killer_nick || k.victim_nick) {
    return {
      ...base, kind: 'kill',
      killer: k.killer_nick || k.killer_name || '', killerSide: k.killer_side || '',
      victim: k.victim_nick || k.victim_name || '', victimSide: k.victim_side || '',
      weapon: k.weapon || '', weaponLogo: k.weapon_logo || '',
      hs: !!k.head_shot, smoke: !!k.through_smoke, wall: !!k.penetrated,
      noscope: !!k.no_scope, blind: !!k.killer_blind
    };
  }
  const b = o.bomb_planted || {};
  if (b.player_nick) {
    return { ...base, kind: 'bomb', who: b.player_nick, site: b.bomb_site || '', tAlive: b.t_players || '', ctAlive: b.ct_players || '' };
  }
  const bd = o.bomb_defused || {};
  if (bd.player_nick) return { ...base, kind: 'defuse', who: bd.player_nick };

  const su = o.suicide || {};
  if (su.player_nick) return { ...base, kind: 'suicide', who: su.player_nick, weapon: su.weapon || '' };

  const re = o.round_end || {};
  if (re.winner) {
    return { ...base, kind: 'round_end', winner: re.winner, winType: re.win_type || '', ctScore: re.ct_score || '', tScore: re.t_score || '' };
  }
  const rs = o.round_start || {};
  if (rs.round_num) return { ...base, kind: 'round_start', round: Number(rs.round_num), map: rs.map || it.map_name || '' };

  return null;
}

/** 增量拉取事件（首次即全量），返回该场全部事件的缓存 */
async function pollLog(id) {
  const st = getLogState(id);
  const j = await apiFetch(logUrl(id, st.ver), 15000);
  const d = j.data || {};
  const list = d.list || [];
  if (list.length) {
    // 接口按时间倒序返回，反转后追加，保证内部是正序
    const parsed = list.map(parseLogItem).filter(Boolean).reverse();
    for (const ev of parsed) {
      if (ev.kind === 'round_start') {
        st.lastRound[ev.mapNum] = ev.round;
        st.roundStart[ev.mapNum] = ev.ts;        // 记下回合开始时刻，用于算「回合内时间」
      } else if (ev.kind === 'round_end' || ev.kind === 'kill') {
        ev.round = st.lastRound[ev.mapNum] || 0;   // 击杀也记上所属回合，供「双杀/三杀」统计
      }
      // 有些场次会出现"回合号没变但比分变了"（源数据漏发了一次 round_start），这里自动顺延
      if (ev.kind === 'round_end') {
        const last = st.lastRoundEnd[ev.mapNum];
        const sc = `${ev.tScore}:${ev.ctScore}`;
        if (last && ev.round === last.round && sc !== last.score) ev.round = last.round + 1;
        st.lastRoundEnd[ev.mapNum] = { round: ev.round, score: sc };
      }
      // 局内时间 = 事件时间 - 本回合开始时间（毫秒），显示成 1:23 这种
      const rs = st.roundStart[ev.mapNum];
      ev.rt = rs ? Math.max(0, ev.ts - rs) : 0;
      st.events.push(ev);
    }
    if (st.events.length > 1500) st.events = st.events.slice(-1500);
    // 去重：增量接口在边界会把上一批最后一条再发一次
    const seen = new Set();
    const uniq = [];
    for (const e of st.events) {
      const key = e.ts + ':' + e.kind + ':' + (e.killer || e.who || '');
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(e);
    }
    st.events = uniq;
  }
  if (d.to_ver) st.ver = String(d.to_ver);
  return st.events;
}


/** 比赛列表：进行中 + 未开始 + 已结束 */
async function getList() {
  const pick = (url) => apiFetch(url).catch(() => ({ data: { matches: [] } }));
  const [cur, past] = await Promise.all([
    pick(LIST_URL),                                             // 进行中 + 未开始
    pick(LIST_URL.replace('game_status=1', 'game_status=2'))     // 已结束
  ]);

  const mapOne = (x) => {
    const mc = x.mc_info || {};
    const st = x.state || {};
    const tt = x.tt_info || {};
    return {
      id: mc.id,
      status: STATUS[Number(st.status)] || 'upcoming',
      startTs: Number(mc.plan_ts || 0),
      event: tt.disp_name || '',
      stage: mc.tt_stage_desc || mc.round_name || '',
      teams: [
        { name: (mc.t1_info && mc.t1_info.disp_name) || 'TBD', logo: (mc.t1_info && mc.t1_info.logo) || '' },
        { name: (mc.t2_info && mc.t2_info.disp_name) || 'TBD', logo: (mc.t2_info && mc.t2_info.logo) || '' }
      ],
      score: [Number(st.t1_score || 0), Number(st.t2_score || 0)],
      maps: (st.bout_states || [])
        .filter((b) => b.status !== '-1')
        .map((b) => ({
          name: b.map_name || '',
          score: [Number(b.t1_score || 0), Number(b.t2_score || 0)],
          status: Number(b.status || 0)
        }))
    };
  };

  const arr = [
    ...((cur.data && cur.data.matches) || []).map(mapOne),
    ...((past.data && past.data.matches) || []).map(mapOne)
  ];

  // 去重（同一场可能同时出现在两个列表里）
  const seen = new Set();
  const uniq = arr.filter((x) => (x.id && !seen.has(x.id) ? seen.add(x.id) : false));

  // 排序：已结束 → 进行中 → 未开始
  // 已结束按时间正序（越晚打完的越靠下，贴着「进行中」）；未开始按开赛时间正序
  const rank = { finished: 0, live: 1, upcoming: 2 };
  uniq.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.startTs - b.startTs;
  });
  return uniq;
}

/* ---------------- 窗口 ---------------- */
let win = null;
let tray = null;
let timer = null;
let listCache = [];
const matchCache = new Map();   // 每场比赛最后一次成功获取的详情，失败时兜底
let listAt = 0;
let lastPayload = null;
let autoId = '';

// 基准版式 430×470；中 = 整体缩到 75%，小 = 独立精简版式（内容更少、字号相对更大）
const PRESET = {
  large: { win: [430, 470], zoom: 1 },
  medium: { win: [323, 353], zoom: 1 },   // 中号用独立排版，不做等比缩放（缩了字就看不清）
  small: { win: [215, 235], zoom: 1 }
};
const PANEL_WIN = { picker: [430, 520], settings: [430, 430] };   // 面板临时尺寸

function preset() { return PRESET[config.size] || PRESET.large; }

function currentLayout() {
  const view = lastPayload ? lastPayload.view : 'match';
  if (view === 'picker' || view === 'settings') return { win: PANEL_WIN[view], zoom: 1 };
  return preset();
}

function createWindow() {
  const b = config.bounds;
  const area = screen.getPrimaryDisplay().workArea;
  const { win: size, zoom } = currentLayout();
  const [w, h] = size;
  // 记住的位置可能跑到屏幕外（换显示器/改缩放），出界就回右上角
  let x = b ? b.x : area.x + area.width - w - 32;
  let y = b ? b.y : area.y + 80;
  const off = x + w < area.x + 40 || x > area.x + area.width - 40
    || y + h < area.y + 40 || y > area.y + area.height - 40;
  if (off) { x = area.x + area.width - w - 32; y = area.y + 80; }
  win = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: config.rounded !== false,   // 透明 → 卡片圆角处能透出桌面（iPhone 圆角）
    resizable: true,          // 允许程序改尺寸；用户拖边被 will-resize 拦掉
    thickFrame: false,        // 关键：透明无边框窗保留 thickFrame 会让命中区域错位
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: false,
    roundedCorners: false,   // 圆角我们自己用 CSS 画
    focusable: true,
    show: false,
    alwaysOnTop: config.alwaysOnTop,
    backgroundColor: config.rounded !== false ? '#00000000' : (config.theme === 'light' ? '#e9edf5' : '#101119'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (config.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  // 只有真需要时才碰不透明度（改 layered 属性可能影响命中测试）
  if (config.opacity && config.opacity < 1) win.setOpacity(config.opacity);
  win.setIgnoreMouseEvents(false);
  win.on('will-resize', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(zoom));
  win.once('ready-to-show', () => win.show());
  win.on('move', () => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    config.bounds = { x, y };
    saveConfig();
  });
  win.on('closed', () => { win = null; });
}

/** 在桌面创建快捷方式（无黑窗口、带图标） */
function makeDesktopShortcut() {
  try {
    const os = require('os');
    const lnk = path.join(os.homedir(), 'Desktop', '5E比分.lnk');
    shell.writeShortcutLink(lnk, {
      target: process.execPath,
      args: '"' + app.getAppPath() + '"',
      cwd: app.getAppPath(),
      description: '5E Score Widget',
      icon: path.join(__dirname, 'assets', 'app.ico'),
      iconIndex: 0
    });
    shell.showItemInFolder(lnk);
  } catch (e) {}
}

/** 把窗口挪到主屏右上角（鼠标拖不动时的兜底） */
function moveToCorner() {
  if (!win || win.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const b = win.getBounds();
  win.setPosition(area.x + area.width - b.width - 24, area.y + 24);
}

function send(payload) {
  lastPayload = payload;
  if (win && !win.isDestroyed()) win.webContents.send('state', payload);
}

/** 按当前 视图 / 尺寸档位 重新设置缩放与窗口大小 */
function applyLayout() {
  if (!win || win.isDestroyed()) return;
  const { win: size, zoom } = currentLayout();
  win.webContents.setZoomFactor(zoom);
  win.setBounds({ x: win.getBounds().x, y: win.getBounds().y, width: size[0], height: size[1] }, false);
  win.setIgnoreMouseEvents(false);   // 防御：确保改完尺寸后仍然接收鼠标
}

/* ---------------- 轮询 ---------------- */
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

async function tick() {
  let next = 60000;
  try {
    // 列表用于「选比赛」面板，缓存 60 秒
    if (Date.now() - listAt > 60000) {
      try { listCache = await getList(); listAt = Date.now(); } catch (e) {}
    }

    let id = config.pinnedId;
    if (!id) {
      // 没有固定比赛时，自动跟随当前进行中的比赛（不写入配置，重启后重新挑选）
      const live = listCache.find((x) => x.status === 'live');
      const up = listCache.find((x) => x.status === 'upcoming');
      const fin = listCache.find((x) => x.status === 'finished');
      autoId = (live || up || fin || {}).id || '';
      id = autoId;
    }

    let match = null;
    let error = '';
    if (id) {
      try {
        match = await getDetail(id);
        matchCache.set(id, match);
      } catch (e) {
        error = '比分获取失败：' + e.message;
        // 依次退回：上次成功的详情 → 列表粗数据
        match = matchCache.get(id) || null;
        if (!match) {
          const it = listCache.find((x) => x.id === id);
          if (it) {
            match = {
              id: it.id, status: it.status, format: 3, startTs: it.startTs,
              stageDesc: it.stage, event: { name: it.event, grade: '', logo: '' },
              teams: it.teams, mapsWon: it.score, odds: ['', ''],
              players: { t1: [], t2: [], mvp: null },
              maps: it.maps.map((mp, i) => ({
                num: i + 1, name: mp.name, status: mp.status, score: mp.score, played: true,
                half: [0, 0], halfDone: false, round: 0, stage: '', bomb: '', role: ['', ''],
                winner: -1, pips: [], pick: '', players: { t1: [], t2: [] }
              })),
              current: null
            };
          }
        }
      }
    }

    // 根据比赛状态决定刷新频率
    if (match && match.status === 'live') next = Math.max(1, config.intervalSec) * 1000;
    else if (match && match.status === 'upcoming') next = 30000;
    else next = Math.max(30, config.intervalSec * 4) * 1000;

    // 对局事件（击杀/下包/拆包/回合结束）：进行中或刚结束时拉取
    let feed = [];
    let feedTotal = 0;
    if (match && match.status !== 'upcoming') {
      try {
        const evs = await pollLog(match.id);
        feedTotal = evs.length;
        // 每张图各保留最近 200 条，否则老图会被新图的事件淹没
        const byMap = new Map();
        for (const e of evs) {
          const k = e.mapNum || 0;
          const arr = byMap.get(k);
          if (arr) arr.push(e); else byMap.set(k, [e]);
        }
        feed = [];
        for (const arr of byMap.values()) {
          for (const e of arr.slice(-200)) feed.push(e);
        }
        feed.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      } catch (e) {}
    }

    send({
      ok: !!match,
      view: lastPayload ? lastPayload.view : 'match',
      match,
      feed,
      feedTotal,
      list: listCache,
      error,
      updatedAt: Date.now(),
      config: { pinnedId: config.pinnedId, alwaysOnTop: config.alwaysOnTop, size: config.size, opacity: config.opacity, intervalSec: config.intervalSec, theme: config.theme, rounded: config.rounded, boot: app.getLoginItemSettings().openAtLogin }
    });
  } catch (e) {
    send({
      ok: false, view: lastPayload ? lastPayload.view : 'match', match: null, list: listCache,
      error: String(e.message || e), updatedAt: Date.now(),
      config: { pinnedId: config.pinnedId, alwaysOnTop: config.alwaysOnTop, size: config.size, opacity: config.opacity, intervalSec: config.intervalSec, theme: config.theme, rounded: config.rounded, boot: app.getLoginItemSettings().openAtLogin }
    });
    next = 20000;
  }
  schedule(next);
}

/* ---------------- 托盘 ---------------- */
function createTray() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  const img = nativeImage.createFromPath(p);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('5E 比分小组件');
  refreshTrayMenu();
  tray.on('click', () => {
    if (!win) return createWindow();
    win.isVisible() ? win.hide() : win.show();
  });
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => { if (!win) return createWindow(); win.isVisible() ? win.hide() : win.show(); } },
    { label: '立即刷新', click: () => tick() },
    { label: '移到屏幕右上角', click: () => moveToCorner() },
    { label: '创建桌面快捷方式', click: () => makeDesktopShortcut() },
    { type: 'separator' },
    {
      label: '界面大小',
      submenu: [
        { label: '大（完整）', type: 'radio', checked: config.size === 'large', click: () => { config.size = 'large'; saveConfig(); applyLayout(); refreshTrayMenu(); if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, size: 'large' } }); } },
        { label: '中（缩小 25%）', type: 'radio', checked: config.size === 'medium', click: () => { config.size = 'medium'; saveConfig(); applyLayout(); refreshTrayMenu(); if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, size: 'medium' } }); } },
        { label: '小（精简）', type: 'radio', checked: config.size === 'small', click: () => { config.size = 'small'; saveConfig(); applyLayout(); refreshTrayMenu(); if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, size: 'small' } }); } }
      ]
    },
    {
      label: '圆角窗口',
      type: 'checkbox',
      checked: config.rounded !== false,
      click: (mi) => { config.rounded = mi.checked; saveConfig(); if (win && !win.isDestroyed()) { const b = win.getBounds(); win.destroy(); win = null; createWindow(); if (win) { win.setBounds(b); win.show(); } } refreshTrayMenu(); }
    },
    {
      label: '主题',
      submenu: [
        { label: '黑夜', type: 'radio', checked: config.theme !== 'light', click: () => { config.theme = 'dark'; saveConfig(); if (win && !win.isDestroyed()) win.setBackgroundColor('#00000000'); refreshTrayMenu(); if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, theme: 'dark' } }); } },
        { label: '白天', type: 'radio', checked: config.theme === 'light', click: () => { config.theme = 'light'; saveConfig(); if (win && !win.isDestroyed()) win.setBackgroundColor('#00000000'); refreshTrayMenu(); if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, theme: 'light' } }); } }
      ]
    },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click: (mi) => {
        config.alwaysOnTop = mi.checked;
        saveConfig();
        if (win && !win.isDestroyed()) win.setAlwaysOnTop(mi.checked, 'screen-saver');
        refreshTrayMenu();
      }
    },
    {
      label: '刷新间隔',
      submenu: [1, 3, 8, 15, 30, 60].map((s) => ({
        label: s + ' 秒', type: 'radio', checked: config.intervalSec === s,
        click: () => { config.intervalSec = s; saveConfig(); refreshTrayMenu(); tick(); }
      }))
    },
    { type: 'separator' },
    {
      label: '取消固定（自动跟随进行中）',
      enabled: !!config.pinnedId,
      click: () => { config.pinnedId = ''; autoId = ''; saveConfig(); tick(); }
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => {
        const opts = { openAtLogin: mi.checked, path: process.execPath };
        if (!app.isPackaged) opts.args = [app.getAppPath()];
        app.setLoginItemSettings(opts);
      }
    },
    { label: '在 5E 打开赛事页', click: () => shell.openExternal('https://event.5eplay.com/csgo/matches') },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

/* ---------------- IPC ---------------- */
ipcMain.on('select-match', (e, id) => {
  config.pinnedId = id;
  saveConfig();
  // 只保留最近 3 场的日志缓存
  while (logCache.size > 3) logCache.delete(logCache.keys().next().value);
  tick();
});
ipcMain.on('refresh', () => { listAt = 0; tick(); });
ipcMain.on('set-view', (e, view) => {
  if (lastPayload) lastPayload.view = view;
  if (view === 'picker') listAt = 0;   // 打开列表时强制刷新赛程
  applyLayout();
});
ipcMain.on('set-preset', (e, size) => {
  if (!PRESET[size]) return;
  config.size = size;
  saveConfig();
  applyLayout();
  refreshTrayMenu();
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, size: config.size } });
});
ipcMain.on('set-interval', (e, sec) => {
  const n = Number(sec) || 15;
  config.intervalSec = n;
  saveConfig();
  refreshTrayMenu();
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, intervalSec: n } });
  tick();
});
ipcMain.on('set-opacity', (e, v) => {
  const o = Math.min(1, Math.max(0.5, Number(v) || 1));
  config.opacity = o;
  saveConfig();
  if (win && !win.isDestroyed()) win.setOpacity(o);
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, opacity: o } });
});
ipcMain.on('set-theme', (e, t) => {
  config.theme = t === 'light' ? 'light' : 'dark';
  saveConfig();
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor('#00000000');
  }
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, theme: config.theme } });
});

ipcMain.on('set-rounded', (e, on) => {
  const want = !!on;
  if (want === (config.rounded !== false)) return;
  config.rounded = want;
  saveConfig();
  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    win.destroy();
    win = null;
    createWindow();
    if (win) { win.setBounds(b); win.show(); }
  }
  refreshTrayMenu();
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, rounded: config.rounded } });
});

ipcMain.on('toggle-boot', () => {
  const on = !app.getLoginItemSettings().openAtLogin;
  const opts = { openAtLogin: on, path: process.execPath };
  if (!app.isPackaged) opts.args = [app.getAppPath()];
  app.setLoginItemSettings(opts);
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, boot: on } });
});
ipcMain.on('toggle-top', () => {
  config.alwaysOnTop = !config.alwaysOnTop;
  saveConfig();
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
  refreshTrayMenu();
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, alwaysOnTop: config.alwaysOnTop } });
});
ipcMain.on('hide', () => { if (win) win.hide(); });
ipcMain.on('quit', () => { app.isQuitting = true; app.quit(); });
ipcMain.on('open-link', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

/* 右键菜单（不依赖顶栏那几个小按钮） */
/* 自己实现窗口拖动：按下左键后按光标位置移动窗口 */
let dragTimer = null, dragOffset = null;
ipcMain.on('drag-begin', () => {
  if (!win || win.isDestroyed()) return;
  const cp = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragOffset = { x: cp.x - b.x, y: cp.y - b.y };
  if (dragTimer) clearInterval(dragTimer);
  setTimeout(() => { if (dragTimer) { clearInterval(dragTimer); dragTimer = null; dragOffset = null; } }, 30000);
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !dragOffset) return;
    const p = screen.getCursorScreenPoint();
    win.setPosition(p.x - dragOffset.x, p.y - dragOffset.y);
  }, 12);
});
ipcMain.on('drag-end', () => {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragOffset = null;
});

ipcMain.on('ctx-menu', () => {
  if (!win || win.isDestroyed()) return;
  const setSize = (size) => {
    config.size = size;
    saveConfig();
    applyLayout();
    refreshTrayMenu();
    if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, size } });
  };
  const menu = Menu.buildFromTemplate([
    {
      label: '界面大小',
      submenu: [
        { label: '大（完整）', type: 'radio', checked: config.size === 'large', click: () => setSize('large') },
        { label: '中（缩小 25%）', type: 'radio', checked: config.size === 'medium', click: () => setSize('medium') },
        { label: '小（精简）', type: 'radio', checked: config.size === 'small', click: () => setSize('small') }
      ]
    },
    { label: '打开设置…', click: () => { if (win) win.webContents.send('cmd', 'settings'); } },
    { label: '选择比赛…', click: () => { if (win) win.webContents.send('cmd', 'picker'); } },
    { type: 'separator' },
    { label: '立即刷新', click: () => tick() },
    { label: '移到屏幕右上角', click: () => moveToCorner() },
    {
      label: '窗口置顶', type: 'checkbox', checked: config.alwaysOnTop,
      click: (mi) => { config.alwaysOnTop = mi.checked; saveConfig(); if (win) win.setAlwaysOnTop(mi.checked, 'screen-saver'); }
    },
    { label: '隐藏窗口', click: () => { if (win) win.hide(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  menu.popup({ window: win });
});

/* 全局快捷键：不依赖窗口焦点，鼠标点不动时的兜底 */
function cycleSize() {
  const order = ['large', 'medium', 'small'];
  const next = order[(order.indexOf(config.size) + 1) % 3];
  config.size = next;
  saveConfig();
  applyLayout();
  refreshTrayMenu();
  if (lastPayload) send({ ...lastPayload, config: { ...lastPayload.config, size: next } });
}

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) { createWindow(); return; }
    // 窗口如果跑到屏幕外（换显示器/休眠后），先挪回右上角再显示
    const b = win.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    const inside = b.x + b.width > area.x && b.x < area.x + area.width
      && b.y + b.height > area.y && b.y < area.y + area.height;
    if (!inside) moveToCorner();
    win.show();
    win.focus();
  });
  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    createTray();
    tick();
    globalShortcut.register('Control+Alt+5', cycleSize);
    globalShortcut.register('Control+Alt+H', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', (e) => { if (!app.isQuitting) e.preventDefault(); });
  app.on('before-quit', () => { app.isQuitting = true; });
}
