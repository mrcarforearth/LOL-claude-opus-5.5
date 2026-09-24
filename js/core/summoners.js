// 召唤师技能：闪现、引燃、治疗术、屏障、虚弱、幽灵疾步、净化、惩戒、传送（数值见 ARCHITECTURE §4.15）
import { byLevel } from './math.js';

const icon = (glyph, c1, c2) => ({ glyph, bg: [c1, c2], fg: '#fff' });

export const SUMMONERS = {
  flash: {
    id: 'flash', name: '闪现', cooldown: 300, range: 400, targeting: 'point', clampRange: true,
    icon: icon('闪', '#ffe98a', '#b8860b'),
    desc: () => '将你的英雄向鼠标方向瞬间传送最多 400 码的距离，可穿过墙体。',
    cast(champ, ctx) {
      const game = champ.game;
      const fromX = champ.x, fromY = champ.y;
      game.fx.flash({ x: fromX, y: fromY, color: 0xfff4a0 });
      champ.faceTowards(ctx.x, ctx.y);
      champ.blink(ctx.x, ctx.y);
      game.fx.flash({ x: champ.x, y: champ.y, color: 0xfff4a0 });
      return true;
    },
  },
  ignite: {
    id: 'ignite', name: '引燃', cooldown: 180, range: 600, targeting: 'unit', targetFilter: 'enemyChampion',
    icon: icon('燃', '#ff8a3a', '#7a1a00'),
    desc: (champ) => `引燃目标敌方英雄，在 5 秒内造成共 ${Math.round(70 + 20 * (champ?.level || 1))} 点真实伤害，使其受到的治疗效果降低 40%，并暴露其位置。`,
    cast(champ, ctx) {
      const t = ctx.target;
      if (!t || !t.alive) return false;
      const total = 70 + 20 * champ.level;
      t.addBuff({
        id: 'ignite', name: '引燃', desc: '持续受到真实伤害，治疗效果降低 40%', icon: SUMMONERS.ignite.icon,
        source: champ, duration: 5, isDebuff: true, cleansable: true, refresh: 'replace',
        stats: { grievous: 0.4 }, tickInterval: 1,
        onApply(u) { u.revealedUntil = Math.max(u.revealedUntil, champ.game.time + 5); },
        onInterval(u) { champ.game.dealDamage(champ, u, total / 5, 'true', { isDot: true, spell: 'ignite', noLifesteal: true }); },
      });
      champ.game.fx.attach({ unit: t, kind: 'flames', color: 0xff6a1a, duration: 5 });
      return true;
    },
  },
  heal: {
    id: 'heal', name: '治疗术', cooldown: 240, range: 850, targeting: 'self',
    icon: icon('疗', '#8af07a', '#1a6a20'),
    desc: (champ) => `为你和 850 码内生命值百分比最低的友方英雄回复 ${Math.round(80 + 15 * (champ?.level || 1))} 生命值，并提供 30% 移动速度，持续 1 秒。`,
    cast(champ) {
      const game = champ.game;
      const amount = 80 + 15 * champ.level;
      const targets = [champ];
      let best = null;
      for (const c of game.champions) {
        if (c === champ || !c.alive || c.team !== champ.team) continue;
        if (champ.distTo(c) > 850) continue;
        if (!best || c.hp / c.maxHp < best.hp / best.maxHp) best = c;
      }
      if (best) targets.push(best);
      for (const u of targets) {
        game.heal(champ, u, amount, { spell: 'heal' });
        u.addBuff({ id: 'summoner_heal_ms', name: '治疗术', hidden: true, duration: 1, source: champ, stats: { moveSpeedPct: 0.3 } });
        game.fx.attach({ unit: u, kind: 'heal', color: 0x7cff7a, duration: 1 });
      }
      return true;
    },
  },
  barrier: {
    id: 'barrier', name: '屏障', cooldown: 180, range: 0, targeting: 'self',
    icon: icon('障', '#ffe28a', '#8a6a10'),
    desc: (champ) => `为你的英雄提供 ${Math.round(105 + 15 * (champ?.level || 1))} 点护盾，持续 2.5 秒。`,
    cast(champ) {
      champ.addShield(105 + 15 * champ.level, 2.5, { source: champ, id: 'barrier', noPower: true });
      champ.game.fx.shield({ unit: champ, color: 0xffe07a, duration: 2.5, radius: 110 });
      return true;
    },
  },
  exhaust: {
    id: 'exhaust', name: '虚弱', cooldown: 210, range: 650, targeting: 'unit', targetFilter: 'enemyChampion',
    icon: icon('弱', '#c07aff', '#3a1a6a'),
    desc: () => '虚弱目标敌方英雄，使其移动速度降低 30%，造成的伤害降低 40%，持续 3 秒。',
    cast(champ, ctx) {
      const t = ctx.target;
      if (!t || !t.alive) return false;
      t.slow(0.3, 3, champ);
      t.addBuff({ id: 'exhaust', name: '虚弱', desc: '造成的伤害降低 40%', icon: SUMMONERS.exhaust.icon, source: champ, duration: 3, isDebuff: true, cleansable: true, stats: { damageDealtReduction: 0.4 } });
      champ.game.fx.attach({ unit: t, kind: 'frost', color: 0xb07aff, duration: 3 });
      return true;
    },
  },
  ghost: {
    id: 'ghost', name: '幽灵疾步', cooldown: 210, range: 0, targeting: 'self',
    icon: icon('疾', '#7ae0ff', '#10506a'),
    desc: (champ) => `获得 ${Math.round(byLevel(champ?.level || 1, 24, 48))}% 移动速度并忽略单位碰撞，持续 10 秒。`,
    cast(champ) {
      const pct = byLevel(champ.level, 0.24, 0.48);
      champ.addBuff({ id: 'ghost', name: '幽灵疾步', desc: '移动速度提升', icon: SUMMONERS.ghost.icon, source: champ, duration: 10, ghosted: true, stats: { moveSpeedPct: pct } });
      champ.game.fx.attach({ unit: champ, kind: 'haste', color: 0x9ae8ff, duration: 10 });
      return true;
    },
  },
  cleanse: {
    id: 'cleanse', name: '净化', cooldown: 210, range: 0, targeting: 'self', usableWhileCC: true, // 被控制时也可施放（压制/击飞除外）
    icon: icon('净', '#aef0ff', '#1a5a7a'),
    desc: () => '移除身上所有的控制效果（压制和击飞除外）及召唤师技能减益，并获得 65% 韧性，持续 3 秒。',
    cast(champ) {
      champ.cleanse();
      champ.removeBuff('ignite');
      champ.removeBuff('exhaust');
      champ.addBuff({ id: 'cleanse', name: '净化', desc: '韧性提升', icon: SUMMONERS.cleanse.icon, source: champ, duration: 3, stats: { tenacity: 0.65 } });
      champ.game.fx.burst({ x: champ.x, y: champ.y, h: 100, color: 0xbff4ff, count: 24, size: 18, speed: 260 });
      return true;
    },
  },
  smite: {
    id: 'smite', name: '惩戒', cooldown: 90, range: 500, targeting: 'unit', targetFilter: 'enemy', maxCharges: 2, rechargeTime: 90,
    icon: icon('惩', '#ffcf5a', '#7a4a00'),
    desc: () => '对目标野怪或小兵造成 600 点真实伤害。对大型野怪使用时，回复 90 + 10% 最大生命值。可储存 2 层。',
    canTarget: (champ, t) => t && (t.type === 'monster' || t.type === 'minion'),
    cast(champ, ctx) {
      const t = ctx.target;
      if (!t || !t.alive || (t.type !== 'monster' && t.type !== 'minion')) return false;
      const game = champ.game;
      game.fx.beam({ x1: t.x, y1: t.y, x2: t.x, y2: t.y, h: 600, from: null, to: t, width: 50, color: 0xffd75a, duration: 0.3 });
      game.fx.impact({ x: t.x, y: t.y, color: 0xffd75a, size: 1.5 });
      game.dealDamage(champ, t, 600, 'true', { spell: 'smite', noLifesteal: true });
      if (t.type === 'monster' && (t.large !== false)) game.heal(champ, champ, 90 + 0.1 * champ.maxHp, { spell: 'smite' });
      return true;
    },
  },
  teleport: {
    id: 'teleport', name: '传送', cooldown: 360, range: Infinity, targeting: 'point', clampRange: false,
    icon: icon('传', '#c79aff', '#3a1a7a'),
    desc: () => '引导 4 秒后，将你的英雄传送到目标友方防御塔、小兵或守卫旁边。',
    // 在目标点附近寻找友方锚点（防御塔/小兵/守卫）
    findAnchor(champ, x, y, target) {
      const ok = (u) => u && u.alive && u.team === champ.team && (u.type === 'turret' || u.type === 'minion' || u.type === 'ward');
      if (ok(target)) return target;
      const game = champ.game;
      let best = null, bd = 1200 * 1200;
      for (const list of [game.structures, game.minions, game.wards]) {
        for (const u of list) {
          if (!ok(u) || u.tier === 'fountain') continue;
          const d = (u.x - x) ** 2 + (u.y - y) ** 2;
          if (d < bd) { bd = d; best = u; }
        }
      }
      return best;
    },
    cast(champ, ctx) {
      const game = champ.game;
      const def = SUMMONERS.teleport;
      const anchor = def.findAnchor(champ, ctx.x, ctx.y, ctx.target);
      if (!anchor) return false;
      game.fx.ring({ x: anchor.x, y: anchor.y, radius: 180, color: 0xb07aff, duration: 4, expand: false });
      game.fx.attach({ unit: champ, kind: 'sparkles', color: 0xb07aff, duration: 4 });
      const st = ctx.summonerState;
      champ.startChannel({
        id: 'teleport', duration: 4, interruptOnMove: true, interruptOnDamage: false, anim: 'channel',
        onComplete: () => {
          if (!anchor.alive) return;
          const a = Math.atan2(champ.y - anchor.y, champ.x - anchor.x);
          const off = (anchor.radius || 50) + champ.radius + 30;
          champ.setPosition(anchor.x + Math.cos(a) * off, anchor.y + Math.sin(a) * off);
          game.fx.flash({ x: champ.x, y: champ.y, color: 0xb07aff });
        },
        onInterrupt: () => {
          // 被打断：冷却缩短为 200 秒
          if (st) st.cooldownUntil = Math.min(st.cooldownUntil, game.time + 200);
        },
      });
      return true;
    },
  },
};

