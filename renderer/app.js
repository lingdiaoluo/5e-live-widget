/* 5E 桌面比分组件 — 渲染层 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;          // 最新状态
let query = '';        // 搜索词
let picking = false;
let curMapNum = 0;      // 当前显示的小比分对应第几图
let selMapNum = 0;      // 用户点选的地图（0 = 跟随当前图）
let paneView = 'feed';  // 内容区当前视图：feed 战况 / stats 数据总览
let lastMatchSig = null;  // 面板内容指纹（变了才重画；null 保证首帧一定渲染）
let lastFeedSig = null;
let renderedCount = 0;    // 战况列表已渲染的条数（增量插入用）
let renderedScope = null;
let renderedTopTs = 0;
let lastMatchId = '';
let lastLiveNum = 0;     // 上一次看到正在打第几图
let needFocusLive = false;   // 打开选比赛面板时是否要定位到「进行中」

/* ---------------- 工具 ---------------- */
const pad = (n) => String(n).padStart(2, '0');
function cnNum(n) {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  n = Number(n) || 0;
  if (n < 10) return d[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + d[n - 10];
  if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  return String(n);
}
function hhmm(ts) {
  const d = new Date(ts * 1000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
/** 列表里的时间：今天只显示时分，其他日期带上月日 */
function listTime(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return hm;
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
}
function relTime(ts) {
  const diff = ts * 1000 - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  let txt;
  if (m < 1) txt = '不到1分钟';
  else if (m < 60) txt = m + '分钟';
  else if (m < 1440) txt = Math.floor(m / 60) + '小时' + (m % 60 ? (m % 60) + '分' : '');
  else txt = Math.floor(m / 1440) + '天';
  return diff > 0 ? txt + '后' : txt + '前';
}
function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return '刚刚更新';
  if (s < 60) return s + ' 秒前更新';
  return Math.round(s / 60) + ' 分钟前更新';
}
function fmtRT(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + pad(s % 60);
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

const WIN_TYPE = {
  Target_Bombed: '炸弹爆炸',
  Bomb_Defused: '拆除炸弹',
  Terrorists_Win: '全歼 CT',
  CTs_Win: '全歼 T',
  Target_Saved: '时间耗尽',
  CTs_Survived: '时间耗尽'
};

/* ---------------- ① 大比分 ---------------- */
function renderSeries(m, bo) {
  const [w1, w2] = m.mapsWon;
  $('sname1').textContent = m.teams[0].name;
  $('sname2').textContent = m.teams[1].name;
  setLogo($('slogo1'), m.teams[0].logo, C_T1, w1 > w2);
  setLogo($('slogo2'), m.teams[1].logo, C_T2, w2 > w1);
  $('slogo1').parentElement.classList.toggle('lose', w1 < w2);
  $('slogo2').parentElement.classList.toggle('lose', w2 < w1);

  const a = $('win1'), b = $('win2');
  a.textContent = w1; b.textContent = w2;
  a.className = w1 > w2 ? 'lead' : '';
  b.className = w2 > w1 ? 'lead' : '';

  $('boText').textContent = bo;

  // 顶栏赛事名
  $('eventName').textContent = m.event.name + (m.stageDesc ? ' · ' + m.stageDesc : '');

  // 地图进度点
  $('boDots').innerHTML = (m.maps || []).map((mp) => {
    if (mp.status === 2) return `<i class="${mp.winner === 0 ? 'a' : mp.winner === 1 ? 'b' : ''}"></i>`;
    if (mp.status === 1) return `<i class="${mp.winner === 0 ? 'a' : mp.winner === 1 ? 'b' : ''}" style="opacity:.5"></i>`;
    return '<i></i>';
  }).join('');

  // 状态行
  let line = '';
  if (m.status === 'live') {
    line = `<span class="tag live">进行中</span>` + hhmm(m.startTs) + ' 开赛' +
      (m.current ? ` · 图${cnNum(m.current.mapIndex + 1)}` : '');
  } else if (m.status === 'finished') {
    const w = w1 > w2 ? m.teams[0].name : m.teams[1].name;
    line = `<span class="tag fin">已结束</span>` + esc(w) + ' 获胜';
  } else {
    line = `<span class="tag up">未开始</span>` + hhmm(m.startTs) + ' 开赛';
  }
  $('statusline').innerHTML = line;
}

/* 队伍代表色：队徽外圈、地图条选图方颜色都用它 */
const C_T1 = '#ff9f43';
const C_T2 = '#49c9ff';

function setLogo(img, url, color, dim) {
  img.className = 'slogo';
  img.style.borderColor = color;
  img.style.boxShadow = `0 0 10px ${color}33`;
  img.style.opacity = dim ? '.92' : '1';
  if (url) img.src = url; else img.removeAttribute('src');
}

/* ---------------- ② 小比分 ---------------- */
/** 当前要看哪张图：selMapNum = 0 跟随当前图 / -1 整场(ALL) / N 指定第N图 */
function activeMap(m) {
  if (!m) return null;
  if (selMapNum > 0) {
    const found = (m.maps || []).find((x) => x.num === selMapNum && x.name);
    if (found) return { ...found, mapIndex: m.maps.indexOf(found) };
  }
  return m.current || pickLastPlayed(m);
}

function renderMapScore(m, bo) {
  const cur = activeMap(m);
  const title = $('curmap'), round = $('curround'), meta = $('roundsMeta');

  if (!cur) {
    title.className = 'mb-title big';
    title.textContent = m.status === 'upcoming' ? relTime(m.startTs) + ' 开赛'
      : (m.status === 'finished' ? '比赛已结束' : '等待开始');
    round.textContent = hhmm(m.startTs);
    $('m1').textContent = m.mapsWon[0]; $('m2').textContent = m.mapsWon[1];
    $('m1').className = ''; $('m2').className = '';
    $('pips').innerHTML = '';
    const bits = [`赛制 <b>${bo}</b>`];
    if (m.odds[0]) bits.push(`胜率 <b>${m.odds[0]}%</b> / ${m.odds[1]}%`);
    if (m.stageDesc) bits.push(esc(m.stageDesc));
    meta.innerHTML = bits.map((x) => `<span>${x}</span>`).join('');
    return;
  }

  title.className = 'mb-title';
  const idx = (cur.mapIndex != null ? cur.mapIndex : 0) + 1;
  title.textContent = `图${cnNum(idx)} ${cur.name}`;

  const stageTxt = cur.stage === 'fh' ? '上半场' : cur.stage === 'sh' ? '下半场' : '';
  round.textContent = cur.status === 1
    ? `${stageTxt} 第 ${Math.max(cur.round, 1)} 回合`
    : (cur.status === 2 ? '本图已结束' : '');

  // 当前地图小比分
  const s1 = $('m1'), s2 = $('m2');
  s1.textContent = cur.score[0]; s2.textContent = cur.score[1];
  const lead = cur.score[0] === cur.score[1] ? '' : (cur.score[0] > cur.score[1] ? 'a' : 'b');
  s1.className = lead === 'a' ? 'lead' : '';
  s2.className = lead === 'b' ? 'lead' : '';

  // 半场 / 攻防 / 下包
  const bits = [];
  if ((cur.stage === 'sh' || cur.status === 2) && cur.half && (cur.half[0] + cur.half[1]) > 0) {
    bits.push(`上半 <b>${cur.half[0]} : ${cur.half[1]}</b>`);
  }
  if (cur.status === 1 && cur.role && cur.role[0]) {
    bits.push(`${esc(m.teams[0].name)} <b>${cur.role[0] === 'T' ? '进攻' : '防守'}</b>`);
  }
  if (cur.status === 1 && cur.bomb && cur.bomb !== '0') bits.push('<b>炸弹已安放</b>');
  meta.innerHTML = bits.map((x) => `<span>${x}</span>`).join('');

  // 回合色块：已打完的回合可点击跳到该回合战况
  curMapNum = cur.num || 0;
  const total = Math.max(cur.pips.length, 24);
  let pips = '';
  for (let i = 0; i < Math.min(total, 30); i++) {
    if (i < cur.pips.length) {
      pips += `<i class="pip ${cur.pips[i] ? 'a' : 'b'} clickable" data-round="${i + 1}" title="跳转到第 ${i + 1} 回合"></i>`;
    } else {
      pips += '<i class="pip none"></i>';
    }
  }
  $('pips').innerHTML = pips;
}

function pickLastPlayed(m) {
  const done = (m.maps || []).filter((x) => x.status === 2);
  if (!done.length) return null;
  const last = done[done.length - 1];
  return { ...last, mapIndex: m.maps.indexOf(last) };
}

/* ---------------- ③ 战况事件流 ---------------- */
/** 面板内容有没有变化的指纹：没变就不重画，避免每秒无谓地闪 */
function matchSig(m) {
  if (!m) return '';
  const c = m.current || {};
  const cs = (c.score || []).join(':');
  const role = (c.role || []).join('');
  const maps = (m.maps || []).map((x) => `${x.num}:${(x.score || []).join(':')}:${x.status}:${x.pick || ''}`).join('|');
  const won = (m.mapsWon || []).join(',');
  return [won, c.num || 0, cs, c.round || 0, c.stage || '', c.bomb || '', role, maps].join('#');
}

function feedSig(feed, mapNum) {
  if (!feed || !feed.length) return 'empty';
  const last = feed[feed.length - 1];
  return `${mapNum}|${feed.length}|${last.ts || 0}|${last.killer || last.who || ''}`;
}

function renderFeed(feed, total, m) {
  const box = $('feedList');
  const all = selMapNum === -1;                      // ALL：整场所有图
  const scope = all ? 0 : (selMapNum > 0 ? selMapNum : curMapNum);

  // 只显示当前选中那张图的事件，避免多图混在一起太臃肿
  const list = all ? (feed || []) : (feed || []).filter((e) => !scope || e.mapNum === scope);
  const label = all ? '整场 · ' : (scope ? `图${cnNum(scope)} · ` : '');
  $('feedCount').textContent = list.length ? label + list.length + ' 条' : '';

  if (!list.length) {
    box.innerHTML = `<div class="feed-empty">${m && m.status === 'upcoming' ? '比赛还没开始' : '这张图还没有战况'}</div>`;
    renderedCount = 0; renderedScope = scope; renderedTopTs = 0;
    return;
  }

  const prevTop = box.scrollTop;
  const prevH = box.scrollHeight;

  // 增量：同一批数据只是多了新事件时，只把新行插到最上面，避免整表重建闪一下
  const canPrepend = renderedScope === scope && renderedCount > 0
    && list.length > renderedCount
    && renderedTopTs === (list[0] && list[0].ts);

  if (canPrepend) {
    const add = list.slice(renderedCount);
    const html = [];
    for (let i = add.length - 1; i >= 0; i--) html.push(feedRow(add[i], 0));
    box.insertAdjacentHTML('afterbegin', html.join(''));
    renderedCount = list.length;
    renderedTopTs = list[0].ts;
  } else {
    // 全量渲染（换了图 / 首次 / 数据回滚）
    const rows = [];
    let lastMap = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      rows.push(feedRow(e, all && e.mapNum && e.mapNum !== lastMap ? e.mapNum : 0));
      if (e.mapNum) lastMap = e.mapNum;
    }
    box.innerHTML = rows.join('');
    renderedCount = list.length;
    renderedScope = scope;
    renderedTopTs = list[0] ? list[0].ts : 0;
  }

  // 新事件插在最上面：如果用户正在看历史，把视口内容顶回去，不让画面跳动
  const delta = box.scrollHeight - prevH;
  box.scrollTop = (prevTop > 4 && delta > 0) ? prevTop + delta : prevTop;
}

function feedRow(e, mapLabel) {
  if (e.kind === 'kill') {
    const sideCls = e.killerSide === 'T' ? 't' : e.killerSide === 'CT' ? 'ct' : '';
    const tags = [];
    if (e.hs) tags.push('<span class="tagx hs">爆头</span>');
    if (e.smoke) tags.push('<span class="tagx">穿烟</span>');
    if (e.wall) tags.push('<span class="tagx">穿墙</span>');
    if (e.noscope) tags.push('<span class="tagx">盲狙</span>');
    if (e.blind) tags.push('<span class="tagx">致盲</span>');
    // 一行式：击杀者 → 武器 → 被击杀者 → 标记，右侧贴对局时间
    const wpn = e.weaponLogo
      ? `<img class="wpn" src="${esc(e.weaponLogo)}" onerror="this.remove()" />`
      : `<span class="wname">${esc(shortWeapon(e.weapon))}</span>`;
    return `<div class="frow kill" data-map="${e.mapNum || ''}">
      <span class="k ${sideCls}">${esc(e.killer)}</span>
      ${wpn}
      <span class="v">${esc(e.victim)}</span>
      <span class="tags">${tags.join('')}</span>
      <span class="tm">${fmtTime(e.ts)}</span>
    </div>`;
  }
  if (e.kind === 'bomb') {
    return `<div class="frow evt" data-map="${e.mapNum || ''}">
      <span class="left"><span class="badge c4">下包</span><b>${esc(e.who)}</b></span>
      <span class="sub">${esc(e.site || '?')} 点</span>
      <span class="rt">
        ${e.tAlive !== '' ? `<span class="alive">剩余 ${esc(e.tAlive)}v${esc(e.ctAlive)}</span>` : ''}
        <span class="tm">${fmtTime(e.ts)}</span>
      </span>
    </div>`;
  }
  if (e.kind === 'defuse') {
    return `<div class="frow evt" data-map="${e.mapNum || ''}">
      <span class="left"><span class="badge def">拆包</span><b>${esc(e.who)}</b></span>
      <span class="sub">炸弹已拆除</span>
      <span class="rt"><span class="tm">${fmtTime(e.ts)}</span></span>
    </div>`;
  }
  if (e.kind === 'suicide') {
    return `<div class="frow evt" data-map="${e.mapNum || ''}">
      <span class="left"><b>${esc(e.who)}</b><span class="sub">意外阵亡</span></span>
      <span class="rt">
        <span class="sub">${esc(shortWeapon(e.weapon))}</span>
        <span class="tm">${fmtTime(e.ts)}</span>
      </span>
    </div>`;
  }
  if (e.kind === 'round_end') {
    const wt = WIN_TYPE[e.winType] || e.winType || '回合结束';
    const who = e.winner === 'T' ? 'T 方' : e.winner === 'CT' ? 'CT 方' : '';
    return `<div class="frow round" data-map="${e.mapNum || ''}" data-round="${e.round || 0}">
      <span class="rtag">${mapLabel ? '图' + cnNum(mapLabel) + ' · ' : ''}第${e.round || '?'}回合</span>
      <span class="rtext">${who}获胜 · ${esc(wt)}</span>
      <span class="rscore">CT ${esc(e.ctScore)} : ${esc(e.tScore)} T</span>
    </div>`;
  }
  return '';
}

function shortWeapon(w) {
  if (!w) return '—';
  const map = {
    ak47: 'AK', m4a1: 'M4', m4a1_silencer: 'M4-S', awp: 'AWP', deagle: '沙鹰',
    glock: '格洛克', usp_silencer: 'USP-S', hkp2000: 'P2000', galilar: '加利尔',
    famas: 'FAMAS', sg556: '鸟狙', aug: 'AUG', ssg08: 'SSG', mac10: 'MAC-10',
    mp9: 'MP9', mp7: 'MP7', ump45: 'UMP', p90: 'P90', bizon: 'PP-野牛',
    nova: '新星', xm1014: 'XM', mag7: 'MAG-7', sawedoff: '截短', negev: '内格夫',
    m249: 'M249', tec9: 'TEC-9', fiveseven: '57', cz75a: 'CZ75', revolver: 'R8',
    hegrenade: '手雷', flashbang: '闪光', smokegrenade: '烟雾', molotov: '燃烧瓶',
    incgrenade: '燃烧弹', decoy: '诱饵弹', knife: '刀', taser: '电击枪', world: '坠落'
  };
  return map[w] || w.toUpperCase();
}

/** 用当前状态重画一遍（切换选中地图时用，不依赖新数据） */
function repaint() {
  if (!S) return;
  renderMatch(S.match, S.config);
  lastMatchSig = matchSig(S.match);
  if (paneView === 'stats') {
    renderStats(S.match);
  } else {
    renderFeed(S.feed, S.feedTotal, S.match);
    lastFeedSig = feedSig(S.feed, curMapNum);
  }
}

/* ---------------- ④ 数据总览 ---------------- */
function renderStats(m) {
  const box = $('statsList');
  const scope = selMapNum;

  let pl = {}, cap = '';
  if (scope === -1) {
    pl = (m && m.players) || {};
    cap = '整场 BO3';
  } else {
    const num = scope > 0 ? scope : curMapNum;
    const mp = num && m ? (m.maps || []).find((x) => x.num === num) : null;
    pl = (mp && mp.players) || {};
    if (!mp) cap = '';
    else if (mp.status === 1) cap = `图${cnNum(mp.num)} ${mp.name} 正在打，结束后统计`;
    else if (!pl.t1 || !pl.t1.length) cap = `图${cnNum(mp.num)} ${mp.name} 暂无数据`;
    else cap = `图${cnNum(mp.num)} ${mp.name}`;
  }

  const t1 = pl.t1 || [], t2 = pl.t2 || [];
  if (!t1.length && !t2.length) {
    box.innerHTML = `<div class="feed-empty">${cap || '暂无选手数据'}</div>`;
    return;
  }

  const head = `<div class="strow sthead"><span>选手</span><span>K</span><span>D</span><span>A</span><span>ADR</span><span>Rating</span></div>`;

  const team = (list, idx) => {
    const t = (m.teams && m.teams[idx]) || {};
    const won = (m.mapsWon && m.mapsWon[idx]) || 0;
    const rows = list.map((p) => {
      const star = pl.mvp && pl.mvp.name === p.name ? '<i class="mvpstar">★</i>' : '';
      return `<div class="strow">
        <span class="sn ${idx === 0 ? 'c1' : 'c2'}">${star}${esc(p.name)}</span>
        <span class="num">${p.kill}</span>
        <span class="num">${p.death}</span>
        <span class="num">${p.assist}</span>
        <span class="num adr">${p.adr}</span>
        <span class="num rating">${p.rating}</span>
      </div>`;
    }).join('');
    return `<div class="steam ${idx === 0 ? 'c1' : 'c2'}"><i class="tdot"></i>${esc(t.name || '')}<span class="stsc">${won} 图胜</span></div>` + rows;
  };

  box.innerHTML = (cap ? `<div class="stcap">${esc(cap)}</div>` : '') + head + team(t1, 0) + team(t2, 1);
}

/** 内容区在「战况 / 数据总览」之间切换（同一个区域，不会互相打架） */
function setPane(v) {
  paneView = v;
  $('feedList').classList.toggle('off', v !== 'feed');
  $('statsList').classList.toggle('on', v === 'stats');
  [...$('segView').children].forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'stats') {
    if (S) renderStats(S.match);
    $('statsList').scrollTop = 0;
    const pl = S && S.match && S.match.players;
    $('feedCount').textContent = pl && pl.mvp ? 'MVP ' + pl.mvp.name : '';
  } else {
    if (S) {
      renderFeed(S.feed, S.feedTotal, S.match);
      lastFeedSig = feedSig(S.feed, curMapNum);
    }
  }
}

/* ---------------- ④ 地图战绩 ---------------- */
function renderMaps(m) {
  let list = m.maps || [];
  const hasName = list.some((x) => x.name);
  if (!hasName) {
    const n = m.format === 5 ? 5 : m.format === 1 ? 1 : 3;
    list = Array.from({ length: n }, (_, i) => ({ name: '图' + (i + 1), status: -1, played: false, score: [0, 0] }));
  }
  $('maps').innerHTML =
    `<div class="mapchip all${selMapNum === -1 ? ' sel' : ''}" data-all="1" title="整场 BO3 数据总览">ALL</div>` +
    list.map((mp) => {
    const cls = ['mapchip'];
    if (mp.status === 1) cls.push('cur');
    else if (mp.status === 2) cls.push('played');
    else if (mp.status === -1 || !mp.played) cls.push('tbd');
    if (mp.num && mp.num === curMapNum) cls.push('sel');
    // 谁选的这张图：边框用该队队色，和上面的队徽外圈一致
    if (mp.pick === 't1_pick') cls.push('pick1');
    else if (mp.pick === 't2_pick') cls.push('pick2');
    const sc = mp.played && mp.status !== -1 ? `${mp.score[0]}:${mp.score[1]}` : '—';
    const short = hasName ? (mp.name || '').slice(0, 3).toUpperCase() : mp.name;
    const who = mp.pick === 't1_pick' ? m.teams[0].name + ' 选图'
      : mp.pick === 't2_pick' ? m.teams[1].name + ' 选图' : '';
    return `<div class="${cls.join(' ')}" data-map="${mp.num || ''}" title="${esc(mp.name)}${who ? ' · ' + esc(who) : ''}">
      <span class="mn">${esc(short)}</span><span class="ms">${sc}</span></div>`;
  }).join('');
}

/* ---------------- ⑤ 点击跳转战况 ---------------- */
function flashRow(el) {
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1500);
}

