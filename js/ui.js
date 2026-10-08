/* =========================================================
 *  东秦杀：点名册  ·  界面层（渲染 + 人类交互）
 * ========================================================= */
(function(){
'use strict';
const D = window.GameData;
const E = window.Engine;
const CARDS = D.CARDS;
const UI = {};
window.UI = UI;

let playMode = null;      // 当前出牌阶段的可交互信息
let resolvePlay = null;   // playPhase 的 Promise 回调

/* ---------------- 屏幕切换 ---------------- */
function show(screen){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + screen);
  if (el) el.classList.add('active');
}
UI.show = show;

/* ---------------- 日志 / 提示 ---------------- */
UI.pushLog = function(text, cls){
  const box = document.getElementById('log');
  if (!box) return;
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  box.appendChild(div);
  while (box.children.length > 400) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
};
UI.toast = function(text, cls){
  const layer = document.getElementById('toast-layer');
  if (!layer) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (cls || '');
  t.textContent = text;
  layer.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0';
    setTimeout(() => t.remove(), 320); }, 2200);
};
UI.setPhase = function(name){
  const el = document.getElementById('phase-label');
  if (el) el.textContent = D.PHASE_NAME[name] || name;
};

/* ---------------- 卡牌 DOM ---------------- */
function cardEl(card, opts){
  opts = opts || {};
  const div = document.createElement('div');
  const meta = CARDS[card.name] || {};
  const red = D.isRedCard(card);
  let cls = 'card ' + (red ? 'red' : 'black');
  if (meta.type === 'equip') cls += ' equip';
  if (meta.type === 'delayed') cls += ' delayed';
  if (meta.type === 'event') cls += ' event';
  if (opts.dim) cls += ' dim';
  if (opts.sel) cls += ' sel';
  if (opts.big) cls += ' big';
  div.className = cls;
  const suit = D.suitOf(card).sym;
  const rl = D.rankLabel(card.rank);
  div.innerHTML =
    '<div class="c-band"></div>' +
    '<div class="c-corner">' + rl + '<span class="suit">' + suit + '</span></div>' +
    '<div class="c-corner br">' + rl + '<span class="suit">' + suit + '</span></div>' +
    '<div class="c-name">' + card.name + '</div>' +
    '<div class="c-desc">' + (meta.desc || '') + '</div>' +
    '<div class="c-tip">长按看详情</div>';
  div.addEventListener('click', () => {
    if (div._lpFired){ div._lpFired = false; return; }
    if (opts.onClick) opts.onClick(card, div);
  });
  // 长按 / 右键 → 查看牌面详情
  if (window.FX) FX.bindLongPress(div, () => FX.showCardDetail(card));
  return div;
}
UI.cardEl = cardEl;

/* ---------------- 渲染 ---------------- */
UI.render = function(){
  if (!window.G || !G.players || !G.players.length) return;
  renderTopbar();
  renderOpponents();
  renderHand();
  renderActions();
};

function renderTopbar(){
  document.getElementById('deck-count').textContent = G.deck ? G.deck.length : 0;
  document.getElementById('discard-count').textContent = G.discard ? G.discard.length : 0;
  document.getElementById('round-count').textContent = G.round;
  const banner = document.getElementById('my-id-banner');
  if (banner){
    const me = G.players[G.humanSeat];
    if (me && me.identity){
      const id = D.IDENTITIES[me.identity];
      banner.innerHTML = '你的身份：<b class="bid ' + id.cls + '">' + id.name + '</b>' +
        '　<span style="color:#8fa0b5">角色：' + (me.char ? me.char.name : '—') + '</span>' +
        '　<span style="color:#7e8ea3;font-size:12px">目标：' + id.win + '</span>';
    }
  }
}

