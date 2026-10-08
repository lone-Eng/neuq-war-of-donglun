/* =========================================================
 *  东秦杀：点名册  ·  启动与流程编排
 * ========================================================= */
(function(){
'use strict';
const D = window.GameData;
const E = window.Engine;

const cfg = { count:5, mode:'A', deal:3, protect:true, ai:true, fast:false };

/* ---------------- 开始界面 ---------------- */
function bindStartScreen(){
  document.querySelectorAll('#pick-count button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#pick-count button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cfg.count = +b.dataset.count; renderPreview();
    });
  });
  document.querySelectorAll('#pick-mode button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#pick-mode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cfg.mode = b.dataset.mode;
    });
  });
  document.querySelectorAll('#pick-deal button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#pick-deal button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cfg.deal = +b.dataset.deal;
    });
  });
  document.querySelectorAll('#pick-opt button').forEach(b => {
    b.addEventListener('click', () => {
      b.classList.toggle('on');
      const k = b.dataset.opt;
      cfg[k] = b.classList.contains('on');
    });
  });
  document.getElementById('btn-start').addEventListener('click', startSetup);
  document.getElementById('btn-rules').addEventListener('click', () => window.UI.showRules());
  document.getElementById('btn-again').addEventListener('click', () => {
    window.UI.closeModal();
    window.UI.show('start');
  });
  renderPreview();
}

function renderPreview(){
  const conf = D.IDENTITY_CONFIG[cfg.count];
  const box = document.getElementById('identity-preview');
  let html = '';
  for (const k of ['dean','staff','student','mole']){
    if (!conf[k]) continue;
    const id = D.IDENTITIES[k];
    html += '<span class="id-chip ' + id.cls + '">' + id.name + ' ×' + conf[k] + '　<span style="opacity:.7">' + id.win + '</span></span>';
  }
  box.innerHTML = html;
}

/* ---------------- 开局：发身份 → 选角 ---------------- */
function startSetup(){
  // 清掉上一局可能残留的中央提示层（先触发一次点击，让上一局的等待正常结束）
  const fxLayer = document.getElementById('fx-layer');
  if (fxLayer){
    const blocking = fxLayer.querySelector('.fx-overlay.blocking');
    if (blocking) blocking.click();
    fxLayer.innerHTML = '';
  }
  E.initGame({
    count: cfg.count, mode: cfg.mode, deal: cfg.deal, aiOthers: cfg.ai,
    protect: cfg.protect, hotseat: !cfg.ai, networkRule:false
  });
  const me = G.players[G.humanSeat];
  // 选角界面
  const idBox = document.getElementById('my-identity-card');
  const id = D.IDENTITIES[me.identity];
  idBox.className = 'identity-card ' + id.cls;
  idBox.innerHTML = '<div class="big-word">' + id.name + '</div>' +
    '<div class="sub">阵营：' + id.faction + '　|　胜利条件：' + id.win + '</div>' +
    '<div class="sub">' + id.desc + '</div>';
  const box = document.getElementById('role-options');
  box.innerHTML = '';
  const actualDeal = (window.G && G.dealPer) ? G.dealPer : me.charChoices.length;
  const oldNote = box.parentNode.querySelector('.deal-note');
  if (oldNote) oldNote.remove();
  const tie = document.createElement('div');
  tie.className = 'hint deal-note';
  tie.textContent = '你从 ' + actualDeal + ' 名武将中选 1 名；其余 ' + (cfg.count - 1) +
    ' 名电脑会从剩下的 ' + (D.CHARACTERS.length - actualDeal) + ' 名里挑选（同一局不会出现重复武将）';
  box.parentNode.insertBefore(tie, box);
  me.charChoices.forEach(c => {
    const el = document.createElement('div');
    el.className = 'role-card';
    el.innerHTML = '<div class="rc-name">' + c.name + '</div>' +
      '<div class="rc-title">' + c.title + '</div>' +
      '<div class="rc-hp">体力上限 ' + c.hp + (me.identity === 'dean' ? '（院长 +1 → ' + (c.hp+1) + '）' : '') + '</div>' +
      c.skills.map(s => '<div class="rc-skill"><b>【' + s.name + '】</b>' + s.type + '：' + s.text + '</div>').join('');
    el.addEventListener('click', () => pickRole(c));
    box.appendChild(el);
  });
  window.UI.show('role');
}

