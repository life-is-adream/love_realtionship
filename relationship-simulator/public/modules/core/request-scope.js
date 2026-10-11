/** 管理异步工作的所有权。只依赖调用者提供的上下文，不依赖 DOM、store 或网络。 */
export function createRequestScope(captureContext) {
  const pending = new Map();
  return {
    begin(channel) {
      pending.get(channel)?.controller.abort();
      const entry = { controller: new AbortController(), context: captureContext() };
      pending.set(channel, entry);
      return {
        signal: entry.controller.signal,
        isCurrent: () => pending.get(channel) === entry && !entry.controller.signal.aborted && captureContext() === entry.context,
        finish: () => { if (pending.get(channel) === entry) pending.delete(channel); }
      };
    },
    cancelAll() {
      for (const entry of pending.values()) entry.controller.abort();
      pending.clear();
    }
  };
}