function scrollFeedTo(el) {
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flashRow(el);
  return true;
}

/** 跳到某一图的某一回合（找不到回合就退到该图最新一条） */
function jumpToRound(mapNum, round) {
  const box = $('feedList');
  let el = box.querySelector('.frow.round[data-map="' + mapNum + '"][data-round="' + round + '"]');
  if (!el) el = box.querySelector('.frow[data-map="' + mapNum + '"]');
  return scrollFeedTo(el);
}

/** 跳到某一图的战况 */
function jumpToMap(mapNum) {
  const box = $('feedList');
  return scrollFeedTo(box.querySelector('.frow[data-map="' + mapNum + '"]'));
}

/* ---------------- 总渲染 ---------------- */
function renderMatch(m, cfg) {
  const size = (cfg && cfg.size) || 'large';
  const inPanel = document.body.classList.contains('settings-open') || document.body.classList.contains('picking');
  document.body.classList.toggle('size-s', size === 'small' && !inPanel);
  document.body.classList.toggle('size-m', size === 'medium' && !inPanel);

  if (!m) {
    $('eventName').textContent = '无比赛数据';
    $('statusline').textContent = (S && S.error) ? S.error : '正在获取 5E 赛程…';
    $('sname1').textContent = '—'; $('sname2').textContent = '—';
    $('win1').textContent = '–'; $('win2').textContent = '–';
    $('slogo1').removeAttribute('src'); $('slogo2').removeAttribute('src');
    $('m1').textContent = '–'; $('m2').textContent = '–';
    $('curmap').textContent = '—'; $('curround').textContent = '';
    $('roundsMeta').innerHTML = ''; $('pips').innerHTML = '';
    $('maps').innerHTML = '';
    $('feedList').innerHTML = '<div class="feed-empty">等待数据…</div>';
    return;
  }

  const bo = m.format === 3 ? 'BO3' : m.format === 5 ? 'BO5' : m.format === 1 ? 'BO1' : 'BO' + m.format;
  const dot = $('liveDot');
  dot.className = 'dot ' + (m.status === 'live' ? 'live' : m.status === 'finished' ? 'done' : '');

  renderSeries(m, bo);
  renderMapScore(m, bo);
  renderMaps(m);
}