function aiPickChar(p, taken, pool){
  // 电脑从"剩余武将池"里挑选；已被选走的角色不再进入候选
  const src = (pool && pool.length) ? pool : D.CHARACTERS;
  let list = src.filter(c => !taken || !taken.has(c.id));
  if (!list.length) list = D.CHARACTERS.filter(c => !taken || !taken.has(c.id));
  if (!list.length) list = D.CHARACTERS.slice();
  if (!list.length) return D.CHARACTERS[0];
  let best = list[0], bestScore = -1;
  for (const c of list){
    let s = c.hp * 12 + Math.random() * 22;
    if (p.identity === 'dean') s += c.hp * 7;
    if (p.identity === 'staff') s += (c.skills.some(k => /回复|救援/.test(k.text)) ? 14 : 0);
    if (p.identity === 'student') s += (c.skills.some(k => /伤害|造成/.test(k.text)) ? 14 : 0);
    if (p.identity === 'mole') s += (c.hp >= 4 ? 10 : 0);
    if (s > bestScore){ bestScore = s; best = c; }
  }
  return best;
}

function pickRole(c){
  const me = G.players[G.humanSeat];
  me.char = c;
  const taken = new Set([c.id]);
  // 你没选走的那几张候选回归武将池，电脑再从剩下的里挑
  const pool = (G.charRest || []).slice();
  (me.charChoices || []).forEach(x => { if (!taken.has(x.id)) pool.push(x); });
  G.players.forEach(p => {
    if (p.seat === G.humanSeat) return;
    const pick = aiPickChar(p, taken, pool);
    taken.add(pick.id);
    p.char = pick;
  });
  // 兜底校验：绝不允许两个座位拿到同一个角色
  const ids = G.players.map(p => p.char && p.char.id);
  if (new Set(ids).size !== ids.length){
    const used = new Set();
    G.players.forEach(p => {
      if (!p.char || used.has(p.char.id)){
        const alt = D.CHARACTERS.find(x => !used.has(x.id));
        if (alt) p.char = alt;
      }
      used.add(p.char.id);
    });
    E.log('⚠ 检测到重复角色，已自动替换为不同角色', 'dmg');
  }
  // 热座模式：所有座位均由玩家操作
  if (G.opts.hotseat) G.players.forEach(p => { p.isHuman = true; });
  E.finalizeGame();
  dealInitialHands();
  window.UI.show('game');
  window.UI.render();
  logOpening();
  gameStart();
}

function dealInitialHands(){
  for (const p of G.players){
    let n = 4;
    if (p.identity === 'dean') n = 5;
    if (G.players.length === 4 && p.identity === 'student') n = 5;   // 4 人局学生补偿
    for (let i=0;i<n;i++){
      const c = G.deck.pop();
      if (c) p.hand.push(c);
    }
  }
}

function logOpening(){
  const conf = D.IDENTITY_CONFIG[G.players.length];
  E.logBig('东秦杀：点名册　' + G.players.length + ' 人局');
  E.log('身份配置：院长 ' + conf.dean + '、教务 ' + conf.staff + '、学生 ' + conf.student + '、卧底 ' + conf.mole, 'sys');
  const dean = G.players.find(p => p.identity === 'dean');
  E.log('院长是 ' + (dean.seat+1) + ' 号位 ' + dean.char.name + '（身份公开，体力上限 +1）', 'sys');
  const me = G.players[G.humanSeat];
  E.log('你是 ' + (me.seat+1) + ' 号位 ' + me.char.name + '，身份【' + D.IDENTITIES[me.identity].name + '】', 'big');
  if (G.opts.protect) E.log('已启用保护轮：第一圈内无人死亡', 'sys');
}

async function gameStart(){
  // 保护轮由引擎的伤害结算入口统一钳制（见 engine.js damage()）
  await E.gameLoop();
}

/* ---------------- 全局错误提示（便于排查） ---------------- */
function reportError(msg, where){
  try { window.UI.toast('运行错误：' + msg + '（' + where + '）', 'warn'); } catch (_) {}
  try { window.Engine.log('❌ 运行错误：' + msg + ' @ ' + where, 'dmg'); } catch (_) {}
}
window.addEventListener('error', e => {
  const msg = (e && e.message) ? e.message : '未知错误';
  const where = (e && e.filename ? e.filename.split('/').pop() : '') + (e && e.lineno ? ':' + e.lineno : '');
  reportError(msg, where);
});
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  reportError((r && (r.message || r)) || '未处理的异步错误', 'Promise');
});

document.addEventListener('DOMContentLoaded', () => {
  try {
    bindStartScreen();
    window.UI.bindTopbar();
    window.UI.show('start');
  } catch (err){
    document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;left:20px;bottom:20px;z-index:999;color:#f0a0a0;background:#2a1414;' +
      'border:1px solid #8a4a4a;padding:10px 14px;border-radius:8px;font-size:13px">' +
      '初始化失败：' + (err && err.message) + '</div>');
  }
});
})();