function identityTag(p, isMe){
  const id = D.IDENTITIES[p.identity];
  if (isMe) return '<span class="pp-id ' + (p.identity === 'dean' ? 'dean' : 'revealed-' + p.identity) + '">' + id.name + '（你）</span>';
  if (p.revealed || p.identity === 'dean') return '<span class="pp-id ' + (p.identity==='dean'?'dean':'revealed-' + p.identity) + '">' + id.name + '</span>';
  return '<span class="pp-id hidden">身份未知</span>';
}

function panelEl(p, isMe){
  const div = document.createElement('div');
  div.className = 'player-panel';
  div.dataset.seat = p.seat;
  if (!p.alive) div.classList.add('dead');
  if (window.G.turnSeat === p.seat && p.alive) div.classList.add('turn');
  const idTag = identityTag(p, isMe);
  let hpPips = '';
  for (let i=1;i<=p.maxHp;i++) hpPips += '<span class="hp-pip' + (i <= p.hp ? ' on' : '') + (p.identity==='mole'&&isMe?' mole-hp':'') + '"></span>';
  // 装备与通知栏用 DOM 元素生成，便于长按查看牌面
  const marks = [];
  if (p.marks.buff) marks.push('<span class="pp-tag warn">红牛 ×' + p.marks.buff + '</span>');
  if (p.chained) marks.push('<span class="pp-tag warn">横置</span>');
  if (p.dodgeBan) marks.push('<span class="pp-tag warn">禁代课</span>');
  if (p.marks.pigeon) marks.push('<span class="pp-tag warn">鸽王</span>');
  if (p.marks.net) marks.push('<span class="pp-tag warn">断网</span>');
  if (p.pointBan) marks.push('<span class="pp-tag warn">禁点名</span>');
  const dmgBonus = p.char && E.hasSkill(p,'体能') ? '<span class="pp-tag">手牌上限+1</span>' : '';

  const known = p.revealed || p.identity === 'dean' || isMe;
  const avatarCls = known ? D.IDENTITIES[p.identity].cls : '';
  // 距离信息（相对人类玩家，直观体现"围圈坐"）
  let distTags = '';
  const me = G.players[G.humanSeat];
  if (me && !isMe && p.alive && me.alive && window.Engine){
    const d = E.distance(me, p), rng = E.attackRange(me);
    const inR = d <= rng;
    distTags = '<span class="pp-tag dist">距你 ' + d + '</span>';
    if (G.players[G.turnSeat] === me)
      distTags += '<span class="pp-tag ' + (inR ? 'good' : 'out') + '">' + (inR ? '可点名' : '范围外') + '</span>';
  }
  div.innerHTML =
    '<div class="pp-head">' +
      '<div class="pp-avatar ' + avatarCls + '">' + (p.char ? p.char.name.charAt(0) : '?') + '</div>' +
      '<div style="flex:1;min-width:0"><div class="pp-name">' + p.name + (isMe ? ' <span style="color:#8fb8e8;font-size:12px">（你）</span>' : '') + '</div>' +
    '<div class="pp-title">' + (p.char ? p.char.title : '') + '</div></div>' +
    '<div style="text-align:right">' + idTag + '<div class="pp-seat">' + (p.seat+1) + ' 号位</div></div></div>' +
    '<div class="pp-hp">' + hpPips + '<span class="hp-num">' + Math.max(0,p.hp) + '/' + p.maxHp + '</span></div>' +
    '<div class="pp-row"><span class="pp-tag">手牌 ' + p.hand.length + '</span>' + marks.join('') + dmgBonus + distTags + '</div>';
  // 装备区
  const gbox = document.createElement('div');
  gbox.className = 'pp-gears';
  ['weapon','armor','mount'].forEach(k => {
    if (!p.equips[k]) return;
    gbox.appendChild(chipWithDetail(p.equips[k].name, p.equips[k], 'gear-chip'));
  });
  if (gbox.children.length) div.appendChild(gbox);
  // 通知栏：延时类事件牌以小卡形式贴在角色面板上
  if (p.judge.length){
    const wrap = document.createElement('div');
    wrap.className = 'pp-judge-wrap';
    const lab = document.createElement('span');
    lab.className = 'pp-judge-label';
    lab.textContent = '通知栏';
    wrap.appendChild(lab);
    const row = document.createElement('div');
    row.className = 'pp-judge-cards';
    const ordered = p.judge.slice().reverse();      // 后进先出：最左侧最先结算
    ordered.forEach((c, i) => {
      const mc = miniCard(c);
      if (i === 0) mc.classList.add('next');
      mc.title = c.name + (i === 0 ? '（下一个结算）' : '');
      row.appendChild(mc);
    });
    wrap.appendChild(row);
    div.appendChild(wrap);
  }
  // 长按查看角色技能详情
  if (window.FX) FX.bindLongPress(div, () => FX.showCharDetail(p));
  return div;
}

