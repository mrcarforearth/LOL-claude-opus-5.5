// 奖励结算：英雄击杀赏金/连杀/终结/首杀/助攻/多杀/团灭、小兵与野怪金币经验、复活时间
import { GOLD, RANGES, RESPAWN_BASE, XP_SHARE_TABLE, MULTIKILL_WINDOW, PENTAKILL_WINDOW } from '../config.js';
import { creditChampion } from './damage.js';

// 复活时间：基础表 + 15 分钟后每分钟 +2%（上限 +50%）
export function respawnTime(level, time) {
  const base = RESPAWN_BASE[Math.max(1, Math.min(18, level)) - 1];
  const minutes = Math.max(0, Math.floor(time / 60) - 15);
  return base * (1 + Math.min(0.5, 0.02 * minutes));
}

// 击杀赏金：受害者连杀 ≥3 起每多 1 次 +100（上限 1000）；连死 ≥2 时每次 -15%（下限 100）
export function killBounty(victim) {
  let bounty = GOLD.KILL_BASE;
  const ks = victim.killStreak || 0;
  if (ks >= 3) bounty = Math.min(1000, GOLD.KILL_BASE + 100 * (ks - 2));
  const ds = victim.deathStreak || 0; // 此前的连续阵亡次数
  if (ks < 3 && ds >= 1) bounty = Math.max(100, GOLD.KILL_BASE * (1 - 0.15 * ds));
  return Math.round(bounty);
}

// 英雄击杀经验
export function killXp(victimLevel, killerLevel) {
  return (100 + 50 * victimLevel) * (1 + 0.15 * Math.max(0, victimLevel - killerLevel));
}

// 某队在某点范围内的存活英雄
export function nearbyChampions(game, team, x, y, range = RANGES.XP_SHARE) {
  const r2 = range * range;
  return game.champions.filter((c) => c.alive && c.team === team && (c.x - x) ** 2 + (c.y - y) ** 2 <= r2);
}

// 助攻者：10 秒内对受害者造成伤害/控制的敌方英雄
export function findAssisters(game, victim, killerChamp) {
  const since = game.time - RANGES.ASSIST_WINDOW;
  const out = [];
  for (const c of game.champions) {
    if (c === killerChamp || c === victim || c.team === victim.team) continue;
    const t = victim.damageLog.get(c.championId);
    if (t != null && t >= since) out.push(c);
  }
  return out;
}

// 解析击杀归属英雄：英雄/宠物主人；否则取 10 秒内最后一个造成伤害的敌方英雄
export function resolveKillerChampion(game, victim, killer) {
  const c = creditChampion(killer);
  if (c && c.team !== victim.team) return c;
  if (victim.type === 'champion') {
    const since = game.time - RANGES.ASSIST_WINDOW;
    let best = null, bestT = -Infinity;
    for (const ch of game.champions) {
      if (ch.team === victim.team) continue;
      const t = victim.damageLog.get(ch.championId);
      if (t != null && t >= since && t > bestT) { best = ch; bestT = t; }
    }
    return best;
  }
  return null;
}

const MULTI_KEYS = [null, null, 'doubleKill', 'tripleKill', 'quadraKill', 'pentaKill'];
const MULTI_TEXT = [null, null, '双杀！', '三杀！', '四杀！', '五杀！'];
function streakKey(n) {
  if (n >= 7) return ['legendary', '超神！'];
  if (n === 6) return ['godlike', '变态杀戮！'];
  if (n === 5) return ['unstoppable', '无人能挡！'];
  if (n === 4) return ['rampage', '主宰比赛！'];
  if (n === 3) return ['killingSpree', '大杀特杀！'];
  return null;
}

