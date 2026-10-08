/* =========================================================
 *  东秦杀：点名册  ·  规则引擎
 *  实现规则书 v1.0：六阶段回合 / 距离与攻击范围 / 装备 /
 *  判定（查考勤）/ 濒死救援 / 死亡奖惩 / 身份胜负 / 40 个技能
 * ========================================================= */
(function(){
'use strict';

const D = window.GameData;
const { CARDS, IDENTITIES, PROBE_CARDS } = D;

/* ---------------- 全局状态 ---------------- */
const G = {
  players: [], deck: [], discard: [], turnSeat: 0, round: 1, turnId: 0,
  phase: '', over: false, humanSeat: 0, opts: {}, log: [], startSeat: 0,
  speed: 1.35, firstRound: true, roundDone: new Set(), harmLog: []
};
window.G = G;

/* ---------------- 工具 ---------------- */
function sleep(ms){ return new Promise(r => setTimeout(r, Math.max(0, ms * (G.speed||1)))); }
function log(text, cls){
  G.log.push({ text, cls });
  if (window.UI && UI.pushLog) UI.pushLog(text, cls);
}
function logBig(t){ log(t, 'big'); }
function toast(t, cls){ if (window.UI && UI.toast) UI.toast(t, cls); }
function rand(n){ return Math.floor(Math.random()*n); }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=rand(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function pickRandom(a){ return a.length ? a[rand(a.length)] : null; }
function alivePlayers(){ return G.players.filter(p => p.alive); }
function others(p){ return G.players.filter(x => x.alive && x !== p); }

/** 从 seat 开始按座位顺序的存活角色序列 */
function orderFrom(seat){
  const list = [];
  for (let i=0;i<G.players.length;i++){
    const p = G.players[(seat+i) % G.players.length];
    if (p.alive) list.push(p);
  }
  return list;
}
function curTurnPlayer(){ return G.players[G.turnSeat]; }

/* ---------------- 技能判定 ---------------- */
function hasSkill(p, name){ return p.char && p.char.skills.some(s => s.name === name); }
function skillUsed(p, name){ return p.skillsUsedThisTurn && p.skillsUsedThisTurn[name]; }
function markSkillUsed(p, name){ p.skillsUsedThisTurn[name] = true; }

/* ---------------- 距离与范围 ---------------- */
function distance(a, b){
  if (a === b) return 0;
  const alive = alivePlayers();
  if (!a.alive || !b.alive) return 99;
  const n = alive.length;
  const ia = alive.indexOf(a), ib = alive.indexOf(b);
  let d = Math.abs(ia - ib);
  d = Math.min(d, n - d);
  if (d < 1) d = 1;
  const bMount = b.equips.mount;
  if (bMount && CARDS[bMount.name].mount === '+1') d++;
  if (hasSkill(b, '震慑')) d++;
  const aMount = a.equips.mount;
  if (aMount && CARDS[aMount.name].mount === '-1') d--;
  if (hasSkill(a, '观鸟')) d--;
  if (hasSkill(a, '极限')) return 1;   // 最终值锁定
  return Math.max(1, d);
}
function attackRange(p){
  return p.equips.weapon ? CARDS[p.equips.weapon.name].range : 1;
}
function inAttackRange(a, b){ return distance(a, b) <= attackRange(a); }
function handLimit(p){
  let n = Math.max(0, p.hp);
  if (hasSkill(p, '体能')) n++;
  return n;
}

/* ---------------- 牌堆 ---------------- */
function drawFromDeck(){
  if (G.deck.length === 0){
    if (G.discard.length === 0) return null;
    G.deck = shuffle(G.discard.splice(0));
    log('牌堆用尽，弃牌堆洗入牌堆（' + G.deck.length + ' 张）', 'sys');
    if (G.opts.networkRule){   // 可选规则：网络波动
      const maxHand = Math.max(...alivePlayers().map(p => p.hand.length));
      alivePlayers().filter(p => p.hand.length === maxHand).forEach(p => {
        p.marks.net = (p.marks.net || 0) + 1;
        log(p.name + ' 因网络波动获得【宿舍断网】标记', 'sys');
      });
    }
  }
  return G.deck.pop();
}
function toDiscard(cards){ (Array.isArray(cards) ? cards : [cards]).forEach(c => { if (c) G.discard.push(c); }); }

/** 摸牌（会触发"摸牌后"类技能：董昌程【设局】） */
async function drawCards(p, n, reason){
  const drawn = [];
  for (let i=0;i<n;i++){
    const c = drawFromDeck();
    if (!c) break;
    p.hand.push(c); drawn.push(c);
  }
  if (drawn.length){
    if (window.FX && window.G && G.speed > 0.3) FX.sfx('draw');
    if (window.FX) FX.floatText(p.seat, '+' + drawn.length + ' 张', 'draw');
    log(p.name + ' 摸了 ' + drawn.length + ' 张牌' + (reason ? '（' + reason + '）' : ''), '');
    if (p.isHuman && G.opts.showMyDraws) drawn.forEach(c => toast('摸到：' + cardText(c), ''));
  }
  if (drawn.length){
    await sleep(300);          // 摸牌也留出看清的时间
    await triggerAfterDraw(p);
  }
  return drawn;
}
/** 董昌程【设局】：一名角色摸牌后可令其跳过出牌阶段 */
async function triggerAfterDraw(who){
  for (const p of orderFrom(G.turnSeat)){
    if (!p.alive || p === who) continue;
    if (!hasSkill(p, '设局')) continue;
    if (skillUsed(p, '设局')) continue;
    if (who.skip.play) continue;
    if (p.hand.length === 0) continue;
    const r = await Ask(p, {
      kind:'choice', prompt:'【设局】' + who.name + ' 刚刚摸了牌，是否弃一张牌令其跳过出牌阶段？',
      options:[{key:'yes', label:'发动（弃一张牌）'}, {key:'no', label:'放弃'}], skillBlock:true
    });
    if (r.option === 'yes'){
      const sel = await Ask(p, { kind:'selectCards', prompt:'【设局】弃置一张牌', from:'self', min:1, max:1 });
      if (sel.cards && sel.cards.length){
        discardFromHand(p, sel.cards);
        markSkillUsed(p, '设局');
        who.skip.play = true;
        log(p.name + ' 发动【设局】，' + who.name + ' 本回合跳过出牌阶段', 'sys');
      }
    }
    break;
  }
}

/* ---------------- 手牌操作 ---------------- */
function removeFromHand(p, cards){
  cards.forEach(c => { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i,1); });
}
function discardFromHand(p, cards){
  removeFromHand(p, cards);
  toDiscard(cards);
  log(p.name + ' 弃置了 ' + cards.map(cardText).join('、'), '');
}
/** 从区域内取牌（手牌随机、装备/通知栏指定） */
function removeFromZone(p, card){
  let i = p.hand.indexOf(card);
  if (i >= 0){ p.hand.splice(i,1); return; }
  for (const k of ['weapon','armor','mount']){
    if (p.equips[k] === card){
      const lost = p.equips[k]; p.equips[k] = null;
      if (lost.name === '医保卡') { /* 失去医保卡回复 → 由调用方处理 */ }
      return;
    }
  }
  i = p.judge.indexOf(card);
  if (i >= 0){ p.judge.splice(i,1); return; }
}
function allZoneCards(p){
  const arr = [];
  p.hand.forEach(c => arr.push({card:c, zone:'hand'}));
  for (const k of ['weapon','armor','mount']) if (p.equips[k]) arr.push({card:p.equips[k], zone:'equip'});
  p.judge.forEach(c => arr.push({card:c, zone:'judge'}));
  return arr;
}
function canBeHandTargeted(p){ return !hasSkill(p, '加密'); }

/* ---------------- 伤害与体力 ---------------- */
async function damage(target, amount, source, type, opts){
  opts = opts || {};
  if (!target.alive || amount <= 0) return 0;
  type = type || 'normal';
  let dmg = amount;
  const bonus = [];
  // 雨衣：受到火焰伤害 +1
  if (type === 'fire' && target.equips.armor && target.equips.armor.name === '雨衣' && !opts.ignoreArmor){
    dmg++; bonus.push('雨衣 +1');
  }
  // 医保卡：伤害大于 1 时防止多余伤害
  if (target.equips.armor && target.equips.armor.name === '医保卡' && !opts.ignoreArmor && dmg > 1){
    dmg = 1; bonus.push('医保卡封顶');
  }
  const reductions = [];
  // 周志远【正义】
  if (hasSkill(target, '正义') && source && source.hand.length > target.hand.length){ dmg--; reductions.push('正义 -1'); }
  // 肾小球【过滤】非属性伤害 -1
  if (hasSkill(target, '过滤') && type === 'normal'){ dmg--; reductions.push('过滤 -1'); }
  // 董启龙【兄弟】：其他角色受伤时弃一张牌令伤害-1
  for (const p of orderFrom(G.turnSeat)){
    if (!p.alive || p === target) continue;
    if (!hasSkill(p, '兄弟') || skillUsed(p, '兄弟')) continue;
    if (dmg <= 0) break;
    if (p.hand.length === 0) continue;
    const r = await Ask(p, { kind:'choice', prompt:'【兄弟】' + target.name + ' 即将受到 ' + dmg + ' 点伤害，是否弃一张牌令伤害-1？',
      options:[{key:'yes',label:'发动（弃一张牌）'},{key:'no',label:'放弃'}], skillBlock:true });
    if (r.option === 'yes'){
      const sel = await Ask(p, { kind:'selectCards', prompt:'【兄弟】弃置一张牌', from:'self', min:1, max:1 });
      if (sel.cards && sel.cards.length){
        discardFromHand(p, sel.cards); markSkillUsed(p, '兄弟');
        dmg--; reductions.push('兄弟 -1');
      }
    }
    break;
  }
  if (dmg <= 0){
    log(target.name + ' 的此次伤害被完全减免（' + reductions.concat(bonus).join('，') + '）', 'sys');
    return 0;
  }
  // 可选规则：保护轮（第一圈内体力不会降到 1 以下）
  if (G.opts.protect && G.round === 1 && !opts.ignoreProtect){
    const cap = Math.max(0, target.hp - 1);
    if (dmg > cap){
      dmg = cap;
      if (dmg <= 0){ log('保护轮：' + target.name + ' 的体力被锁定在 1 点，本次伤害不成立', 'sys'); return 0; }
      log('保护轮：伤害被限制为 ' + dmg + ' 点（第一圈不死亡）', 'sys');
    }
  }
  target.hp -= dmg;
  if (window.FX){
    FX.floatText(target.seat, '-' + dmg, dmg >= 2 ? 'dmg big' : 'dmg');
    FX.shake(target.seat, dmg >= 2);
    FX.sfx(dmg >= 3 ? 'bigHurt' : 'damage');
    if (dmg >= 3) FX.flash('red');
  }
  log(target.name + ' 受到 ' + dmg + ' 点' + dmgTypeName(type) + '伤害' + (source ? '（来源：' + source.name + '）' : '（无来源）')
      + (bonus.length ? ' [' + bonus.join('，') + ']' : '') + (reductions.length ? ' [' + reductions.join('，') + ']' : ''), 'dmg');
  if (window.UI) UI.render();
  await sleep(520);          // 伤害结算后停顿，让人看清数值与来源
  if (source && source !== target){
    if (source.alive) source.damageDealtThisTurn = (source.damageDealtThisTurn||0) + dmg;
    G.harmLog.push({ s: source.seat, t: target.seat, a: dmg, type: type });
  }

  // 濒死
  if (target.hp <= 0){
    const survived = await enterDying(target, source);
    if (!survived) return dmg;
  }
  // 横置传导（仅属性伤害）
  if (type === 'fire' || type === 'thunder') await chainConduct(target, dmg, source, type);
  return dmg;
}
function dmgTypeName(t){ return t === 'fire' ? '火焰' : t === 'thunder' ? '雷电' : t === 'true' ? '真实' : '普通'; }

async function chainConduct(target, amount, source, type){
  if (!target.chained) return;
  target.chained = false;
  const others = alivePlayers().filter(p => p !== target && p.chained);
  if (!others.length){ log(target.name + ' 的横置状态被属性伤害解除（无传导目标）', 'sys'); return; }
  log(target.name + ' 受到属性伤害，横置解除并向 ' + others.map(o=>o.name).join('、') + ' 传导 ' + amount + ' 点' + dmgTypeName(type) + '伤害', 'sys');
  for (const o of others){
    o.chained = false;
    await damage(o, amount, source, type, { noChain:true });
  }
}

async function heal(target, amount, reason){
  if (!target.alive) return;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  if (target.hp > before){
    log(target.name + ' 回复 ' + (target.hp - before) + ' 点体力（' + target.hp + '/' + target.maxHp + '）', 'heal');
    if (window.FX){ FX.floatText(target.seat, '+' + (target.hp - before), 'heal'); FX.sfx('heal'); }
  }
  if (window.UI) UI.render();
  await sleep(380);
}

/** 濒死与救援：返回 true 表示存活 */
async function enterDying(p, source){
  logBig('⚠ ' + p.name + ' 进入濒死状态（体力 ' + p.hp + '）');
  if (window.UI) UI.render();
  await sleep(300);

  // 第 0 步：本人自救
  await rescueLoop(p, p, true);
  if (p.hp > 0){ log(p.name + ' 自救成功，脱离濒死', 'heal'); return true; }

  // 第 1 步：从当前回合角色开始按座位顺序求援
  const order = orderFrom(G.turnSeat).filter(x => x !== p);
  for (const helper of order){
    if (p.hp > 0) break;
    if (!helper.alive) continue;
    await rescueLoop(p, helper, false);
  }
  // 第 2 步：追加窗口
  if (p.hp <= 0){
    for (const helper of order){
      if (p.hp > 0) break;
      if (!helper.alive) continue;
      const r = await Ask(helper, { kind:'choice', prompt:p.name + ' 仍在濒死，是否追加救援？',
        options:[{key:'yes',label:'追加救援'},{key:'no',label:'放弃'}] });
      if (r.option === 'yes') await rescueLoop(p, helper, false);
    }
  }
  if (p.hp > 0){ log(p.name + ' 被救回，脱离濒死', 'heal'); return true; }
  // 第 3 步：死亡
  await killPlayer(p, source);
  return false;
}

/** helper 为濒死者提供救援：isSelf 表示本人自救 */
async function rescueLoop(dying, helper, isSelf){
  while (dying.hp <= 0 && dying.alive){
    const options = [];
    const healCards = helper.hand.filter(c => CARDS[c.name].kind === 'heal' || CARDS[c.name].kind === 'buff');
    if (isSelf || true){
      if (healCards.length) options.push({key:'card', label:'使用请假条/红牛（回复1点）'});
    }
    if (hasSkill(helper,'鼓励') && helper.hand.length > 0 && dying.hp <= 0){
      options.push({key:'skill1', label:'发动【鼓励】（弃一张手牌，回复1点）'});
    }
    if (!options.length){
      if (isSelf) return;
      return;
    }
    if (!isSelf){
      // 询问是否救援
      const pre = await Ask(helper, { kind:'choice',
        prompt:'是否救援 ' + dying.name + '？（其体力 ' + dying.hp + '）',
        options: options.concat([{key:'no', label:'不救'}]).map(o => ({key:o.key, label:o.label})) });
      if (pre.option === 'no') return;
      if (pre.option === 'skill1'){
        const sel = await Ask(helper, { kind:'selectCards', prompt:'【鼓励】弃置一张手牌', from:'self', min:1, max:1 });
        if (sel.cards && sel.cards.length){ discardFromHand(helper, sel.cards); await heal(dying, 1, '鼓励'); }
        continue;
      }
      const sel = await Ask(helper, { kind:'selectCards', prompt:'使用一张回复牌救 ' + dying.name,
        from:'self', min:1, max:1, filter:c => CARDS[c.name].kind === 'heal' || CARDS[c.name].kind === 'buff' });
      if (!sel.cards || !sel.cards.length) return;
      removeFromHand(helper, sel.cards); toDiscard(sel.cards);
      log(helper.name + ' 使用 ' + cardText(sel.cards[0]) + ' 救援 ' + dying.name, 'heal');
      await heal(dying, 1, 'rescue');
      continue;
    }
    // 本人自救
    const isHeal = healCards.length > 0;
    if (!isHeal && !(hasSkill(helper,'鼓励') && helper.hand.length > 0)) return;
    const opts = [];
    if (isHeal) opts.push({key:'card', label:'使用请假条/红牛自救'});
    if (hasSkill(helper,'鼓励') && helper.hand.length > 0) opts.push({key:'skill1', label:'发动【鼓励】自救（弃一张手牌）'});
    opts.push({key:'no', label:'放弃自救'});
    const r = await Ask(helper, { kind:'choice', prompt:'你正处于濒死（体力 ' + dying.hp + '），是否自救？', options:opts });
    if (r.option === 'no') return;
    if (r.option === 'skill1'){
      const sel = await Ask(helper, { kind:'selectCards', prompt:'【鼓励】弃置一张手牌', from:'self', min:1, max:1 });
      if (sel.cards && sel.cards.length){ discardFromHand(helper, sel.cards); await heal(dying, 1, '鼓励'); }
      continue;
    }
    const sel = await Ask(helper, { kind:'selectCards', prompt:'使用一张回复牌自救',
      from:'self', min:1, max:1, filter:c => CARDS[c.name].kind === 'heal' || CARDS[c.name].kind === 'buff' });
    if (!sel.cards || !sel.cards.length) return;
    removeFromHand(helper, sel.cards); toDiscard(sel.cards);
    log(helper.name + ' 使用 ' + cardText(sel.cards[0]) + ' 自救', 'heal');
    await heal(dying, 1, 'rescue');
  }
}

/* ---------------- 死亡与胜负 ---------------- */
async function killPlayer(p, source){
  p.alive = false;
  p.revealed = true;
  logBig('☠ ' + p.name + ' 死亡，身份揭示：' + IDENTITIES[p.identity].name);
  if (window.FX) await FX.death(p);
  // 牌全部进弃牌堆
  const cards = p.hand.splice(0).concat(
    ['weapon','armor','mount'].map(k => { const c = p.equips[k]; p.equips[k] = null; return c; }).filter(Boolean),
    p.judge.splice(0)
  );
  toDiscard(cards);
  if (window.UI) UI.render();
  await sleep(400);

  // 奖惩
  if (source && source.alive && source !== p){
    if (p.identity === 'student'){
      log(source.name + ' 击杀学生，摸 3 张牌（奖惩）', 'sys');
      await drawCards(source, 3, '击杀学生');
    } else if (p.identity === 'staff' && source.identity === 'dean'){
      log(source.name + ' 误杀教务，弃置所有手牌与装备区的牌（奖惩）', 'dmg');
      const all = source.hand.splice(0).concat(
        ['weapon','armor','mount'].map(k => { const c = source.equips[k]; source.equips[k] = null; return c; }).filter(Boolean));
      toDiscard(all);
    } else if (p.identity === 'mole' && G.opts.moleReward){
      await drawCards(source, 1, '击杀卧底（可选奖励）');
    }
  }
  if (window.UI) UI.render();
  checkVictory();
}

function checkVictory(){
  if (G.over) return;
  const alive = alivePlayers();
  const dean = G.players.find(p => p.identity === 'dean');
  const students = G.players.filter(p => p.identity === 'student');
  const moles = G.players.filter(p => p.identity === 'mole');
  // 平局
  if (alive.length === 0){ endGame(null, '全员阵亡'); return; }
  // 卧底胜：院长死亡且仅剩卧底一人
  if (!dean.alive){
    if (alive.length === 1 && alive[0].identity === 'mole'){ endGame('mole', '院长死亡且卧底成为唯一存活者'); return; }
    endGame('student', '院长死亡');
    return;
  }
  // 院方胜：学生与卧底全灭且院长存活
  const bad = students.concat(moles).filter(p => p.alive);
  if (bad.length === 0){ endGame('dean', '学生与卧底全部出局，院长存活'); return; }
}
function endGame(winner, reason){
  if (G.over) return;
  G.over = true;
  const human = G.players[G.humanSeat];
  let humanWin = false;
  if (winner === 'dean') humanWin = (human.identity === 'dean' || human.identity === 'staff');
  else if (winner === 'student') humanWin = (human.identity === 'student');
  else if (winner === 'mole') humanWin = (human.identity === 'mole');
  logBig('游戏结束：' + (winner ? IDENTITIES[winner].name + '阵营胜利' : '平局') + '（' + reason + '）');
  if (window.FX) FX.gameEnd(humanWin);
  if (window.UI && UI.showOver) UI.showOver(winner, reason, humanWin);
}

/* =========================================================
 *  询问入口：人类走 UI，AI 走 ai.js
 * ========================================================= */
async function Ask(player, req){
  req.player = player;
  if (G.over) return {};              // 游戏已结束：不再产生任何询问
  if (window.UI) UI.render();
  if (player.isHuman && window.UI && UI.askHuman) return await UI.askHuman(req);
  return await window.AI.decide(req);
}

/* ---------------- 询问是否打出某张响应牌 ---------------- */
/** 询问 order 中的角色是否打出指定牌名（代课/辅导员签字），返回打出的角色或 null */
async function askResponse(needName, reqPlayer, prompt, opts){
  opts = opts || {};
  const order = orderFrom(G.turnSeat);
  for (const p of order){
    if (!p.alive) continue;
    if (opts.onlyTarget && p !== reqPlayer) continue;
    const avail = p.hand.filter(c => c.name === needName || (needName === '代课' && CARDS[c.name].kind === 'dodge'));
    const canSkill = (needName === '代课') && (
      (hasSkill(p,'波比跳') && !skillUsed(p,'波比跳') && p.hand.length > 0) ||
      (p.equips.armor && p.equips.armor.name === '校园卡' && p === reqPlayer)
    );
    if (!avail.length && !canSkill) continue;
    // 校园卡判定失败后仍可用手牌中的代课，因此允许对同一角色重复询问
    let armorUsed = false;
    let answered = false;
    while (!answered){
      const opt2 = Object.assign({}, opts, { ignoreArmor: opts.ignoreArmor || armorUsed });
      const stillAvail = p.hand.filter(c => c.name === needName || (needName === '代课' && CARDS[c.name].kind === 'dodge'));
      const canArmorNow = !!(p.equips.armor && p.equips.armor.name === '校园卡' && !opt2.ignoreArmor);
      const canPopi = hasSkill(p, '波比跳') && !skillUsed(p, '波比跳') && p.hand.length > 0;
      if (!stillAvail.length && !canArmorNow && !canPopi){ answered = true; break; }
      const r = await Ask(p, { kind:'choice', prompt:prompt + '（' + p.name + '）',
        options: buildResponseOptions(p, needName, stillAvail, opt2) });
      if (!r.option || r.option === 'no'){ answered = true; break; }
      if (r.option === 'skill_popi'){
        const sel = await Ask(p, { kind:'selectCards', prompt:'【波比跳】弃置一张手牌', from:'self', min:1, max:1 });
        if (sel.cards && sel.cards.length){
          discardFromHand(p, sel.cards); markSkillUsed(p,'波比跳');
          log(p.name + ' 发动【波比跳】，视为打出【代课】', 'sys');
          if (window.FX){
            FX.skillBanner(p.name, '波比跳');
            FX.addToExchange(p.name, { name:'代课', suit:null }, '', { response:true, tag:'【波比跳】视为代课', sfx:'dodge' });
          }
          return { player:p, via:'波比跳' };
        }
        answered = true; break;
      }
      if (r.option === 'skill_card'){
        armorUsed = true;                       // 校园卡同一张牌只判定一次
        const jc = drawFromDeck();
        if (!jc){ answered = true; break; }
        log(p.name + ' 发动【校园卡】查考勤：' + cardText(jc), 'sys');
        if (window.FX) await FX.judge({ name:'校园卡' }, jc);
        toDiscard(jc);
        if (D.isRedCard(jc)){
          log('判定为红色 → 视为打出【代课】', 'sys');
          if (window.FX) FX.addToExchange(p.name, { name:'代课', suit:null }, '', { response:true, tag:'【校园卡】判定成功', sfx:'dodge' });
          return { player:p, via:'校园卡' };
        }
        log('判定为黑色 → 校园卡未生效，仍可用手牌代课', 'sys');
        continue;                               // 重新询问同一名角色
      }
      if (r.option === 'card'){
        const sel = await Ask(p, { kind:'selectCards', prompt:'打出 ' + needName, from:'self', min:1, max:1,
          filter:c => c.name === needName || (needName === '代课' && CARDS[c.name].kind === 'dodge') });
        if (sel.cards && sel.cards.length){
          removeFromHand(p, sel.cards); toDiscard(sel.cards);
          log(p.name + ' 打出 ' + cardText(sel.cards[0]), '');
          if (window.FX) FX.addToExchange(p.name, sel.cards[0], '', { response:true, tag:'响应 · 抵消', sfx:'dodge' });
          return { player:p, via:'card', card:sel.cards[0] };
        }
        answered = true; break;
      }
      answered = true;
    }
  }
  return null;
}
function buildResponseOptions(p, needName, avail, reqOpts){
  const opts = [];
  reqOpts = reqOpts || {};
  if (avail.length) opts.push({ key:'card', label:'打出' + needName + '（' + avail.map(cardText).join('、') + '）' });
  if (hasSkill(p,'波比跳') && !skillUsed(p,'波比跳') && p.hand.length > 0) opts.push({ key:'skill_popi', label:'发动【波比跳】（弃1张牌当代课）' });
  if (p.equips.armor && p.equips.armor.name === '校园卡' && needName === '代课' && !reqOpts.ignoreArmor)
    opts.push({ key:'skill_card', label:'发动【校园卡】查考勤' });
  opts.push({ key:'no', label:'放弃' });
  return opts;
}

/** 王磊【贬低】：其他角色打出代课时可弃一张牌令其无效（每回合限一次） */
async function tryDibel(dodgePlayer, attackUser){
  for (const p of orderFrom(G.turnSeat)){
    if (!p.alive) continue;
    if (!hasSkill(p, '贬低') || skillUsed(p, '贬低')) continue;
    if (p === dodgePlayer) continue;
    if (p.hand.length === 0 && !p.equips.weapon && !p.equips.armor && !p.equips.mount) continue;
    const r = await Ask(p, { kind:'choice', prompt:'【贬低】' + dodgePlayer.name + ' 打出了代课，是否弃一张牌令其无效？',
      options:[{key:'yes',label:'发动（弃一张牌）'},{key:'no',label:'放弃'}], skillBlock:true });
    if (r.option !== 'yes') return false;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【贬低】弃置一张牌（手牌或装备）', from:'any', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return false;
    const c = sel.cards[0];
    if (p.hand.includes(c)) discardFromHand(p, [c]);
    else { removeFromZone(p, c); toDiscard(c); log(p.name + ' 弃置了装备区的 ' + cardText(c), ''); }
    markSkillUsed(p, '贬低');
    log(p.name + ' 发动【贬低】，令代课无效！', 'sys');
    return true;
  }
  return false;
}

/* =========================================================
 *  使用牌的主流程
 * ========================================================= */
function cardText(c){
  if (!c) return '？';
  if (c.virtual) return '【视为' + c.name + '】';
  if (!D.SUITS[c.suit]) return c.name;
  return D.suitOf(c).sym + D.rankLabel(c.rank) + '·' + c.name;
}

/** 计算某人是否免疫某张牌（防具 / 锁定技） */
function isImmuneByCard(target, card, attacker){
  // 【试卷】：使用者以"上课点名"指定目标时无视其防具
  const paper = attacker && attacker.equips.weapon && attacker.equips.weapon.name === '试卷'
                && card.name === '上课点名';
  const armor = paper ? null : target.equips.armor;
  if (card.kind === 'attack'){
    if (card.name === '上课点名'){
      if (armor && armor.name === '学生证' && D.isBlackCard(card)) return '学生证（黑色点名无效）';
      if (armor && armor.name === '雨衣') return '雨衣（普通点名无效）';
    }
    if (card.dmg === 'fire' || card.dmg === 'thunder'){ /* 属性点名不被学生证/雨衣免疫 */ }
  }
  if (card.kind === 'aoeAttack'){
    if (armor && armor.name === '雨衣') return '雨衣（群伤免疫）';
  }
  return null;
}

/** 目标合法性 */
function validTargets(user, card){
  const res = [];
  const othersAlive = others(user);
  const k = card.kind;
  const canTarget = t => !(t.marks && t.marks.slideFrom === user.seat && t.marks.slideTurn === G.turnId);
  if (k === 'attack'){
    for (const t of othersAlive){
      if (!inAttackRange(user, t)) continue;
      if (!canTarget(t)) continue;
      res.push(t);
    }
    return res;
  }
  if (k === 'heal' || k === 'buff') return [user];
  if (k === 'draw2') return [user];
  if (k === 'lightning') return [user];
  if (k === 'aoeAttack') return othersAlive;
  if (k === 'massHeal' || k === 'harvest') return othersAlive.concat([user]);
  if (k === 'dismantle'){
    for (const t of othersAlive){
      const z = allZoneCards(t);
      if (z.some(x => x.zone !== 'hand' || canBeHandTargeted(t))) res.push(t);
    }
    return res;
  }
  if (k === 'snatch'){
    for (const t of othersAlive){
      if (card.tag === 'probe' && hasSkill(t, '潜行')) continue;
      if (distance(user, t) > 1) continue;
      const z = allZoneCards(t);
      if (z.some(x => x.zone !== 'hand' || canBeHandTargeted(t))) res.push(t);
    }
    return res;
  }
  if (k === 'duel'){
    for (const t of othersAlive){ if (hasSkill(t, '伦理')) continue; res.push(t); }
    return res;
  }
  if (k === 'relay'){
    for (const t of othersAlive){ if (t.equips.weapon) res.push(t); }
    return res;
  }
  if (k === 'fireTalk'){
    for (const t of othersAlive){ if (t.hand.length > 0 && canBeHandTargeted(t)) res.push(t); }
    return res;
  }
  if (k === 'chain') return alivePlayers();
  if (k === 'delayPlay'){
    for (const t of othersAlive){ if (hasSkill(t,'潜行')) continue; res.push(t); }
    return res;
  }
  if (k === 'delayDraw'){
    for (const t of othersAlive){ if (distance(user, t) <= 1) res.push(t); }
    return res;
  }
  return res;
}

/** 使用一张牌（外层包装：一次"出牌 + 其所有后续响应牌"= 一次结算连锁，
 *  连锁期间所有牌都留在中央出牌区，整条链结束后才清空） */
let _exchDepth = 0;
async function useCard(user, card, targets){
  const outer = (_exchDepth === 0);
  _exchDepth++;
  if (outer && window.FX) FX.beginExchange();
  try {
    return await useCardInner(user, card, targets);
  } finally {
    _exchDepth--;
    if (_exchDepth === 0 && window.FX) await FX.endExchange();
  }
}

async function useCardInner(user, card, targets){
  // 从手牌移除
  removeFromHand(user, [card]);
  card._usedBy = user.seat;
  if (!user.usedCardsThisTurn) user.usedCardsThisTurn = [];
  user.usedCardsThisTurn.push(card);
  // 使用次数记录（点名类 / 延时类）
  if (D.ATTACK_CARDS.includes(card.name)) user.usedAttackCardThisPhase = (user.usedAttackCardThisPhase||0) + 1;
  if (card.type === 'delayed') user.usedDelayed = (user.usedDelayed||0) + 1;

  // 学生证 / 雨衣 的"牌无效"在这里先过滤目标
  const effTargets = [];
  if (targets && targets.length){
    for (const t of targets){
      const imm = isImmuneByCard(t, card, user);
      if (imm){ log(t.name + ' 的 【' + imm + '】 令 ' + card.name + ' 无效', 'sys'); continue; }
      effTargets.push(t);
    }
  }

  log('▶ ' + user.name + ' 使用 ' + cardText(card) + (effTargets.length ? ' → ' + effTargets.map(t=>t.name).join('、') : ''), 'hl');

  // 出牌特写：中央放大展示，给所有玩家看清的时间
  if (window.FX){
    const names = effTargets.map(t => t.name);
    const tgt = names.length
      ? '→ ' + (names.length > 3 ? names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 人' : names.join('、'))
      : '';
    const isEquip = card.type === 'equip';
    await FX.cardPlay(user.name, card, tgt, { sfx: isEquip ? 'equip' : (card.kind === 'attack' ? 'attack' : 'play') });
  }

  // 【炫富】：目标可取消针对自己的此牌
  let canceledFor = new Set();
  for (const t of effTargets){
    if (!t.alive || t === user) continue;   // 自己对自己使用牌不触发炫富
    if (hasSkill(t, '炫富') && !skillUsed(t, '炫富') && t.hand.length > 0){
      const r = await Ask(t, { kind:'choice', prompt:'【炫富】' + user.name + ' 对你使用了 ' + card.name + '，是否弃一张牌取消此牌？',
        options:[{key:'yes',label:'发动【炫富】（弃1张牌，对方摸1张，取消此牌）'},{key:'no',label:'放弃'}], skillBlock:true });
      if (r.option === 'yes'){
        const sel = await Ask(t, { kind:'selectCards', prompt:'【炫富】弃置一张牌', from:'self', min:1, max:1 });
        if (sel.cards && sel.cards.length){
          discardFromHand(t, sel.cards); markSkillUsed(t, '炫富');
          await drawCards(user, 1, '炫富');
          canceledFor.add(t.seat);
          log(t.name + ' 发动【炫富】，取消了对自己的 ' + card.name, 'sys');
        }
      }
    }
  }
  const live = effTargets.filter(t => !canceledFor.has(t.seat));

  // 【人脉】：有人使用事件牌时可令其额外摸一张
  if (card.type === 'event' || card.type === 'delayed') await triggerRenmai(user);

  // 辅导员签字（非延时与延时事件牌均可被无效）
  if ((card.type === 'event' || card.type === 'delayed') && card.kind !== 'nullify'){
    const nul = await nullifyCheck(user, card);
    if (nul){ toDiscard(card); finishUse(user, card); return; }
  }

  // 分派效果
  switch (card.kind){
    case 'attack':       await resolveAttack(user, card, live); break;
    case 'dodge':        break;
    case 'heal':         await heal(user, 1, '请假条'); break;
    case 'buff':         user.marks.buff = (user.marks.buff||0) + 1;
                          log(user.name + ' 使用红牛，本回合下一张点名类牌伤害+1', 'sys'); break;
    case 'dismantle':    await resolveDismantle(user, live[0]); break;
    case 'snatch':       await resolveSnatch(user, live[0]); break;
    case 'draw2':        await drawCards(user, 2, '借笔记'); break;
    case 'duel':         await resolveDuel(user, live[0]); break;
    case 'aoeAttack':    await resolveAoe(user, card); break;
    case 'relay':        await resolveRelay(user, live[0]); break;
    case 'harvest':      await resolveHarvest(user); break;
    case 'massHeal':     for (const p of alivePlayers()) await heal(p, 1, '放假通知'); break;
    case 'fireTalk':     await resolveFireTalk(user, live[0]); break;
    case 'chain':        await resolveChain(user, live); break;
    case 'delayPlay':    placeDelayed(live[0], card); finishUse(user, card); return;
    case 'delayDraw':    placeDelayed(live[0], card); finishUse(user, card); return;
    case 'lightning':    placeDelayed(user, card); finishUse(user, card); return;
    case 'equip':        equipCard(user, card); return;   // 装备牌不进弃牌堆
    case 'nullify':      break;
  }
  toDiscard(card);
  finishUse(user, card);
}
function finishUse(user, card){
  if (window.UI) UI.render();
}
function placeDelayed(target, card){
  if (!target) return;
  target.judge.push(card);
  log(card.name + ' 置于 ' + target.name + ' 的通知栏', 'sys');
  if (window.UI) UI.render();
}
function equipCard(user, card){
  const slot = card.slot;
  const old = user.equips[slot];
  user.equips[slot] = card;
  user.hand = user.hand.filter(c => c !== card);
  log(user.name + ' 装备了 ' + cardText(card), 'sys');
  if (old){
    toDiscard(old);
    log(user.name + ' 的 ' + old.name + ' 被替换，进入弃牌堆', 'sys');
    if (old.name === '医保卡') heal(user, 1, '失去医保卡');
  }
  if (window.UI) UI.render();
}

/* ---------------- 点名类牌结算 ---------------- */
async function resolveAttack(user, card, targets){
  for (const t of targets){
    if (!t.alive) continue;
    await resolveAttackOne(user, card, t);
  }
}
async function resolveAttackOne(user, card, target, opts){
  opts = opts || {};
  // 【试卷】锁定技：以"上课点名"指定目标时无视其防具（校园卡/学生证/医保卡/雨衣全部失效）
  const ignoreArmor = !!(user.equips.weapon && user.equips.weapon.name === '试卷' && card.name === '上课点名');
  let dodged = false;
  if (target.dodgeBan){
    log(target.name + ' 本回合不能使用"代课"', 'sys');
  } else {
    const res = await askResponse('代课', target, '【' + card.name + '】' + user.name + ' 指定 ' + target.name + ' 为目标，是否打出代课？', { onlyTarget:true, ignoreArmor });
    if (res){
      let negated = false;
      if (res.via === 'card' || res.via === '波比跳'){
        negated = await tryDibel(target, user);
      }
      if (!negated){
        dodged = true;
        // 红笔：被代课抵消时可弃两张牌令伤害照常
        if (user.equips.weapon && user.equips.weapon.name === '红笔' && card.name === '上课点名'){
          const canPay = countPayable(user) >= 2;
          if (canPay){
            const r = await Ask(user, { kind:'choice', prompt:'【红笔】是否弃两张牌令此"上课点名"依然造成伤害？',
              options:[{key:'yes',label:'发动（弃两张牌）'},{key:'no',label:'放弃'}], skillBlock:true });
            if (r.option === 'yes'){
              const sel = await Ask(user, { kind:'selectCards', prompt:'【红笔】弃置两张牌', from:'any', min:2, max:2 });
              if (sel.cards && sel.cards.length === 2){
                payCards(user, sel.cards);
                log(user.name + ' 发动【红笔】，伤害照常结算！', 'sys');
                dodged = false;
              }
            }
          }
        }
        // 戒尺：被代课抵消时可再使用一张上课点名（每回合限一次）
        if (dodged && user.equips.weapon && user.equips.weapon.name === '戒尺' && card.name === '上课点名'
            && !skillUsed(user, '戒尺') && user.hand.some(c => c.name === '上课点名')){
          const r = await Ask(user, { kind:'choice', prompt:'【戒尺】是否对 ' + target.name + ' 再使用一张"上课点名"？',
            options:[{key:'yes',label:'发动'},{key:'no',label:'放弃'}], skillBlock:true });
          if (r.option === 'yes'){
            const sel = await Ask(user, { kind:'selectCards', prompt:'【戒尺】选择一张上课点名', from:'self', min:1, max:1, filter:c => c.name === '上课点名' });
            if (sel.cards && sel.cards.length){
              markSkillUsed(user, '戒尺');
              await useCard(user, sel.cards[0], [target]);
            }
          }
        }
      }
    }
  }
  if (dodged){
    log(card.name + ' 被 ' + target.name + ' 抵消', 'sys');
    return;
  }
  // 教鞭：造成伤害时可改为弃目标两张牌
  if (user.equips.weapon && user.equips.weapon.name === '教鞭' && card.name === '上课点名'){
    const z = allZoneCards(target).filter(x => x.zone !== 'hand' || canBeHandTargeted(target));
    if (z.length){
      const r = await Ask(user, { kind:'choice', prompt:'【教鞭】是否防止此伤害，改为弃置 ' + target.name + ' 两张牌？',
        options:[{key:'yes',label:'发动'},{key:'no',label:'放弃'}], skillBlock:true });
      if (r.option === 'yes'){
        const take = Math.min(2, z.length);
        for (let i=0;i<take;i++){
          const zz = allZoneCards(target).filter(x => x.zone !== 'hand' || canBeHandTargeted(target));
          if (!zz.length) break;
          const chosen = await chooseZoneCard(user, target, zz, '【教鞭】弃置 ' + target.name + ' 一张牌');
          if (!chosen) break;
          removeFromZone(target, chosen);
          toDiscard(chosen);
          log(user.name + ' 弃置了 ' + target.name + ' 的 ' + cardText(chosen), '');
          if (chosen.name === '医保卡') await heal(target, 1, '失去医保卡');
        }
        return;
      }
    }
  }
  // 伤害计算
  let dmg = 1;
  if (card.name === '上课点名'){
    if (hasSkill(user,'热血') && !user.hotUsed && !opts.noHot) { dmg++; user.hotUsed = true; log(user.name + ' 发动【热血】，伤害+1', 'sys'); }
    if (user.marks.buff > 0){ user.marks.buff--; dmg++; log('红牛增益生效，伤害+1（剩余 ' + user.marks.buff + ' 层）', 'sys'); }
    if (user.equips.weapon && user.equips.weapon.name === '红头文件' && target.hand.length === 0){ dmg++; log('【红头文件】生效，伤害+1', 'sys'); }
  } else {
    if (user.marks.buff > 0 && card.name !== '上课点名'){ /* 红牛只对点名类牌生效，含公开处刑/雷同警告 */
      user.marks.buff--; dmg++; log('红牛增益生效，伤害+1', 'sys'); }
  }
  // 激光笔
  if (user.equips.weapon && user.equips.weapon.name === '激光笔' && card.name === '上课点名'){
    const opposite = isOppositeSex(user, target);
    if (opposite){
      const r = await Ask(target, { kind:'choice', prompt:'【激光笔】' + user.name + ' 指定了你，请选择：弃一张手牌，或让其摸一张牌',
        options:[{key:'discard',label:'弃一张手牌'},{key:'draw',label:'让 ' + user.name + ' 摸一张牌'}] });
      if (r.option === 'draw'){ await drawCards(user, 1, '激光笔'); }
      else if (target.hand.length){
        const sel = await Ask(target, { kind:'selectCards', prompt:'【激光笔】弃置一张手牌', from:'self', min:1, max:1 });
        if (sel.cards && sel.cards.length) discardFromHand(target, sel.cards);
      }
    }
  }
  const dealt = await damage(target, dmg, user, card.dmg || 'normal', { ignoreArmor });
  // 监控摄像头
  if (dealt > 0 && user.equips.weapon && user.equips.weapon.name === '监控摄像头' && target.alive && target.equips.mount){
    const r = await Ask(user, { kind:'choice', prompt:'【监控摄像头】是否弃置 ' + target.name + ' 的坐骑 ' + target.equips.mount.name + '？',
      options:[{key:'yes',label:'弃置'},{key:'no',label:'放弃'}], skillBlock:true });
    if (r.option === 'yes'){
      const m = target.equips.mount; target.equips.mount = null; toDiscard(m);
      log(user.name + ' 弃置了 ' + target.name + ' 的 ' + m.name, 'sys');
      if (m.name === '医保卡') await heal(target, 1, '失去医保卡');
    }
  }
}
function isOppositeSex(a, b){
  const A = SEX[a.char.name], B = SEX[b.char.name];
  if (!A || !B) return true;
  if (A === 'other' || B === 'other') return true;
  return A !== B;
}
const SEX = { '李心瑶':'女','宋美丽':'女','夜露':'女','奶扣':'女',
  '周志远':'男','王磊':'男','董昌程':'男','史鉴明':'男','数学郭':'男','肾小球':'男','钓鱼老':'男',
  '董旭':'男','董启龙':'男','王三金':'男','方三水':'男','虎爷':'男','京爷':'男','鸟爷':'男','波比':'男','董伦':'男' };

/* ---------------- 其他牌的效果 ---------------- */
async function resolveDismantle(user, target){
  if (!target) return;
  const z = allZoneCards(target).filter(x => x.zone !== 'hand' || canBeHandTargeted(target));
  if (!z.length) return;
  const chosen = await chooseZoneCard(user, target, z, '【通报批评】选择要弃置的牌');
  if (!chosen) return;
  removeFromZone(target, chosen); toDiscard(chosen);
  log(user.name + ' 弃置了 ' + target.name + ' 的 ' + cardText(chosen), 'sys');
  if (chosen.name === '医保卡') await heal(target, 1, '失去医保卡');
}
async function resolveSnatch(user, target){
  if (!target) return;
  const z = allZoneCards(target).filter(x => x.zone !== 'hand' || canBeHandTargeted(target));
  if (!z.length) return;
  const chosen = await chooseZoneCard(user, target, z, '【抄作业】选择要获得的牌');
  if (!chosen) return;
  removeFromZone(target, chosen);
  user.hand.push(chosen);
  log(user.name + ' 获得了 ' + target.name + ' 的 ' + cardText(chosen), 'sys');
  if (chosen.name === '医保卡') await heal(target, 1, '失去医保卡');
}
async function resolveDuel(user, target){
  if (!target) return;
  log('【课堂辩论】开始：由 ' + target.name + ' 先打出"上课点名"', 'sys');
  let attacker = target, defender = user;
  while (true){
    if (!attacker.alive){ return; }
    const card = attacker.hand.find(c => c.name === '上课点名');
    if (!card){
      log(attacker.name + ' 无法打出"上课点名"，受到 1 点伤害', 'dmg');
      await damage(attacker, 1, defender, 'normal');
      return;
    }
    let play = false;
    if (attacker.isHuman || true){
      const r = await Ask(attacker, { kind:'choice', prompt:'【课堂辩论】是否打出"上课点名"？（不出则受 1 点伤害）',
        options:[{key:'yes',label:'打出上课点名'},{key:'no',label:'不出（受伤）'}], skillBlock:true });
      play = r.option === 'yes';
    }
    if (!play){
      await damage(attacker, 1, defender, 'normal');
      return;
    }
    removeFromHand(attacker, [card]); toDiscard(card);
    log(attacker.name + ' 打出 ' + cardText(card), '');
    [attacker, defender] = [defender, attacker];
  }
}
async function resolveAoe(user, card){
  const targets = others(user).slice();
  for (const t of targets){
    if (!t.alive) continue;
    if (isImmuneByCard(t, card, user)){ log(t.name + ' 的防具令 ' + card.name + ' 无效', 'sys'); continue; }
    // 炫富
    if (hasSkill(t,'炫富') && !skillUsed(t,'炫富') && t.hand.length > 0){
      const r = await Ask(t, { kind:'choice', prompt:'【炫富】' + user.name + ' 使用了 ' + card.name + '，是否取消对你的结算？',
        options:[{key:'yes',label:'发动【炫富】'},{key:'no',label:'放弃'}], skillBlock:true });
      if (r.option === 'yes'){
        const sel = await Ask(t, { kind:'selectCards', prompt:'【炫富】弃置一张牌', from:'self', min:1, max:1 });
        if (sel.cards && sel.cards.length){ discardFromHand(t, sel.cards); markSkillUsed(t,'炫富');
          await drawCards(user, 1, '炫富'); log(t.name + ' 发动【炫富】取消了自己的结算', 'sys'); continue; }
      }
    }
    if (card.need === '代课'){
      if (t.dodgeBan){ log(t.name + ' 不能使用代课', 'sys'); }
      else {
        const res = await askResponse('代课', t, '【' + card.name + '】是否打出代课？', { onlyTarget:true });
        if (res){
          const negated = (res.via === 'card' || res.via === '波比跳') ? await tryDibel(t, user) : false;
          if (!negated){ log(t.name + ' 打出代课，化解了 ' + card.name, 'sys'); continue; }
        }
      }
      await damage(t, 1, user, card.dmg || 'normal');
    } else {
      const need = t.hand.find(c => c.name === card.need);
      if (need){
        const r = await Ask(t, { kind:'choice', prompt:'【' + card.name + '】是否打出"上课点名"化解？',
          options:[{key:'yes',label:'打出上课点名'},{key:'no',label:'不出（受1点伤害）'}], skillBlock:true });
        if (r.option === 'yes'){ removeFromHand(t, [need]); toDiscard(need); log(t.name + ' 打出 ' + cardText(need) + ' 化解', ''); continue; }
      } else {
        log(t.name + ' 没有"上课点名"', 'sys');
      }
      await damage(t, 1, user, card.dmg || 'normal');
    }
  }
}
async function resolveRelay(user, target){
  if (!target || !target.equips.weapon) return;
  const w = target.equips.weapon;
  // 指定第三名角色（在目标的攻击范围内且非目标自己）
  const cand = alivePlayers().filter(p => p !== target && distance(target, p) <= CARDS[w.name].range);
  if (!cand.length){ log('无可指定的第三方，' + user.name + ' 直接获得武器', 'sys'); gainWeapon(user, target); return; }
  const third = (user.isHuman)
    ? (await Ask(user, { kind:'selectTargets', prompt:'【点名接力】指定被点名的第三者', targets:cand, min:1, max:1 })).targets[0]
    : await window.AI.pickTarget(user, cand, 'relay');
  if (!third){ log('未指定目标，结算中止', 'sys'); return; }
  const hasPoint = target.hand.some(c => c.name === '上课点名');
  let doIt = false;
  if (hasPoint){
    const r = await Ask(target, { kind:'choice',
      prompt:'【点名接力】' + user.name + ' 要求你对 ' + third.name + ' 使用"上课点名"，否则其获得你的武器（' + w.name + '）',
      options:[{key:'yes',label:'执行（使用上课点名）'},{key:'no',label:'拒绝（失去武器）'}] });
    doIt = r.option === 'yes';
  } else {
    log(target.name + ' 手中没有"上课点名"，无法执行', 'sys');
  }
  if (doIt){
    const card = target.hand.find(c => c.name === '上课点名');
    await useCard(target, card, [third]);
  } else {
    gainWeapon(user, target);
  }
}
function gainWeapon(user, target){
  const w = target.equips.weapon;
  if (!w) return;
  target.equips.weapon = null;
  const old = user.equips.weapon;
  user.equips.weapon = w;
  if (old){ toDiscard(old); }
  log(user.name + ' 获得了 ' + target.name + ' 的武器 ' + w.name, 'sys');
  if (window.UI) UI.render();
}
async function resolveHarvest(user){
  const X = alivePlayers().length;
  const shown = [];
  for (let i=0;i<X;i++){ const c = drawFromDeck(); if (c) shown.push(c); }
  log('【小组作业】亮出：' + shown.map(cardText).join('、'), 'sys');
  const order = orderFrom(user.seat);
  for (const p of order){
    if (!shown.length) break;
    let idx = 0;
    if (p.isHuman && window.UI){
      const sel = await Ask(p, { kind:'selectCards', prompt:'【小组作业】选择一张牌获得', cards:shown, min:1, max:1 });
      const c = sel.cards && sel.cards[0];
      idx = shown.indexOf(c); if (idx < 0) idx = 0;
    } else {
      idx = (await window.AI.pickShown(p, shown)) || 0;
    }
    const got = shown.splice(idx,1)[0];
    p.hand.push(got);
    log(p.name + ' 选择了 ' + cardText(got), '');
  }
  toDiscard(shown);
}
async function resolveFireTalk(user, target){
  if (!target || !target.hand.length) return;
  let shownCard;
  if (target.isHuman && window.UI){
    const sel = await Ask(target, { kind:'selectCards', prompt:'【当面约谈】展示一张手牌', from:'self', min:1, max:1, reveal:true });
    shownCard = sel.cards && sel.cards[0];
  } else {
    shownCard = pickRandom(target.hand);
  }
  if (!shownCard) return;
  log(target.name + ' 展示了 ' + cardText(shownCard), 'sys');
  const same = user.hand.filter(c => c.suit === shownCard.suit);
  if (!same.length){ log(user.name + ' 没有同花色手牌，无法造成伤害', 'sys'); return; }
  const r = await Ask(user, { kind:'choice', prompt:'是否弃一张同花色（' + D.suitOf(shownCard).sym + '）手牌造成 1 点火焰伤害？',
    options:[{key:'yes',label:'弃牌并造成伤害'},{key:'no',label:'放弃'}], skillBlock:true });
  if (r.option !== 'yes') return;
  const sel = await Ask(user, { kind:'selectCards', prompt:'弃置一张同花色手牌', from:'self', min:1, max:1, filter:c => c.suit === shownCard.suit });
  if (!sel.cards || !sel.cards.length) return;
  discardFromHand(user, sel.cards);
  await damage(target, 1, user, 'fire');
}
async function resolveChain(user, targets){
  // 重铸在出牌阶段由 UI 提供"重铸"选项；此处处理横置/重置
  for (const t of (targets||[])){
    if (!t) continue;
    t.chained = !t.chained;
    log(t.name + ' 被' + (t.chained ? '横置' : '重置'), 'sys');
  }
  if (window.UI) UI.render();
}

/* ---------------- 辅导员签字 ---------------- */
async function nullifyCheck(user, card){
  let layer = 0;
  let nullified = false;
  while (layer < 3){
    const order = orderFrom(G.turnSeat);
    let played = false;
    for (const p of order){
      if (!p.alive) continue;
      const has = p.hand.some(c => c.name === '辅导员签字');
      if (!has) continue;
      const r = await Ask(p, { kind:'choice',
        prompt:'是否使用【辅导员签字】' + (nullified ? '（救援·再抵消）' : '') + '抵消 ' + user.name + ' 的 ' + card.name + '？',
        options:[{key:'yes',label:'使用辅导员签字'},{key:'no',label:'放弃'}], skillBlock:true,
        meta:{ cardName: card.name, caster: user.seat } });
      if (r.option === 'yes'){
        const c = p.hand.find(x => x.name === '辅导员签字');
        removeFromHand(p, [c]); toDiscard(c);
        log(p.name + ' 使用【辅导员签字】' + (nullified ? '再次抵消' : '抵消了 ' + card.name), 'sys');
        if (window.FX) FX.addToExchange(p.name, c, '', { response:true, tag: nullified ? '再抵消' : '无效化', sfx:'dodge' });
        nullified = !nullified;
        played = true;
        break;
      }
    }
    if (!played) break;
    layer++;
  }
  return nullified;
}
async function triggerRenmai(user){
  for (const p of orderFrom(G.turnSeat)){
    if (!p.alive) continue;
    if (!hasSkill(p, '人脉') || skillUsed(p, '人脉')) continue;
    if (p.hand.length === 0) continue;
    const r = await Ask(p, { kind:'choice', prompt:'【人脉】' + user.name + ' 使用了事件牌，是否弃一张牌令其额外摸一张？',
      options:[{key:'yes',label:'发动'},{key:'no',label:'放弃'}], skillBlock:true });
    if (r.option === 'yes'){
      const sel = await Ask(p, { kind:'selectCards', prompt:'【人脉】弃置一张牌', from:'self', min:1, max:1 });
      if (sel.cards && sel.cards.length){
        discardFromHand(p, sel.cards); markSkillUsed(p, '人脉');
        await drawCards(user, 1, '人脉');
      }
    }
    break;
  }
}

/* ---------------- 费用支付工具 ---------------- */
function countPayable(p){
  let n = p.hand.length;
  ['weapon','armor','mount'].forEach(k => { if (p.equips[k]) n++; });
  return n;
}
function payCards(p, cards){
  cards.forEach(c => {
    if (p.hand.includes(c)) discardFromHand(p, [c]);
    else { removeFromZone(p, c); toDiscard(c); log(p.name + ' 弃置了装备区的 ' + cardText(c), ''); }
  });
}
/** 让玩家在目标区域内选一张牌（手牌随机不可指定） */
async function chooseZoneCard(chooser, target, zoneCards, prompt){
  const handZone = zoneCards.filter(z => z.zone === 'hand');
  const tableZone = zoneCards.filter(z => z.zone !== 'hand');
  if (tableZone.length && !handZone.length){
    const list = tableZone.map(z => z.card);
    const sel = await Ask(chooser, { kind:'selectCards', prompt:prompt + '（' + target.name + '）', cards:list, min:1, max:1, owner:target });
    return (sel.cards && sel.cards[0]) || list[0];
  }
  if (handZone.length && !tableZone.length){
    return pickRandom(handZone).card;
  }
  // 两者都有：先选手牌区还是装备/通知栏
  const r = await Ask(chooser, { kind:'choice', prompt:prompt + '：选择区域（' + target.name + '）',
    options:[{key:'hand', label:'手牌区（随机一张）'}, {key:'table', label:'装备区/通知栏（可指定）'}] });
  if (r.option === 'table'){
    const list = tableZone.map(z => z.card);
    const sel = await Ask(chooser, { kind:'selectCards', prompt:prompt, cards:list, min:1, max:1, owner:target });
    return (sel.cards && sel.cards[0]) || list[0];
  }
  return pickRandom(handZone).card;
}

/* =========================================================
 *  主动技实现
 * ========================================================= */
const SKILLS = {
  /* R-01 */
  async 吹牛(p){
    const names = Object.keys(CARDS);
    let name;
    if (p.isHuman && window.UI){
      const r = await Ask(p, { kind:'selectOption', prompt:'【吹牛】宣言一种牌名', options:names.map(n => ({key:n, label:n})) });
      name = r.option;
    } else name = pickRandom(names);
    const drawn = await drawCards(p, 1, '吹牛');
    if (!drawn.length) return;
    const c = drawn[0];
    log(p.name + ' 宣言【' + name + '】，亮出 ' + cardText(c), 'sys');
    if (c.name !== name){
      p.pointBan = true;
      log('未宣言中：' + p.name + ' 本回合不能使用"上课点名"', 'dmg');
    } else {
      log('宣言命中！', 'sys');
    }
  },
  /* R-02 */
  async 挂科(p, targets){
    const t = targets[0];
    if (!t) return;
    log(p.name + ' 发动【挂科】指定 ' + t.name, 'sys');
    await damage(t, 1, p, 'normal');
    if (t.alive) await drawCards(t, 1, '挂科的补偿');
  },
  /* R-03 */
  async 系统(p, targets){ await viewAndDiscard(p, targets[0]); },
  /* R-04 */
  async 奉承(p, targets){
    const t = targets[0]; if (!t) return;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【奉承】选择一张手牌交给 ' + t.name, from:'self', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    removeFromHand(p, sel.cards); t.hand.push(sel.cards[0]);
    log(p.name + ' 交给 ' + t.name + ' 一张手牌', 'sys');
    await drawCards(p, 2, '奉承');
  },
  async 施压(p, targets){
    const t = targets[0]; if (!t) return;
    t.dodgeBan = true;
    log(p.name + ' 发动【施压】指定 ' + t.name + '，其本回合不能使用代课', 'sys');
    await damage(t, 1, p, 'normal');
  },
  /* R-05 */
  async 解密(p, targets){
    const t = targets[0]; if (!t || !t.hand.length) return;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【解密】弃置一张牌', from:'any', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    payCards(p, sel.cards);
    const got = pickRandom(t.hand);
    removeFromHand(t, [got]); p.hand.push(got);
    log(p.name + ' 发动【解密】，获得 ' + t.name + ' 一张手牌：' + cardText(got), 'sys');
  },
  /* R-06 */
  async 概率(p){
    const jc = drawFromDeck(); if (!jc) return;
    log(p.name + ' 发动【概率】查考勤：' + cardText(jc), 'sys');
    toDiscard(jc);
    if (D.isRedCard(jc)) await drawCards(p, 2, '概率');
    else {
      if (p.hand.length){
        const sel = await Ask(p, { kind:'selectCards', prompt:'【概率】判定为黑色，弃置一张手牌', from:'self', min:1, max:1 });
        if (sel.cards && sel.cards.length) discardFromHand(p, sel.cards);
      } else log('没有手牌可弃', 'sys');
    }
  },
  /* R-07 */
  async 共情(p, targets){
    const t = targets[0] || p;
    await heal(t, 1, '共情');
    await drawCards(p, 1, '共情');
  },
  /* R-08 */
  async 透析(p, targets){
    if (countPayable(p) < 2) return;
    const t = targets[0] || p;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【透析】弃置两张牌', from:'any', min:2, max:2 });
    if (!sel.cards || sel.cards.length < 2) return;
    payCards(p, sel.cards);
    await heal(t, 1, '透析');
    await drawCards(t, 1, '透析');
  },
  /* R-09 */
  async 垂钓(p){
    const sel = await Ask(p, { kind:'selectCards', prompt:'【垂钓】将一张手牌置于牌堆顶', from:'self', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    removeFromHand(p, sel.cards);
    G.deck.push(sel.cards[0]);
    log(p.name + ' 将一张手牌置于牌堆顶', 'sys');
    await drawCards(p, 2, '垂钓');
  },
  /* R-10 */
  async 窃听(p, targets){ await viewAndDiscard(p, targets[0]); },
  /* R-11 */
  async 冲锋(p, targets){
    const t = targets[0]; if (!t) return;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【冲锋】弃置一张牌', from:'any', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    payCards(p, sel.cards);
    log(p.name + ' 发动【冲锋】，视为使用"上课点名"', 'sys');
    if (window.FX) FX.addToExchange(p.name, { name:'上课点名', suit:null }, '→ ' + t.name, { tag:'【冲锋】视为使用' });
    p.usedAttackCardThisPhase++;
    p.usedPoint = true;
    await resolveAttackOne(p, { name:'上课点名', kind:'attack', dmg:'normal', _virtual:true }, t);
  },
  /* R-12 */
  async 龙吟(p, targets){
    const t = targets[0]; if (!t) return;
    t.dodgeBan = true;
    await drawCards(t, 1, '龙吟');
    log(p.name + ' 发动【龙吟】：' + t.name + ' 摸一张牌，本回合不能使用代课', 'sys');
  },
  /* R-13 */
  async 氪金(p){
    if (countPayable(p) < 2) return;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【氪金】弃置两张牌', from:'any', min:2, max:2 });
    if (!sel.cards || sel.cards.length < 2) return;
    payCards(p, sel.cards);
    const dig = [];
    while (true){
      const c = drawFromDeck();
      if (!c) break;
      if (c.type === 'equip'){
        p.hand.push(c);
        log(p.name + ' 发动【氪金】，亮出 ' + dig.length + ' 张后获得装备：' + cardText(c), 'sys');
        break;
      }
      dig.push(c);
      if (dig.length > 30) break;
    }
    toDiscard(dig);
  },
  /* R-14 */
  async 划水(p, targets){
    const t = targets[0]; if (!t) return;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【划水】交给 ' + t.name + ' 一张手牌', from:'self', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    removeFromHand(p, sel.cards); t.hand.push(sel.cards[0]);
    p.marks.noTargetBy = t.seat;   // t 不能对 p 用牌
    p.marks.noTargetTurn = G.turnId;
    // 记录在 t 上更便于校验：t 不能以 p 为目标
    t.marks.slideFrom = p.seat;
    t.marks.slideTurn = G.turnId;
    log(p.name + ' 发动【划水】：' + t.name + ' 本回合不能对 ' + p.name + ' 使用牌', 'sys');
  },
  /* R-15 */
  async 查寝(p, targets){
    const t = targets[0]; if (!t) return;
    if (!canBeHandTargeted(t)){ log('【加密】令【查寝】无法发动', 'sys'); return; }
    log(p.name + ' 观看 ' + t.name + ' 的手牌：' + t.hand.map(cardText).join('、'), 'sys');
    const eq = t.hand.filter(c => c.type === 'equip');
    if (!eq.length){ log(t.name + ' 手中没有装备牌', 'sys'); return; }
    const sel = await Ask(p, { kind:'selectCards', prompt:'【查寝】弃置 ' + t.name + ' 一张装备牌', cards:eq, min:1, max:1, owner:t });
    if (sel.cards && sel.cards.length) discardFromHand(t, sel.cards);
  },
  /* R-16 */
  async 侃山(p, targets){
    const t = targets[0];
    if (!t || !t.hand.length || !p.hand.length) return;
    const mine = p.isHuman ? (await Ask(p, { kind:'selectCards', prompt:'【侃山】选择一张手牌拼绩点', from:'self', min:1, max:1 })).cards[0] : pickRandom(p.hand);
    const his = t.isHuman ? (await Ask(t, { kind:'selectCards', prompt:'【侃山】选择一张手牌拼绩点', from:'self', min:1, max:1 })).cards[0] : pickRandom(t.hand);
    if (!mine || !his) return;
    log('拼绩点：' + p.name + ' ' + cardText(mine) + '（' + D.cardPoint(mine) + '） vs ' + t.name + ' ' + cardText(his) + '（' + D.cardPoint(his) + '）', 'sys');
    if (D.cardPoint(mine) > D.cardPoint(his)){ log(p.name + ' 赢下拼绩点', 'sys'); await drawCards(p, 2, '侃山'); }
    else { log(t.name + ' 赢下拼绩点（平点视为发起方输）', 'sys'); await drawCards(t, 1, '侃山'); }
  },
  /* R-17 */
  async 撒娇(p, targets){
    const t = targets[0];
    if (!t || !t.hand.length) return;
    let give;
    if (t.isHuman && window.UI){
      const sel = await Ask(t, { kind:'selectCards', prompt:'【撒娇】' + p.name + ' 要求你交给其一张手牌', from:'self', min:1, max:1 });
      give = sel.cards && sel.cards[0];
    } else give = pickRandom(t.hand);
    if (!give) return;
    removeFromHand(t, [give]); p.hand.push(give);
    log(t.name + ' 交给 ' + p.name + ' 一张手牌', 'sys');
    if (p.hand.length > 1){
      const sel = await Ask(p, { kind:'selectCards', prompt:'【撒娇】交给 ' + t.name + ' 一张手牌', from:'self', min:1, max:1 });
      if (sel.cards && sel.cards.length){ removeFromHand(p, sel.cards); t.hand.push(sel.cards[0]);
        log(p.name + ' 交给 ' + t.name + ' 一张手牌', 'sys'); }
    }
  },
  async 治愈(p, targets){
    const t = targets[0] || p;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【治愈】弃置一张牌', from:'any', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    payCards(p, sel.cards);
    await heal(t, 1, '治愈');
  },
  /* R-18 */
  async 鸽王(p, targets){
    const t = targets[0]; if (!t) return;
    const sel = await Ask(p, { kind:'selectCards', prompt:'【鸽王】弃置一张手牌', from:'self', min:1, max:1 });
    if (!sel.cards || !sel.cards.length) return;
    discardFromHand(p, sel.cards);
    t.marks.pigeon = 1;
    log(p.name + ' 发动【鸽王】：' + t.name + ' 下一个摸牌阶段被跳过', 'sys');
  },
  /* R-20 */
  async 轮值(p){
    await drawCards(p, 1, '轮值');
    if (p.hand.length){
      const sel = await Ask(p, { kind:'selectCards', prompt:'【轮值】弃置一张手牌', from:'self', min:1, max:1 });
      if (sel.cards && sel.cards.length) discardFromHand(p, sel.cards);
    }
  }
};
async function viewAndDiscard(p, t){
  if (!t) return;
  if (!canBeHandTargeted(t)){ log('【加密】令该技能无法发动', 'sys'); return; }
  if (!t.hand.length){ log(t.name + ' 没有手牌', 'sys'); return; }
  log(p.name + ' 观看 ' + t.name + ' 的手牌：' + t.hand.map(cardText).join('、'), 'sys');
  const sel = await Ask(p, { kind:'selectCards', prompt:'选择弃置 ' + t.name + ' 一张手牌', cards:t.hand.slice(), min:1, max:1, owner:t });
  if (sel.cards && sel.cards.length){ discardFromHand(t, sel.cards); }
}

/* =========================================================
 *  回合流程
 * ========================================================= */
async function runTurn(p){
  G.turnId++;
  p.skillsUsedThisTurn = {};
  p.usedCardsThisTurn = [];
  p.usedAttackCardThisPhase = 0;
  p.damageDealtThisTurn = 0;
  p.dodgeBan = false;
  p.pointBan = false;
  p.hotUsed = false;
  p.shuikeUsed = false;
  if (G.opts.hotseat) G.humanSeat = p.seat;
  p.skip = { draw:false, play:false, judge:false };
  p.usedDelayed = 0;
  if (window.UI){ UI.setPhase('start'); UI.render(); }
  logBig('—— ' + p.name + ' 的回合（第 ' + G.round + ' 轮）——');
  if (window.FX) await FX.turnBanner(p);

  await sleep(320);            // 每个阶段之间留出停顿

  /* 阶段 1：回合开始 */
  if (hasSkill(p, '轮值')){
    const r = await Ask(p, { kind:'choice', prompt:'【轮值】是否摸一张牌然后弃一张牌？',
      options:[{key:'yes',label:'发动'},{key:'no',label:'放弃'}], skillBlock:true });
    if (r.option === 'yes') await SKILLS.轮值(p);
  }
  await sleep(200);
  if (G.over) return;

  /* 阶段 2：查考勤 */
  if (UI) UI.setPhase('judge');
  await sleep(260);
  await judgePhase(p);
  if (G.over || !p.alive) return;

  /* 阶段 3：摸牌 */
  if (UI) UI.setPhase('draw');
  await sleep(260);
  if (p.marks.pigeon){ p.marks.pigeon = 0; log(p.name + ' 因【鸽王】跳过摸牌阶段', 'sys'); }
  else if (p.skip.draw) log(p.name + ' 跳过摸牌阶段', 'sys');
  else await drawCards(p, 2, '摸牌阶段');
  if (G.over || !p.alive) return;

  /* 阶段 4：出牌 */
  if (UI) UI.setPhase('play');
  await sleep(260);
  if (p.skip.play){
    log(p.name + ' 跳过出牌阶段', 'sys');
    if (hasSkill(p, '水课') && !p.shuikeUsed){ p.shuikeUsed = true; log(p.name + ' 发动【水课】，摸两张牌', 'sys'); await drawCards(p, 2, '水课'); }
  } else {
    await playPhase(p);
    // 出牌阶段中途被【设局】终止时，同样触发【水课】
    if (p.skip.play && hasSkill(p, '水课') && !p.shuikeUsed){
      p.shuikeUsed = true; log(p.name + ' 发动【水课】，摸两张牌', 'sys'); await drawCards(p, 2, '水课');
    }
  }
  if (G.over || !p.alive) return;

  /* 阶段 5：弃牌 */
  if (UI) UI.setPhase('discard');
  await sleep(260);
  const limit = handLimit(p);
  if (p.hand.length > limit){
    const need = p.hand.length - limit;
    log(p.name + ' 需要弃置 ' + need + ' 张手牌（上限 ' + limit + '）', '');
    if (window.FX && !p.isHuman) FX.floatText(p.seat, '弃 ' + need + ' 张', 'draw');
    const sel = await Ask(p, { kind:'selectCards', prompt:'弃牌阶段：请弃置 ' + need + ' 张手牌', from:'self', min:need, max:need });
    if (sel.cards && sel.cards.length) discardFromHand(p, sel.cards);
    else { const auto = p.hand.slice(0, need); discardFromHand(p, auto); }
  }
  if (G.over || !p.alive) return;

  /* 阶段 6：回合结束 */
  if (UI) UI.setPhase('end');
  await sleep(240);
  if (hasSkill(p, '摸鱼') && p.damageDealtThisTurn === 0) await drawCards(p, 1, '摸鱼');
  p.marks.buff = 0;
  p.marks.pigeon = 0;
  p.marks.slideTurn = -1;
  p.marks.noTargetTurn = -1;
  await sleep(420);            // 回合之间留白，避免"刚看完就换人"
}

async function judgePhase(p){
  // 断网标记
  if (p.marks.net > 0){
    while (p.marks.net > 0){
      const jc = drawFromDeck();
      p.marks.net--;
      if (!jc) break;
      log('【宿舍断网】查考勤：' + cardText(jc), 'sys');
      toDiscard(jc);
      if (D.isBlackCard(jc)){
        p.skip.draw = true; p.skip.play = true;
        log('判定为黑色：跳过摸牌与出牌阶段', 'dmg');
      } else log('判定为红色：断网解除', 'sys');
    }
  }
  while (p.judge.length){
    if (!p.alive) return;
    const card = p.judge[p.judge.length - 1];   // 后进先出
    const jc = drawFromDeck();
    if (!jc) return;
    log('查考勤：' + p.name + ' 的【' + card.name + '】→ 抽签牌 ' + cardText(jc), 'sys');
    if (window.FX) await FX.judge(card, jc);
    else { if (window.UI) UI.showJudge(card, jc); await sleep(600); }
    const idx = p.judge.indexOf(card);
    if (idx >= 0) p.judge.splice(idx, 1);
    if (card.name === '手机没电'){
      if (!(jc.suit === 'H')){ p.skip.play = true; log('判定不为红桃：' + p.name + ' 跳过出牌阶段', 'dmg'); }
      else log('判定为红桃：躲过', 'sys');
      toDiscard([card, jc]);
      // 【水课】的摸牌统一在出牌阶段被跳过时结算（避免重复触发）
    } else if (card.name === '饭卡没钱'){
      if (!(jc.suit === 'C')){ p.skip.draw = true; log('判定不为梅花：' + p.name + ' 跳过摸牌阶段', 'dmg'); }
      else log('判定为梅花：躲过', 'sys');
      toDiscard([card, jc]);
    } else if (card.name === '论文查重'){
      if (jc.suit === 'S' && jc.rank >= 2 && jc.rank <= 9){
        log('命中 ♠2-♠9：' + p.name + ' 受到 3 点雷电伤害', 'dmg');
        toDiscard([card, jc]);
        await damage(p, 3, null, 'thunder');
      } else {
        const alive = alivePlayers();
        const i = alive.indexOf(p);
        const next = alive[(i + 1) % alive.length];
        toDiscard([jc]);
        if (next && next !== p){
          next.judge.push(card);
          log('未命中：论文查重移动到 ' + next.name + ' 的通知栏', 'sys');
        } else toDiscard([card]);
      }
    } else {
      toDiscard([card, jc]);
    }
    if (window.UI) UI.render();
    await sleep(200);
    if (G.over) return;
  }
}

/* ---------------- 出牌阶段 ---------------- */
function playableList(p){
  const list = [];
  const seen = new Set();
  const hand = p.hand.slice();
  for (const c of hand){
    if (seen.has(c.name)) continue;
    const meta = CARDS[c.name];
    if (meta.kind === 'dodge' || meta.kind === 'nullify') continue;
    if (c.type === 'equip'){
      list.push({ card:c, count: hand.filter(x => x.name === c.name).length });
      seen.add(c.name);
      continue;
    }
    if (meta.kind === 'attack'){
      if (p.pointBan && c.name === '上课点名') continue;
      if (!canUseAttack(p, c)) continue;
    }
    if (meta.kind === 'heal' && p.hp >= p.maxHp) continue;   // 出牌阶段使用请假条要求体力未满
    if (c.type === 'delayed' && p.usedDelayed >= 1) continue;
    if (validTargets(p, c).length === 0 && !['aoeAttack','massHeal','harvest','draw2','lightning'].includes(meta.kind)) continue;
    list.push({ card:c, count: hand.filter(x => x.name === c.name).length });
    seen.add(c.name);
  }
  return list;
}
function canUseAttack(p, card){
  if (card.name === '上课点名'){
    if (p.pointBan) return false;
    if (p.equips.weapon && p.equips.weapon.name === '点名册') return true;
    return p.usedAttackCardThisPhase === 0;
  }
  return p.usedAttackCardThisPhase === 0;
}
function canUsePointCard(p){
  if (p.equips.weapon && p.equips.weapon.name === '点名册') return true;
  return p.usedAttackCardThisPhase === 0;
}
function usableSkills(p){
  const out = [];
  const add = (name, needTarget, extra) => {
    if (skillUsed(p, name)) return;
    extra = extra || {};
    if (extra.needCards && countPayable(p) < extra.needCards) return;
    out.push(Object.assign({ name, needTarget, desc: skillDesc(p, name) }, extra));
  };
  const has = n => hasSkill(p, n);
  if (has('吹牛')) add('吹牛', false);
  if (has('挂科')) add('挂科', true);
  if (has('系统')) add('系统', true);
  if (has('奉承')) add('奉承', true);
  if (has('施压')) add('施压', true);
  if (has('解密')) add('解密', true);
  if (has('概率')) add('概率', false);
  if (has('共情')) add('共情', true, { includeSelf:true, healOnly:true });
  if (has('透析')) add('透析', true, { includeSelf:true, needCards:2, healOnly:true });
  if (has('垂钓')) add('垂钓', false, { needCards:1 });
  if (has('窃听')) add('窃听', true);
  if (has('冲锋')) add('冲锋', true, { needCards:1, attackSkill:true });
  if (has('龙吟')) add('龙吟', true, { includeSelf:true });
  if (has('氪金')) add('氪金', false, { needCards:2 });
  if (has('划水')) add('划水', true, { needCards:1 });
  if (has('查寝')) add('查寝', true);
  if (has('侃山')) add('侃山', true);
  if (has('撒娇')) add('撒娇', true);
  if (has('治愈')) add('治愈', true, { needCards:1, includeSelf:true, healOnly:true });
  if (has('鸽王')) add('鸽王', true, { needCards:1 });
  // 武器转化技（电风扇 / 粉笔）—— 同样受"点名类牌每回合 1 张"的限制
  if (p.equips.weapon && p.equips.weapon.name === '电风扇'
      && p.hand.some(c => c.name === '上课点名') && canUseAttack(p, { name:'公开处刑' }))
    out.push({ name:'电风扇·转化', eqSkill:true, needTarget:true, desc:'将一张"上课点名"当"公开处刑"使用（火焰伤害）' });
  if (p.equips.weapon && p.equips.weapon.name === '粉笔'
      && p.hand.length >= 2 && canUseAttack(p, { name:'上课点名' }))
    out.push({ name:'粉笔·转化', eqSkill:true, needTarget:true, desc:'将两张手牌当一张"上课点名"使用' });
  return out;
}
function skillDesc(p, name){
  const s = p.char.skills.find(x => x.name === name);
  return s ? s.text : '';
}
function skillTargets(p, skill){
  const out = [];
  for (const t of alivePlayers()){
    if (t === p){
      if (skill.includeSelf || ['共情','透析','龙吟','治愈'].includes(skill.name)) out.push(t);
      continue;
    }
    if (skill.name === '挂科' || skill.name === '系统' || skill.name === '窃听'){
      if (t.hand.length && canBeHandTargeted(t)) out.push(t);
    } else if (skill.name === '奉承' || skill.name === '划水' || skill.name === '撒娇'){
      if (skill.name === '撒娇'){ if (t.hand.length) out.push(t); }
      else out.push(t);
    } else if (skill.name === '施压' || skill.name === '解密' || skill.name === '查寝'){
      if (skill.name === '解密' && (!t.hand.length)) continue;
      out.push(t);
    } else if (skill.name === '侃山'){ if (t.hand.length && p.hand.length) out.push(t); }
    else if (skill.name === '鸽王'){ out.push(t); }
    else if (skill.name === '冲锋'){ if (inAttackRange(p, t)) out.push(t); }
    else out.push(t);
  }
  if (skill.healOnly) return out.filter(t => t.hp < t.maxHp);
  return out;
}

async function playPhase(p){
  let guard = 0;
  while (!G.over && p.alive && !p.skip.play){
    if (guard++ > 60) break;
    // 电脑玩家行动前留出"思考时间"，让所有人看清它准备做什么
    if (!p.isHuman){
      if (window.FX) FX.thinking(p, true);
      await sleep(560);
      if (window.FX) FX.thinking(p, false);
    }
    const req = { kind:'playPhase', playable: playableList(p), skills: usableSkills(p) };
    const res = await Ask(p, req);
    if (!res || res.action === 'end' || (res.action && res.action.type === 'end')) break;
    const act = res.action;
    if (!act) break;
    if (act.type === 'card'){
      const card = act.card;
      if (!p.hand.includes(card)) continue;
      const meta = CARDS[card.name];
      let targets = act.targets || [];
      if (meta.kind === 'chain' && act.recast){
        removeFromHand(p, [card]); toDiscard(card);
        log(p.name + ' 重铸了 ' + cardText(card), 'sys');
        await drawCards(p, 1, '重铸');
        continue;
      }
      if (meta.kind === 'equip'){
        if (window.FX) await FX.cardPlay(p.name, card, '自己（装备到' + (card.slot === 'weapon' ? '武器' : card.slot === 'armor' ? '防具' : '坐骑') + '栏）', { sfx:'equip' });
        equipCard(p, card);
        continue;
      }
      await useCard(p, card, targets);
      if (card.name === '上课点名' || card.name === '公开处刑' || card.name === '雷同警告'){
        if (p.equips.weapon && p.equips.weapon.name === '点名册' && card.name === '上课点名'){ /* 不限 */ }
      }
    } else if (act.type === 'virtual'){
      // 武器转化：电风扇（点名→公开处刑）/ 粉笔（两张手牌→点名）
      const cost = act.cost || [];
      if (!cost.length || !cost.every(c => p.hand.includes(c))) continue;
      if (!canUseAttack(p, { name: act.asName })){        // 次数上限校验
        if (window.UI) UI.toast('本回合点名类牌已用满 1 张', 'warn');
        continue;
      }
      const vc = { name: act.asName, kind:'attack', dmg: act.dmg || 'normal',
                   type:'basic', suit: act.suit || 'C', rank: act.rank || 8, virtual:true };
      removeFromHand(p, cost);
      log(p.name + ' 转化使用：' + cost.map(cardText).join(' + ') + ' → ' + vc.name, 'sys');
      await useCard(p, vc, act.targets || []);
      if (window.UI) UI.render();
      continue;
    } else if (act.type === 'skill'){
      const s = act.skill;
      if (skillUsed(p, s.name)) continue;
      if (window.FX) FX.skillBanner(p.name, s.name);
      log('✦ ' + p.name + ' 发动【' + s.name + '】', 'sys');
      await SKILLS[s.name](p, act.targets || []);
      if (s.name !== '波比跳') markSkillUsed(p, s.name);
      if (['吹牛','挂科','系统','奉承','施压','解密','概率','共情','透析','垂钓','窃听','冲锋','龙吟','氪金','划水','查寝','侃山','撒娇','治愈','鸽王'].includes(s.name))
        markSkillUsed(p, s.name);
    }
    if (window.UI) UI.render();
    await sleep(300);        // 每次行动后停顿，方便看清结果
  }
}

/* =========================================================
 *  游戏启动
 * ========================================================= */
function initGame(opts){
  G.opts = opts || {};
  G.gen = (G.gen || 0) + 1;
  G.players = []; G.deck = []; G.discard = []; G.over = false; G.round = 1; G.turnId = 0;
  G.log = []; G.firstRound = true; G.roundDone = new Set(); G.harmLog = []; G.turnSeat = 0;
  const n = opts.count;
  const total = D.CHARACTERS.length;
  // 你（人类玩家）始终可以多选一；只要给每位电脑至少留 1 张武将即可
  const deal = Math.max(2, Math.min(opts.deal || 3, total - (n - 1)));
  const cfg = D.IDENTITY_CONFIG[n] || D.IDENTITY_CONFIG[5];
  // 身份池
  const idPool = [];
  for (const k of Object.keys(cfg)) for (let i=0;i<cfg[k];i++) idPool.push(k);
  shuffle(idPool);
  // 角色发放
  const charPool = shuffle(D.CHARACTERS.slice());
  const humanSeat = 0;
  const humanChoices = charPool.splice(0, Math.min(deal, charPool.length));
  G.dealPer = humanChoices.length;   // 人类玩家的候选数（供界面显示）
  G.charRest = charPool;             // 剩余武将池：电脑从这里挑
  for (let i=0;i<n;i++){
    const choices = (i === humanSeat) ? humanChoices : [];
    const player = {
      seat:i, char:null, charChoices:choices, identity:idPool[i],
      hp:0, maxHp:0, alive:true, hand:[], equips:{weapon:null,armor:null,mount:null},
      judge:[], chained:false, marks:{}, isHuman: (i === humanSeat),
      revealed: idPool[i] === 'dean', skillsUsedThisTurn:{}, usedCardsThisTurn:[],
      damageDealtThisTurn:0, usedAttackCardThisPhase:0, skip:{}, dodgeBan:false, pointBan:false
    };
    // 角色名以 getter 形式提供：p.name = 角色牌上的名字
    Object.defineProperty(player, 'name', {
      get(){ return this.char ? this.char.name : ('座位 ' + (this.seat + 1)); },
      enumerable: false, configurable: true
    });
    G.players.push(player);
  }
  G.humanSeat = humanSeat;
  window.G = G;
}
function finalizeGame(){
  const G2 = G;
  G2.deck = shuffle(D.buildDeck());
  G2.discard = [];
  // 院长先手
  const dean = G2.players.find(p => p.identity === 'dean');
  G2.turnSeat = dean.seat;
  // 体力与起手
  for (const p of G2.players){
    p.maxHp = p.char.hp + (p.identity === 'dean' ? 1 : 0);
    p.hp = p.maxHp;
  }
}
async function gameLoop(){
  const myGen = G.gen;
  while (!G.over && G.gen === myGen){
    const p = G.players[G.turnSeat];
    if (p && p.alive){
      await runTurn(p);
      if (G.over) break;
    }
    // 下一名存活角色
    let next = G.turnSeat;
    for (let i=1;i<=G.players.length;i++){
      const idx = (G.turnSeat + i) % G.players.length;
      if (G.players[idx].alive){ next = idx; break; }
    }
    if (next === G.turnSeat){ G.over = true; checkVictory(); break; }
    const wrapped = next <= G.turnSeat;
    G.turnSeat = next;
    if (G.players.filter(x=>x.alive).length <= 1) { checkVictory(); if (G.over) break; }
    if (wrapped){
      G.round++;
      G.firstRound = false;
      log('===== 第 ' + G.round + ' 轮开始 =====', 'big');
      if (G.round > 40){ logBig('回合数过多，判定平局'); G.over = true; break; }
    }
  }
  if (!G.over){ G.over = true; checkVictory(); }
}

window.Engine = {
  G, initGame, finalizeGame, gameLoop, Ask, useCard, damage, heal, drawCards,
  distance, attackRange, inAttackRange, handLimit, validTargets, playableList, usableSkills,
  skillTargets, hasSkill, cardText, alivePlayers, orderFrom, others, log, logBig, sleep,
  checkVictory, endGame, SEX, killPlayer,
  // 供自检与扩展使用
  isImmuneByCard, canUseAttack, allZoneCards, countPayable
};
})();