/** 通知栏用的小卡（贴在角色面板上，直观显示身上的延时牌） */
function miniCard(card){
  const el = document.createElement('div');
  const red = D.isRedCard(card);
  el.className = 'mini-card ' + (red ? 'red' : 'black');
  el.innerHTML = '<span class="m-rank">' + D.rankLabel(card.rank) + '</span>' +
                 '<span class="m-suit">' + D.suitOf(card).sym + '</span>' +
                 '<span class="m-name">' + card.name + '</span>';
  el.addEventListener('pointerdown', e => e.stopPropagation());
  if (window.FX) FX.bindLongPress(el, () => FX.showCardDetail(card));
  return el;
}

/** 生成带"长按查看牌面"的小标签 */
function chipWithDetail(text, card, cls){
  const chip = document.createElement('span');
  chip.className = cls;
  chip.textContent = text;
  chip.addEventListener('pointerdown', ev => ev.stopPropagation());   // 避免同时触发面板长按
  if (window.FX && card) FX.bindLongPress(chip, () => FX.showCardDetail(card));
  return chip;
}

function renderOpponents(){
  const box = document.getElementById('opponents');
  if (!box) return;
  box.innerHTML = '';
  // 横向排列：按座位顺序从左到右，你自己也在队列里
  G.players.forEach(p => {
    const el = panelEl(p, p.seat === G.humanSeat);
    el.classList.add('row-seat');
    if (p.seat === G.humanSeat) el.classList.add('is-me');
    el.addEventListener('click', () => onTargetClick(p, el));
    box.appendChild(el);
  });
}

/* 座位排列已改为横向队列（含你自己），无需再用 JS 摆位 */

function renderHand(){
  const box = document.getElementById('my-hand');
  if (!box) return;
  const me = G.players[G.humanSeat];
  box.innerHTML = '';
  const playableNames = new Set();
  if (playMode){
    playMode.playable.forEach(it => playableNames.add(it.card.name));
  }
  me.hand.forEach(c => {
    const isPlayable = playMode && playableNames.has(c.name);
    const el = cardEl(c, {
      dim: playMode && !isPlayable,
      onClick: (card) => { if (playMode && isPlayable) onHandCardClick(card); }
    });
    if (isPlayable) el.classList.add('playable');
    box.appendChild(el);
  });
  const hint = document.getElementById('hand-hint');
  if (hint) hint.textContent = playMode
    ? '点击高亮手牌使用（无目标牌会直接结算）　·　长按任意牌查看完整效果　·　长按角色看技能'
    : '等待其他玩家行动……　·　长按任意牌 / 角色可查看详情';
}

