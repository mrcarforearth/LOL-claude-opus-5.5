// 空特效系统：无头模式使用，所有方法均为空操作并返回假句柄
const FAKE_HANDLE = Object.freeze({ remove() {}, alive: false, object3d: null });
const noop = () => FAKE_HANDLE;

function makeProxy() {
  return new Proxy({ isNull: true }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // 避免被当成 Promise / 原始值
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return noop;
    },
    set() { return true; },
  });
}

// new NullFX() 返回 Proxy：fx.anything(...) → { remove(){}, alive:false }
export class NullFX {
  constructor() { return makeProxy(); }
}

export const nullFX = makeProxy();
export { FAKE_HANDLE };