/* ---------------- 比赛列表 ---------------- */
function renderPicker(list, cfg) {
  if (!picking) return;
  const q = query.trim().toLowerCase();
  const items = (list || []).filter((it) => {
    if (!q) return true;
    return (it.teams[0].name + ' ' + it.teams[1].name + ' ' + it.event).toLowerCase().includes(q);
  });

  if (!items.length) {
    $('pickerList').innerHTML = '<div class="empty">没有匹配的比赛</div>';
    return;
  }

  const rowOf = (it) => {
    // 分组标题已经写明"已结束/进行中/未开始"，这里统一显示开赛时间，方便看先后顺序
    const badge = it.status === 'live' ? '<span class="badge">LIVE</span>'
      : it.status === 'finished' ? `<span class="badge fin">${listTime(it.startTs)}</span>`
        : `<span class="badge up">${listTime(it.startTs)}</span>`;
    const score = it.status === 'upcoming' ? 'vs' : `${it.score[0]} : ${it.score[1]}`;
    const active = cfg && cfg.pinnedId === it.id ? ' active' : '';
    return `<div class="prow${active}" data-id="${esc(it.id)}" data-group="${it.status}">
      <span class="pav"><i>${esc((it.teams[0].name || '?').slice(0, 1))}</i>
        <img src="${esc(it.teams[0].logo)}" onerror="this.remove()" /></span>
      <div class="pn">${esc(it.teams[0].name)} <span style="color:#5f6579">vs</span> ${esc(it.teams[1].name)}
        <span class="ev">${esc(it.event)}${it.stage ? ' · ' + esc(it.stage) : ''}</span></div>
      <span class="ps">${score}</span>
      ${badge}
    </div>`;
  };

  // 分组：已结束在上（往上滚），进行中居中，未开始在下（往下滚）
  const groups = [
    { key: 'finished', label: '已结束' },
    { key: 'live', label: '进行中' },
    { key: 'upcoming', label: '未开始' }
  ];
  const html = groups.map((g) => {
    const rows = items.filter((it) => it.status === g.key);
    if (!rows.length) return '';
    return `<div class="pgroup">${g.label} · ${rows.length}</div>` + rows.map(rowOf).join('');
  }).join('');

  $('pickerList').innerHTML = html;

  // 打开面板时把列表定位到「进行中」那一段
  if (needFocusLive) {
    needFocusLive = false;
    const listEl = $('pickerList');
    const target = listEl.querySelector('.prow[data-group="live"]') || listEl.querySelector('.prow[data-group="upcoming"]');
    if (target) {
      // 用分组标题当锚点，避免被吸顶标题遮住
      const prev = target.previousElementSibling;
      const anchor = prev && prev.classList.contains('pgroup') ? prev : target;
      const offset = anchor.getBoundingClientRect().top - listEl.getBoundingClientRect().top + listEl.scrollTop;
      listEl.scrollTop = Math.max(0, offset - 2);
    }
  }
}