function renderActions(){
  const box = document.getElementById('actions');
  if (!box) return;
  box.innerHTML = '';
  const me = G.players[G.humanSeat];
  const isMyPlay = playMode && G.players[G.turnSeat] === me;
  if (isMyPlay){
    playMode.skills.forEach(s => {
      const tg = s.eqSkill ? [me] : E.skillTargets(me, s);
      const btn = document.createElement('button');
      btn.className = 'skill';
      btn.textContent = '【' + s.name + '】';
      btn.title = s.desc || '';
      btn.disabled = tg.length === 0;
      btn.addEventListener('click', () => onSkillClick(s, tg));
      box.appendChild(btn);
    });
    const end = document.createElement('button');
    end.className = 'primary';
    end.textContent = '结束出牌阶段';
    end.addEventListener('click', () => {
      const fn = resolvePlay; playMode = null; resolvePlay = null; UI.render();
      if (fn) fn({ action:{ type:'end' } });
    });
    box.appendChild(end);
  } else {
    const span = document.createElement('span');
    span.style.color = '#8fa0b5';
    span.style.fontSize = '13px';
    span.textContent = G.over ? '游戏已结束' : (G.players[G.turnSeat] ? '当前回合：' + G.players[G.turnSeat].name : '');
    box.appendChild(span);
  }
}

/* ---------------- 弹窗基础 ---------------- */
function closeModal(){
  const layer = document.getElementById('modal-layer');
  layer.classList.remove('show');
  layer.innerHTML = '';
}
UI.closeModal = closeModal;

function modal(opts){
  const layer = document.getElementById('modal-layer');
  layer.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'modal';
  const h = document.createElement('h3');
  h.textContent = opts.title || '';
  box.appendChild(h);
  if (opts.desc){
    const d = document.createElement('div');
    d.className = 'm-desc';
    d.innerHTML = opts.desc;
    box.appendChild(d);
  }
  const body = document.createElement('div');
  body.className = 'm-body';
  if (opts.body) body.appendChild(opts.body);
  box.appendChild(body);
  const acts = document.createElement('div');
  acts.className = 'm-actions';
  (opts.actions || []).forEach(a => {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.cls) b.className = a.cls;
    if (a.disabled) b.disabled = true;
    b.dataset.key = a.key || '';
    b.addEventListener('click', a.onClick);
    acts.appendChild(b);
  });
  box.appendChild(acts);
  layer.appendChild(box);
  layer.classList.add('show');
  return { box, body, actions: acts, setEnabled: (key, on) => {
    const b = acts.querySelector('button[data-key="' + key + '"]');
    if (b) b.disabled = !on;
  }};
}
UI.modal = modal;

/* ---------------- 人类交互入口 ---------------- */
UI.askHuman = function(req){
  return new Promise(resolve => {
    switch (req.kind){
      case 'playPhase':  return askPlayPhase(req, resolve);
      case 'choice':     return askChoice(req, resolve);
      case 'selectCards':return askSelectCards(req, resolve);
      case 'selectTargets': return askTargets(req, resolve);
      case 'selectOption': return askOption(req, resolve);
      default: resolve({});
    }
  });
};

