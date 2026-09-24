// 同步事件总线：监听器异常只记录，不打断其余监听器与模拟
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(name, fn) {
    let list = this.handlers.get(name);
    if (!list) { list = []; this.handlers.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const wrap = (payload) => { this.off(name, wrap); fn(payload); };
    wrap._orig = fn;
    return this.on(name, wrap);
  }

  off(name, fn) {
    const list = this.handlers.get(name);
    if (!list) return;
    const i = list.findIndex((h) => h === fn || h._orig === fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, payload) {
    const list = this.handlers.get(name);
    if (!list || list.length === 0) return;
    // 拷贝一份，允许监听器在回调中取消订阅
    const snapshot = list.length === 1 ? list : list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        console.error(`[事件 ${name}] 监听器出错：`, err);
      }
    }
  }

  clear() { this.handlers.clear(); }
}