/* ---------------- 交互 ---------------- */
document.addEventListener('click', (e) => {
  const row = e.target.closest('.prow');
  if (row) {
    api.select(row.dataset.id);
    closePicker();
  }
});

$('btnList').onclick = () => {
  if (settingsOpen) closeSettings();
  picking = !picking;
  if (picking) needFocusLive = true;
  document.body.classList.toggle('picking', picking);
  $('btnList').classList.toggle('on', picking);
  api.setView(picking ? 'picker' : 'match');
  if (picking) {
    const has = S && S.list && S.list.length;
    if (!has) {
      $('pickerList').innerHTML = '<div class="empty">正在获取比赛列表…</div>';
      api.refresh();
    }
    renderPicker(S && S.list, S && S.config);
    setTimeout(() => $('search').focus(), 120);
  }
};
function closePicker() {
  picking = false;
  document.body.classList.remove('picking');
  $('btnList').classList.remove('on');
  api.setView('match');
}
$('btnClose').onclick = closePicker;
$('btnTop').onclick = () => api.toggleTop();
$('btnRefresh').onclick = () => { api.refresh(); $('updated').textContent = '刷新中…'; };
$('btnSize').onclick = () => {
  const order = ['large', 'medium', 'small'];
  const cur = (S && S.config && S.config.size) || 'large';
  const next = order[(order.indexOf(cur) + 1) % 3];
  api.setPreset(next);
  if (S && S.config) S.config.size = next;
};
$('btnOpen').onclick = () => {
  const id = S && S.match && S.match.id;
  api.openLink(id ? `https://event.5eplay.com/csgo/matches/${id}` : 'https://event.5eplay.com/csgo/matches');
};
$('btnHide').onclick = () => api.hide();
$('search').oninput = (e) => { query = e.target.value; renderPicker(S && S.list, S && S.config); };