/* ---- 出牌阶段 ---- */
function askPlayPhase(req, resolve){
  playMode = req;
  resolvePlay = resolve;
  UI.render();
}
function canTargetOther(me, target, card, opts){
  // 划水限制
  if (target.marks && target.marks.slideTurn === G.turnId && target.marks.slideFrom === me.seat) return false;
  if (card && CARDS[card.name].tag === 'probe' && E.hasSkill(target, '潜行')) return false;
  if (card && card.name === '课堂辩论' && E.hasSkill(target, '伦理')) return false;
  return true;
}
function onHandCardClick(card){
  const me = G.players[G.humanSeat];
  const meta = CARDS[card.name];
  const kind = meta.kind;

  // 无目标牌
  if (['draw2','harvest','aoeAttack','massHeal','lightning'].includes(kind)){
    const targets = finishAutoTargets(me, card);
    return finishPlay({ type:'card', card, targets });
  }
  if (kind === 'equip') return finishPlay({ type:'card', card, targets: [] });
  if (kind === 'heal' || kind === 'buff') return finishPlay({ type:'card', card, targets: [me] });

  // 需要目标
  let cands = E.validTargets(me, card).filter(t => canTargetOther(me, t, card));
  if (!cands.length){ UI.toast('没有合法目标', 'warn'); return; }
  const isHei = (card.name === '上课点名' && me.equips.weapon && me.equips.weapon.name === '黑板擦' && me.hand.length === 1);
  const maxT = isHei ? 3 : (kind === 'chain' ? 2 : 1);
  const minT = 1;
  const chosen = [];
  const body = document.createElement('div');
  body.className = 'm-targets';
  const m = modal({
    title:'使用 ' + card.name,
    desc: '请选择目标（' + minT + (maxT>minT ? '–' + maxT : '') + ' 名）' + (kind === 'chain' ? '　可横置/重置角色' : ''),
    body,
    actions: [
      { label:'确定', cls:'primary', key:'ok', onClick: () => {
          if (chosen.length < minT) return;
          const tg = chosen.slice();
          closeModal();
          finishPlay({ type:'card', card, targets: tg });
      }},
      { label:'取消', onClick: closeModal }
    ]
  });
  if (kind === 'chain'){
    const b = document.createElement('button');
    b.textContent = '重铸（弃置并摸一张）';
    b.addEventListener('click', () => { closeModal(); finishPlay({ type:'card', card, targets: [], recast:true }); });
    m.actions.insertBefore(b, m.actions.firstChild);
  }
  cands.forEach(t => {
    const pill = document.createElement('div');
    pill.className = 'target-pill';
    pill.innerHTML = t.name + ' <span style="color:#8fa0b5;font-size:12px">' + t.hp + '/' + t.maxHp +
      ' · 距离' + E.distance(me, t) + ' · 手牌' + t.hand.length + '</span>';
    pill.addEventListener('click', () => {
      const i = chosen.indexOf(t);
      if (i >= 0){ chosen.splice(i,1); pill.classList.remove('sel'); }
      else {
        if (chosen.length >= maxT) return;
        chosen.push(t); pill.classList.add('sel');
      }
      m.setEnabled('ok', chosen.length >= minT);
    });
    body.appendChild(pill);
  });
  m.setEnabled('ok', false);
}
function finishAutoTargets(me, card){
  const kind = CARDS[card.name].kind;
  if (kind === 'aoeAttack') return E.others(me);
  if (kind === 'massHeal' || kind === 'harvest') return E.alivePlayers();
  if (kind === 'lightning') return [me];
  if (kind === 'draw2') return [me];
  return [];
}
function finishPlay(action){
  const fn = resolvePlay;
  playMode = null; resolvePlay = null;
  UI.render();
  if (fn) fn({ action });
}
function onSkillClick(skill, targets){
  const me = G.players[G.humanSeat];
  if (skill.eqSkill) return equipSkillFlow(skill, me);
  const need = skill.needTarget;
  if (!need){ return finishPlay({ type:'skill', skill, targets: [] }); }
  const cands = targets.slice();
  const maxT = 1;
  const chosen = [];
  const body = document.createElement('div');
  body.className = 'm-targets';
  const m = modal({
    title:'发动【' + skill.name + '】',
    desc: skill.desc,
    body,
    actions:[
      { label:'确定', cls:'primary', key:'ok', onClick: () => {
          if (chosen.length < 1) return;
          closeModal();
          finishPlay({ type:'skill', skill, targets: chosen.slice() });
      }},
      { label:'取消', onClick: closeModal }
    ]
  });
  m.setEnabled('ok', false);
  cands.forEach(t => {
    const pill = document.createElement('div');
    pill.className = 'target-pill';
    pill.innerHTML = t.name + ' <span style="color:#8fa0b5;font-size:12px">' + t.hp + '/' + t.maxHp +
      ' · 手牌' + t.hand.length + '</span>';
    pill.addEventListener('click', () => {
      if (chosen[0] === t){ chosen.pop(); pill.classList.remove('sel'); }
      else { body.querySelectorAll('.target-pill').forEach(x=>x.classList.remove('sel'));
             chosen[0] = t; pill.classList.add('sel'); }
      m.setEnabled('ok', chosen.length >= 1);
    });
    body.appendChild(pill);
  });
}

