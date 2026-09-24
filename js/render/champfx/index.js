// 英雄专属特效注册表（core）：并行加载 10 个英雄的 champfx 文件（单个文件缺失/出错不影响其他），registerChampionFX(fx) 逐个注册
export const CHAMPFX_IDS = ['garen', 'darius', 'leesin', 'masteryi', 'ahri', 'lux', 'annie', 'ashe', 'jinx', 'thresh'];

export const CHAMPFX_MODULES = {};   // id → register(fx)
export const champfxStatus = {};     // id → 'loaded' | 'registered' | 'missing' | 'error'

const results = await Promise.allSettled(CHAMPFX_IDS.map((id) => import(`./${id}.js`)));
results.forEach((r, i) => {
  const id = CHAMPFX_IDS[i];
  if (r.status === 'fulfilled' && typeof r.value?.default === 'function') {
    CHAMPFX_MODULES[id] = r.value.default;
    champfxStatus[id] = 'loaded';
  } else if (r.status === 'fulfilled') {
    champfxStatus[id] = 'missing';
    console.warn(`[champfx] ${id}.js 没有默认导出 register(fx)，已跳过`);
  } else {
    const err = r.reason;
    champfxStatus[id] = err instanceof SyntaxError ? 'error' : 'missing';
    // 语法错误属于代码缺陷（报错）；文件不存在只提示
    (err instanceof SyntaxError ? console.error : console.warn)(`[champfx] 加载 ${id}.js 失败，跳过该英雄特效：`, err?.message || err);
  }
});

// 向 FX 注册全部英雄特效；返回成功注册的英雄 id 列表
export function registerChampionFX(fx) {
  const done = [];
  if (!fx || typeof fx.registerCustom !== 'function') return done;
  for (const id of CHAMPFX_IDS) {
    const reg = CHAMPFX_MODULES[id];
    if (typeof reg !== 'function') continue;
    try {
      reg(fx);
      champfxStatus[id] = 'registered';
      done.push(id);
    } catch (err) {
      champfxStatus[id] = 'error';
      console.error(`[champfx] 注册 ${id} 特效失败：`, err);
    }
  }
  return done;
}

export default registerChampionFX;