/* ---------------- 设置 ---------------- */
let settingsOpen = false;
const SIZE_HINT = {
  large: '大：完整版，430×470，包含地图战绩与完整战况',
  medium: '中：窗口 323×353，内容与「大」一致，字号单独优化保证可读',
  small: '小：精简版（215×235），只保留大比分、小比分和对局情况'
};

$('btnSet').onclick = () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) { picking = false; document.body.classList.remove('picking'); $('btnList').classList.remove('on'); }
  document.body.classList.toggle('settings-open', settingsOpen);
  $('btnSet').classList.toggle('on', settingsOpen);
  api.setView(settingsOpen ? 'settings' : 'match');
  renderSettings();
};
function closeSettings() {
  settingsOpen = false;
  document.body.classList.remove('settings-open');
  $('btnSet').classList.remove('on');
  api.setView('match');
}
$('btnSetClose').onclick = closeSettings;
$('btnSetDone').onclick = closeSettings;

$('segSize').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b) return;
  const size = b.dataset.size;
  api.setPreset(size);
  syncSettings({ ...(S && S.config), size });
  // 面板打开时窗口被固定在面板尺寸上，看不到变化，所以立刻收起面板让新尺寸生效
  setTimeout(closeSettings, 220);
});
$('segInterval').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-int]');
  if (!b) return;
  api.setInterval(Number(b.dataset.int));
  syncSettings({ ...(S && S.config), intervalSec: Number(b.dataset.int) });
});
$('segOpacity').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-op]');
  if (!b) return;
  api.setOpacity(Number(b.dataset.op));
  syncSettings({ ...(S && S.config), opacity: Number(b.dataset.op) });
});
$('segTheme').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-theme]');
  if (!b) return;
  const th = b.dataset.theme === 'light' ? 'light' : 'dark';
  api.setTheme(th);
  document.body.classList.toggle('light', th === 'light');   // 立刻生效，不用等 IPC 回传
  syncSettings({ ...(S && S.config), theme: th });
});
$('swTop').onclick = () => {
  api.toggleTop();
  syncSettings({ ...(S && S.config), alwaysOnTop: !(S && S.config && S.config.alwaysOnTop) });
};
$('swRound').onclick = () => {
  const on = !(S && S.config && S.config.rounded !== false);
  api.setRounded(on);
  syncSettings({ ...(S && S.config), rounded: on });
};
$('swBoot').onclick = () => {
  api.toggleBoot();
  syncSettings({ ...(S && S.config), boot: !(S && S.config && S.config.boot) });
};

