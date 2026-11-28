/**
 * C 规则引擎客户端。
 *
 * 生产 UI 优先调用 /api/v2/rules/*；服务不可用（离线打开、C 服务未启动、429 等）
 * 时由调用方回退到 public/modules 里的同名单函数。两边行为由
 * quality/scripts/check-rules-parity.mjs 逐字段核对。
 *
 * 本模块不读 DOM、不写 localStorage；只做 HTTP。
 *
 * 默认 3 秒超时：服务半死（端口在听但不应答）时，调用方能在 3 秒内拿到异常
 * 并回退本地实现，而不是让教练分析一直等下去。
 */

const ENDPOINTS = Object.freeze({
  coach: "/api/v2/rules/coach-score",
  timing: "/api/v2/rules/timing",
  replay: "/api/v2/rules/replay"
});

const DEFAULT_TIMEOUT_MS = 3000;

async function postJson(path, payload, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetch !== "function") throw new Error("当前环境不支持 fetch");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 调用方自带 signal 时也要能取消；AbortSignal.any 兼容性不足，这里手动桥接。
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      let message = `规则服务 HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error?.message) message = body.error.message;
      } catch { /* keep status message */ }
      throw new Error(message);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 四维教练评分。context 与浏览器本地 buildCoachScore 的第二个参数同形。 */
export function requestCoachScore(text, context = {}, options = {}) {
  return postJson(ENDPOINTS.coach, { text, context }, options);
}

/** 时机评分。input 与 scoreTiming 的参数同形。 */
export function requestTiming(input, options = {}) {
  return postJson(ENDPOINTS.timing, input, options);
}

/** 聊天回放：粘贴文本 -> { parse, analysis, summary }。 */
export function requestReplay(raw, options = {}) {
  return postJson(ENDPOINTS.replay, { text: raw }, options);
}