/* ---- 武器转化技：电风扇 / 粉笔 ---- */
async function equipSkillFlow(skill, me){
  let cost = [], asName = '上课点名', dmg = 'normal', suit = 'C', rank = 8;
  if (skill.name === '电风扇·转化'){
    const r = await UI.askHuman({ kind:'selectCards', player:me, from:'self', min:1, max:1,
      prompt:'【电风扇】选择一张"上课点名"当"公开处刑"使用', filter:c => c.name === '上课点名' });
    if (!r.cards || !r.cards.length) return;
    cost = [r.cards[0]]; asName = '公开处刑'; dmg = 'fire';
    suit = r.cards[0].suit; rank = r.cards[0].rank;
  } else {
    const r = await UI.askHuman({ kind:'selectCards', player:me, from:'self', min:2, max:2,
      prompt:'【粉笔】选择两张手牌当作一张"上课点名"' });
    if (!r.cards || r.cards.length < 2) return;
    cost = r.cards.slice(); asName = '上课点名'; dmg = 'normal';
    suit = cost[0].suit; rank = cost[0].rank;
  }
  const cands = E.validTargets(me, { name: asName, kind:'attack' });
  if (!cands.length){ UI.toast('没有合法目标', 'warn'); return; }
  const t = await UI.askHuman({ kind:'selectTargets', player:me, targets:cands, min:1, max:1,
    prompt:'选择目标（' + asName + '）' });
  if (!t.targets || !t.targets.length) return;
  finishPlay({ type:'virtual', cost, asName, dmg, suit, rank, targets:t.targets });
}

/* ---- 选项 ---- */
function askChoice(req, resolve){
  modal({
    title: req.player ? '「' + req.player.name + '」的决策' : '请选择',
    desc: req.prompt,
    actions: (req.options || []).map(o => ({
      label: o.label, cls: o.key === 'yes' || o.key === 'card' ? 'primary' : '',
      onClick: () => { closeModal(); resolve({ option: o.key }); }
    }))
  });
}
/* ---- 选牌 ---- */
function askSelectCards(req, resolve){
  let pool;
  if (req.cards) pool = req.cards.slice();
  else {
    const me = G.players[G.humanSeat];
    if (req.from === 'any'){
      pool = me.hand.concat(['weapon','armor','mount'].map(k => me.equips[k]).filter(Boolean));
    } else pool = me.hand.slice();
  }
  if (req.filter) pool = pool.filter(req.filter);
  if (!pool.length){ resolve({ cards: [] }); return; }
  const min = req.min || 0, max = req.max || 1;
  const chosen = [];
  const body = document.createElement('div');
  body.className = 'm-cards';
  const owner = req.owner ? req.owner.name + ' 的' : '你的';
  const m = modal({
    title: (req.player ? '「' + req.player.name + '」· ' : '') + (req.prompt || '选择卡牌'),
    desc: '选择 ' + min + (max > min ? '–' + max : '') + ' 张' + owner + '牌',
    body,
    actions:[
      { label:'确定', cls:'primary', key:'ok', onClick: () => {
          closeModal(); resolve({ cards: chosen.slice() });
      }},
      { label:'取消', onClick: () => { closeModal(); resolve({ cards: [] }); } }
    ]
  });
  pool.forEach(c => {
    const el = cardEl(c, { onClick: (card, div) => {
      const i = chosen.indexOf(card);
      if (i >= 0){ chosen.splice(i,1); div.classList.remove('sel'); }
      else {
        if (chosen.length >= max) return;
        chosen.push(card); div.classList.add('sel');
      }
      m.setEnabled('ok', chosen.length >= min && chosen.length <= max);
    }});
    body.appendChild(el);
  });
  m.setEnabled('ok', min === 0);
}