function syncSettings(cfg) {
  const c = cfg || {};
  const size = c.size || 'large';
  [...$('segSize').children].forEach((b) => b.classList.toggle('on', b.dataset.size === size));
  $('sizeHint').textContent = SIZE_HINT[size] || '';
  [...$('segInterval').children].forEach((b) => b.classList.toggle('on', Number(b.dataset.int) === (c.intervalSec || 15)));
  const op = c.opacity || 1;
  [...$('segOpacity').children].forEach((b) => b.classList.toggle('on', Number(b.dataset.op) === op));
  $('swTop').classList.toggle('on', !!c.alwaysOnTop);
  $('swBoot').classList.toggle('on', !!c.boot);
  $('swRound').classList.toggle('on', c.rounded !== false);
  const th = c.theme || 'dark';
  [...$('segTheme').children].forEach((b) => b.classList.toggle('on', b.dataset.theme === th));
}
function renderSettings() { syncSettings(S && S.config); }

/* 点击回合圆点 / 地图条 → 跳到战况对应位置 */
$('segView').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  setPane(b.dataset.view);
});

$('pips').addEventListener('click', (e) => {
  const p = e.target.closest('.pip[data-round]');
  if (!p) return;
  jumpToRound(curMapNum, Number(p.dataset.round));
});
$('maps').addEventListener('click', (e) => {
  // ALL：整场 BO3 数据总览
  const allBtn = e.target.closest('.mapchip[data-all]');
  if (allBtn) {
    selMapNum = -1;
    setPane('stats');
    repaint();
    return;
  }
  const c = e.target.closest('.mapchip[data-map]');
  if (!c || !c.dataset.map) return;
  selMapNum = Number(c.dataset.map);
  setPane('feed');           // 点某张图 → 看这张图的战斗记录
  repaint();
  const box = $('feedList');
  if (box) box.scrollTop = 0;
});