// 召唤师技能状态
export class SummonerState {
  constructor(champ, key, id) {
    this.champ = champ;
    this.key = key;
    this.id = id;
    this.def = SUMMONERS[id] || SUMMONERS.flash;
    this.cooldownUntil = 0;
    this.cdDuration = this.def.cooldown;
    this.maxCharges = this.def.maxCharges || 0;
    this.charges = this.maxCharges || null;
    this.rechargeAt = 0;
    this.state = {};
  }
  get ready() {
    const now = this.champ.game.time;
    if (this.maxCharges) return this.charges > 0 && now >= this.cooldownUntil;
    return now >= this.cooldownUntil;
  }
  get cdRemaining() {
    const now = this.champ.game.time;
    if (this.maxCharges && this.charges <= 0) return Math.max(0, this.rechargeAt - now);
    return Math.max(0, this.cooldownUntil - now);
  }
  // 消耗一次使用（充能或冷却）
  consume() {
    const now = this.champ.game.time;
    if (this.maxCharges) {
      if (this.charges === this.maxCharges) this.rechargeAt = now + (this.def.rechargeTime || this.def.cooldown);
      this.charges--;
      this.cooldownUntil = now + 0.25;
      this.cdDuration = this.def.rechargeTime || this.def.cooldown;
    } else {
      this.cdDuration = this.def.cooldown;
      this.cooldownUntil = now + this.def.cooldown;
    }
  }
  update() {
    if (!this.maxCharges || this.charges >= this.maxCharges) return;
    const now = this.champ.game.time;
    if (now >= this.rechargeAt) {
      this.charges++;
      if (this.charges < this.maxCharges) this.rechargeAt = now + (this.def.rechargeTime || this.def.cooldown);
    }
  }
}