/* ---- 选目标 ---- */
function askTargets(req, resolve){
  const chosen = [];
  const min = req.min || 1, max = req.max || 1;
  const body = document.createElement('div');
  body.className = 'm-targets';
  const m = modal({
    title: (req.player ? '「' + req.player.name + '」· ' : '') + (req.prompt || '选择目标'),
    body,
    actions:[
      { label:'确定', cls:'primary', key:'ok', onClick: () => { closeModal(); resolve({ targets: chosen.slice() }); }},
      { label:'取消', onClick: () => { closeModal(); resolve({ targets: [] }); } }
    ]
  });
  (req.targets || []).forEach(t => {
    const pill = document.createElement('div');
    pill.className = 'target-pill';
    pill.textContent = t.name + '（' + t.hp + '/' + t.maxHp + '）';
    pill.addEventListener('click', () => {
      const i = chosen.indexOf(t);
      if (i >= 0){ chosen.splice(i,1); pill.classList.remove('sel'); }
      else { if (chosen.length >= max) return; chosen.push(t); pill.classList.add('sel'); }
      m.setEnabled('ok', chosen.length >= min);
    });
    body.appendChild(pill);
  });
  m.setEnabled('ok', false);
}

/* ---- 长列表选项（吹牛） ---- */
function askOption(req, resolve){
  const body = document.createElement('div');
  body.className = 'm-cards';
  modal({
    title: (req.player ? '「' + req.player.name + '」· ' : '') + (req.prompt || '请选择'),
    body,
    actions:[{ label:'取消', onClick: () => { closeModal(); resolve({ option: null }); } }]
  });
  (req.options || []).forEach(o => {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.style.minWidth = '104px';
    b.addEventListener('click', () => { closeModal(); resolve({ option: o.key }); });
    body.appendChild(b);
  });
}

/* ---------------- 查考勤展示 ---------------- */
UI.showJudge = function(card, jc){
  const layer = document.getElementById('modal-layer');
  if (!layer) return;
  layer.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'modal';
  const red = D.isRedCard(jc);
  box.innerHTML = '<h3>查考勤</h3>' +
    '<div class="m-desc">' + card.name + ' → 抽签牌</div>' +
    '<div style="display:flex;gap:14px;align-items:center;justify-content:center;padding:6px 0">' +
    '<div style="font-size:40px;font-weight:bold;color:' + (red ? '#e05a5a' : '#dfe6f0') + '">' +
    D.rankLabel(jc.rank) + D.suitOf(jc).sym + '</div>' +
    '<div style="font-size:15px;color:#9aa8bb">' + jc.name + '</div></div>';
  layer.appendChild(box);
  layer.classList.add('show');
  const wait = 900 * (G.speed || 1);
  setTimeout(() => { if (layer.contains(box)) closeModal(); }, wait);
};

/* ---------------- 结束界面 ---------------- */
UI.showOver = function(winner, reason, humanWin){
  const title = document.getElementById('over-title');
  const body = document.getElementById('over-body');
  title.textContent = humanWin ? '你赢了' : (winner ? '你输了' : '平局');
  title.style.color = humanWin ? '#5ac47e' : '#e05a5a';
  let html = '<div class="ov-line">' + (winner ? D.IDENTITIES[winner].name + '阵营胜利' : '平局') + '　<span style="color:#8fa0b5">（' + reason + '）</span></div>';
  html += '<div class="ov-line" style="margin-top:14px;color:#8fa0b5">身份揭示</div>';
  G.players.forEach(p => {
    const id = D.IDENTITIES[p.identity];
    const me = p.seat === G.humanSeat;
    const win = (winner === 'dean' && (p.identity === 'dean' || p.identity === 'staff')) ||
                (winner === 'student' && p.identity === 'student') ||
                (winner === 'mole' && p.identity === 'mole');
    html += '<div class="ov-line' + (win ? ' ov-win' : '') + '">' +
      (p.seat+1) + ' 号位　' + p.char.name + '（' + p.char.title + '）　' +
      '<b>' + id.name + '</b>　' + (p.alive ? '存活' : '死亡') + (me ? '　← 你' : '') + (win ? '　✔ 胜利' : '') + '</div>';
  });
  body.innerHTML = html;
  UI.show('over');
};