// 英雄阵亡结算
export function championKillRewards(game, victim, killer) {
  const now = game.time;
  const killerChamp = resolveKillerChampion(game, victim, killer);
  const assisters = findAssisters(game, victim, killerChamp);
  const executed = !killerChamp;
  const shutdown = !!killerChamp && (victim.killStreak || 0) >= 3;
  const baseBounty = killBounty(victim);
  let bounty = baseBounty;
  let firstBlood = false;
  let multiKill = 0;
  let streak = 0;
  const benefitTeam = victim.team === 0 ? 1 : 0;

  if (killerChamp) {
    if (!game.firstBloodDone) { firstBlood = true; game.firstBloodDone = true; bounty += GOLD.FIRST_BLOOD_BONUS; }
    killerChamp.gainGold(bounty, 'kill', victim.x, victim.y);
    killerChamp.kills++;
    killerChamp.killStreak = (killerChamp.killStreak || 0) + 1;
    killerChamp.deathStreak = 0;
    streak = killerChamp.killStreak;
    // 多杀
    const prev = killerChamp.multiKillCount || 0;
    const window = prev === 4 ? PENTAKILL_WINDOW : MULTIKILL_WINDOW;
    multiKill = (prev > 0 && now - (killerChamp.lastKillTime ?? -999) <= window) ? prev + 1 : 1;
    killerChamp.multiKillCount = multiKill;
    killerChamp.lastKillTime = now;
    killerChamp.largestMultiKill = Math.max(killerChamp.largestMultiKill || 0, multiKill);
    game.teams[killerChamp.team].kills++;
    // 助攻金币：基础赏金 50% 平分（首杀奖励只给击杀者）
    if (assisters.length) {
      const share = Math.round((baseBounty * GOLD.ASSIST_SHARE) / assisters.length);
      for (const a of assisters) {
        a.assists++;
        a.deathStreak = 0;
        a.gainGold(share, 'assist', victim.x, victim.y);
      }
    }
    // 经验：击杀者与 1600 内助攻者平分
    const r2 = RANGES.XP_SHARE * RANGES.XP_SHARE;
    const recipients = [killerChamp, ...assisters.filter((a) => a.alive && (a.x - victim.x) ** 2 + (a.y - victim.y) ** 2 <= r2)];
    const xp = killXp(victim.level, killerChamp.level);
    for (const r of recipients) r.gainXp(xp / recipients.length);
  } else {
    // 被处决：助攻者仍计助攻（无英雄伤害时为空）
    for (const a of assisters) { a.assists++; }
  }

  victim.deaths++;
  victim.killStreak = 0;
  victim.deathStreak = (victim.deathStreak || 0) + 1;
  victim.multiKillCount = 0;

  // 团灭判定
  const teamChamps = game.champions.filter((c) => c.team === victim.team);
  let ace = false;
  if (teamChamps.length >= 2 && teamChamps.every((c) => !c.alive) && !game._aceActive[victim.team]) {
    ace = true;
    game._aceActive[victim.team] = true;
  }

  game.events.emit('championKill', {
    victim, killer, killerChampion: killerChamp, assists: assisters, bounty: killerChamp ? bounty : 0,
    shutdown, firstBlood, multiKill, streak, executed, ace,
  });

  // 播报（每次击杀一条主播报，团灭单独播报）
  const vName = victim.displayName || victim.name;
  if (executed) {
    game.announce('executed', `${vName} 被处决`, { team: benefitTeam, killer, victim, subject: victim });
  } else {
    const kName = killerChamp.displayName || killerChamp.name;
    const extra = { team: killerChamp.team, killer: killerChamp, victim, subject: killerChamp };
    if (multiKill >= 2 && multiKill <= 5) {
      game.announce(MULTI_KEYS[multiKill], MULTI_TEXT[multiKill], extra);
      if (shutdown) game.announce('shutdown', '终结！', extra);
    } else if (firstBlood) game.announce('firstBlood', '第一滴血！', extra);
    else if (shutdown) game.announce('shutdown', '终结！', extra);
    else {
      const sk = streakKey(streak);
      if (sk) game.announce(sk[0], sk[1], extra);
      else game.announce('kill', `${kName} 击杀了 ${vName}`, extra);
    }
  }
  if (ace) game.announce('ace', '团灭！', { team: benefitTeam, killer: killerChamp, victim, subject: null });

  if (killerChamp) killerChamp.runHooks('onTakedown', victim);
  for (const a of assisters) a.runHooks('onTakedown', victim);
  return { killerChamp, assisters, bounty, executed, shutdown, firstBlood, multiKill, ace };
}

// 小兵：金币给最后一击英雄；经验给 1600 内所有敌方英雄（分享表）
export function minionKillRewards(game, minion, killer) {
  const credit = creditChampion(killer);
  if (credit && credit.team !== minion.team) {
    if (minion.goldValue > 0) credit.gainGold(minion.goldValue, 'minion', minion.x, minion.y);
    credit.cs++;
  }
  const xp = minion.xpValue || 0;
  if (xp <= 0) return;
  const r2 = RANGES.XP_SHARE * RANGES.XP_SHARE;
  const champs = game.champions.filter((c) => c.alive && c.team !== minion.team && c.team !== 2 && (c.x - minion.x) ** 2 + (c.y - minion.y) ** 2 <= r2);
  if (champs.length === 0) return;
  const share = XP_SHARE_TABLE[Math.min(5, champs.length)];
  for (const c of champs) c.gainXp(xp * share);
}

// 野怪：金币经验给击杀者；史诗怪经验给击杀方全部英雄
export function monsterKillRewards(game, monster, killer) {
  const credit = creditChampion(killer);
  if (!credit) return null;
  if (monster.goldValue > 0) credit.gainGold(monster.goldValue, 'monster', monster.x, monster.y);
  credit.cs += monster.csValue ?? 1;
  credit.jungleCs = (credit.jungleCs || 0) + (monster.csValue ?? 1);
  const xp = monster.xpValue || 0;
  if (xp > 0) {
    if (monster.epic) for (const c of game.champions) { if (c.team === credit.team) c.gainXp(xp); }
    else credit.gainXp(xp);
  }
  return credit;
}

// 守卫被摧毁
export function wardKillRewards(game, ward, killer) {
  const credit = creditChampion(killer);
  if (!credit || credit.team === ward.team) return;
  if (ward.goldValue > 0) credit.gainGold(ward.goldValue, 'objective', ward.x, ward.y);
  if (ward.xpValue > 0) credit.gainXp(ward.xpValue);
  credit.wardsKilled = (credit.wardsKilled || 0) + 1;
}