/* ---------------- 自己实现拖动：按住右键空白处移动窗口 ----------------
   左键留给界面里的按钮（点地图条、切战况/数据总览等），右键才是拖窗口 */
let dragging = false;
let dragMoved = false;      // 本次按下有没有移动过（用来区分"右键单击"和"右键拖动"）

document.addEventListener('mousedown', (e) => {
  if (e.button !== 2) return;                       // 只有右键拖动
  if (e.target.closest('input, textarea, select')) return;
  dragging = true;
  dragMoved = false;
  document.body.classList.add('dragging');
  api.dragBegin();
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  dragMoved = true;
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('dragging');
  api.dragEnd();
}
document.addEventListener('mouseup', endDrag);
window.addEventListener('blur', endDrag);

/* ---------------- 状态推送 ---------------- */
api.onCmd((cmd) => {
  if (cmd === 'settings' && !settingsOpen) $('btnSet').click();
  if (cmd === 'picker' && !picking) $('btnList').click();
});

// 右键菜单：只有"右键单击（没拖动）"才弹；右键拖动窗口时不弹
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (dragMoved) return;
  api.ctxMenu();
});

api.onState((payload) => {
  S = payload;
  const mid = payload.match && payload.match.id;
  if (mid !== lastMatchId) {
    lastMatchId = mid;
    selMapNum = 0;
    // 换到一场新比赛：已打完的默认先看「数据总览」，进行中的先看「战况」
    setPane(payload.match && payload.match.status === 'finished' ? 'stats' : 'feed');
  }
  const liveNum = payload.match && payload.match.current ? payload.match.current.num : 0;
  if (liveNum !== lastLiveNum) {
    lastLiveNum = liveNum;
    // 新一张图开打：如果之前在看某张已打完的图，就回到跟随当前图（ALL 保持不变）
    if (selMapNum > 0) {
      const old = payload.match && (payload.match.maps || []).find((x) => x.num === selMapNum);
      if (old && old.status === 2) selMapNum = 0;
    }
  }
  const cfg = payload.config || {};
  $('btnTop').classList.toggle('on', !!cfg.alwaysOnTop);
  document.body.classList.toggle('light', (cfg.theme || 'dark') === 'light');

  // 只有内容真的变了才重画，否则每秒整页重排会闪
  const msig = matchSig(payload.match);
  if (msig !== lastMatchSig) {
    lastMatchSig = msig;
    renderMatch(payload.match, cfg);
  }

  if (paneView === 'stats') {
    renderStats(payload.match);
    const pl = payload.match && payload.match.players;
    $('feedCount').textContent = pl && pl.mvp ? 'MVP ' + pl.mvp.name : '';
  } else {
    const fsig = feedSig(payload.feed, curMapNum);
    if (fsig !== lastFeedSig) {
      lastFeedSig = fsig;
      renderFeed(payload.feed, payload.feedTotal, payload.match);
    }
  }
  $('updated').textContent = ago(payload.updatedAt || Date.now());
  renderPicker(payload.list, cfg);
  if (settingsOpen) renderSettings();
});

// 每 10 秒刷新一下「多久前更新」
setInterval(() => {
  if (S && S.updatedAt) $('updated').textContent = ago(S.updatedAt);
}, 10000);

if (!S) api.refresh();