/* ---------------- 顶部按钮 ---------------- */
UI.bindTopbar = function(){
  const ab = document.getElementById('btn-advance');
  if (ab && window.FX){
    ab.textContent = FX.manualAdvance ? '⏸ 点击清空' : '▶ 自动清空';
    ab.addEventListener('click', () => {
      const m = FX.setAdvance(!FX.manualAdvance);
      ab.textContent = m ? '⏸ 点击清空' : '▶ 自动清空';
      UI.toast(m ? '出牌区：一次连锁结束后等你点击再清空' : '出牌区：一次连锁结束后自动清空', '');
    });
  }
  const sb = document.getElementById('btn-sound');
  if (sb && window.FX){
    sb.textContent = FX.soundOn() ? '🔊 音效' : '🔇 静音';
    sb.addEventListener('click', () => {
      const on = FX.toggleSound();
      sb.textContent = on ? '🔊 音效' : '🔇 静音';
    });
  }
  document.getElementById('btn-log-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('hide');
  });
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log').innerHTML = '';
  });
  const sp = document.getElementById('btn-speed');
  const speedLabel = v => v >= 1.9 ? '很慢' : v >= 1.2 ? '标准' : v >= 0.5 ? '快' : '极速';
  sp.textContent = '节奏：' + speedLabel(G.speed);
  sp.addEventListener('click', () => {
    const modes = [{k:1.35,l:'标准'},{k:1.9,l:'很慢'},{k:0.6,l:'快'},{k:0.15,l:'极速'}];
    const i = modes.findIndex(m => Math.abs(m.k - G.speed) < 0.01);
    const next = modes[(i+1) % modes.length];
    G.speed = next.k;
    sp.textContent = '节奏：' + next.l;
    UI.toast('节奏：' + next.l + '（数值 ' + next.k + '×）', '');
  });
  document.getElementById('btn-rule-panel').addEventListener('click', showRules);
};

function showRules(){
  modal({
    title:'规则速查',
    desc:
      '<b>回合六步：</b>回合开始 → 查考勤 → 摸 2 张 → 出牌 → 弃到体力上限 → 结束<br>' +
      '<b>出牌限制：</b>点名类（上课点名/公开处刑/雷同警告）合计 1 张/回合；延时事件牌 1 张/回合；主动技各 1 次<br>' +
      '<b>距离：</b>相邻为 1；+1 坐骑让别人看你 +1；-1 坐骑让你看别人 -1；最小为 1<br>' +
      '<b>攻击范围：</b>无武器 = 1；由武器牌上的数字决定<br>' +
      '<b>响应链：</b>点名牌 → 代课（抵消）→ 辅导员签字（抵消事件牌）<br>' +
      '<b>判定：</b>翻开牌堆顶作为抽签牌；♥♦ = 红色，♠♣ = 黑色<br>' +
      '<b>濒死：</b>体力 ≤ 0 → 本人先自救 → 从当前回合角色起轮流救援 → 救不回则死亡<br>' +
      '<b>死亡奖惩：</b>杀学生者摸 3 张；院长杀教务 → 院长弃光所有牌<br>' +
      '<b>胜负：</b>学生与卧底全灭且院长存活 = 院方胜；院长死亡 = 学生胜（若仅剩卧底一人则卧底胜）<br>' +
      '<b>手牌上限 = 当前体力</b>（波比【体能】+1）',
    actions:[
      { label:'运行自检', onClick: () => { closeModal(); if (window.runSelfTest) window.runSelfTest(); } },
      { label:'知道了', cls:'primary', onClick: closeModal }
    ]
  });
}

/* 目标点击（仅用于高亮提示，本作目标选择走弹窗） */
function onTargetClick(p, el){ /* 预留：点击对手面板查看详情 */ }

UI.showRules = showRules;

/* 横向座位队列由 CSS flex 自动换行，不需要 JS 摆位 */
})();
