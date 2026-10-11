/** Apply one timeout to fetching headers and reading the body, and cancel on disconnect. */
export async function withUpstreamRequest(res, timeoutMs, request) {
  const controller = new AbortController();
  const onDisconnect = () => {
    if (!res.writableEnded) controller.abort(new DOMException("Client disconnected", "AbortError"));
  };
  const timeout = setTimeout(() => controller.abort(new DOMException("Upstream timed out", "TimeoutError")), timeoutMs);
  timeout.unref?.();
  res.on?.("close", onDisconnect);
  try {
    if (res.destroyed || res.writableEnded) controller.abort(new DOMException("Client disconnected", "AbortError"));
    controller.signal.throwIfAborted();
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
    res.off?.("close", onDisconnect);
  }
}
