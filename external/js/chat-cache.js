/* Session-scoped bounded cache. Never persists private data across sign-ins. */
(() => {
  class ChatCache {
    constructor(limit = 80) {
      this.limit = limit;
      this.values = new Map();
      this.pending = new Map();
      this.version = 0;
    }
    get(key, loader, ttl = 60000) {
      const hit = this.values.get(key);
      if (hit && hit.until > Date.now()) return Promise.resolve(hit.value);
      if (this.pending.has(key)) return this.pending.get(key);
      const version = this.version;
      const task = Promise.resolve()
        .then(loader)
        .then((value) => {
          if (version === this.version) {
            this.values.delete(key);
            this.values.set(key, { value, until: Date.now() + ttl });
            while (this.values.size > this.limit)
              this.values.delete(this.values.keys().next().value);
          }
          return value;
        })
        .finally(() => {
          if (this.pending.get(key) === task) this.pending.delete(key);
        });
      this.pending.set(key, task);
      return task;
    }
    invalidate(prefix = "") {
      this.version++;
      for (const key of this.values.keys())
        if (key.startsWith(prefix)) this.values.delete(key);
      for (const key of this.pending.keys())
        if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }
  window.ChatCache = ChatCache;
})();
