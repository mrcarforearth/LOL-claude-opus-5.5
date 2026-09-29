// 局域网客户端：WebSocket（浏览器与 Node 24 内置 WebSocket 通用）+ JSON 消息分发
export function lanWsUrl(loc = globalThis.location) {
  return `${loc?.protocol === 'https:' ? 'wss' : 'ws'}://${loc?.host || 'localhost'}/ws`;
}

export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.open = false;
    this.closed = false;
    this.id = null;
    this._handlers = new Map();
  }
  // 连接；成功 resolve，失败/超时 reject
  connect(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(this);
      };
      const timer = setTimeout(() => { done(new Error('连接超时')); try { this.ws?.close(); } catch { /* 忽略 */ } }, timeoutMs);
      let ws;
      try { ws = new WebSocket(this.url); } catch (err) { done(err); return; }
      this.ws = ws;
      ws.onopen = () => { this.open = true; done(); };
      ws.onerror = () => done(new Error('无法连接局域网服务'));
      ws.onclose = (e) => {
        const was = this.open;
        this.open = false;
        this.closed = true;
        done(new Error('连接已关闭'));
        if (was) this._emit('close', { code: e?.code, reason: e?.reason });
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        this._emit(msg.type, msg);
        this._emit('*', msg);
      };
    });
  }
  // 订阅消息类型（'*' 为全部，'close' 为断开）；返回取消订阅函数
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }
  _emit(type, msg) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(msg); } catch (err) { console.error(`[局域网] 处理消息 ${type} 出错：`, err); }
    }
  }
  send(obj) {
    if (!this.open || !this.ws) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  close() { try { this.ws?.close(1000); } catch { /* 忽略 */ } }
}
