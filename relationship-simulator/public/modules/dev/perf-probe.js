/**
 * A-05 性能探针（开发工具，不进应用链路，不由 app.js import）。
 *
 * 为什么必须在浏览器里量：规范 §2.1 要求全部时间用客户端 performance.now()，
 * t1 是「首个非空正文完成首字符可见 DOM 更新」，t2 是「完整正文呈现」。
 * Node 侧只能量到代理返回的总时间，量不到用户真正看见字的时刻 —— 那正是 A-05 的判定对象。
 *
 * 红线：探针**不写** localStorage、不动 state、不提交角色消息。它把回复渲染进一个自建的
 * 隔离节点（真实参与布局，所以首字更新是真的 paint 事件），测完即删。
 * 本仓有过一次浏览器实验把消息写进用户真实会话，代价是用户数据被污染。
 *
 * 通道配置由调用方传入：探针自己不复制一份 HER_LANE。评测脚本与 app.js 各写一份通道配置
 * 已经骗过我们一轮（测的不是跑的那套），所以这里的约定是「新脚本要加就进 parity 测试清单」。
 */

const PROBE_HOST_STYLE = "position:fixed;left:-9999px;top:0;width:320px;pointer-events:none";
const FRAME_WAIT_TIMEOUT_MS = 3000;

/**
 * 下一帧。必须带兜底超时：标签页在后台时 rAF 永远不触发（实测 visibilityState=hidden 时挂死），
 * 而「挂死」比「数值略粗」危险得多 —— 它会吃掉整轮付费采样。
 * 超时口径写进 t2Source 一并上报，报告里不许把降级值当真实 paint 时刻。
 */
const nextFrame = () => new Promise((resolve) => {
  let settled = false;
  const done = (value, source) => {
    if (settled) return;
    settled = true;
    resolve({ at: value, source });
  };
  requestAnimationFrame(() => done(performance.now(), "raf"));
  setTimeout(() => done(performance.now(), "frame-timeout"), FRAME_WAIT_TIMEOUT_MS);
});

/**
 * 可见性闸门：页面不可见时**不能**做延迟测量，没有降级模式。
 * 彩排实测（2026-11-04）：隐藏标签页里 setTimeout(200) 被钳到 ~950ms，rAF 完全不触发 ——
 * 也就是说连一个可控的假响应都量不准。既然计时器本身不可信，就不存在「只取 TTFC 也凑合」的口径，
 * 加降级模式只会产出一批看着像数据的数字。要跑就把窗口放到前台。
 */
export function visibilityBlocker() {
  if (typeof document === "undefined") return "非浏览器环境：A-05 的 t1（首字可见）只能用客户端 performance.now() 量";
  if (document.visibilityState !== "visible") return `页面 visibilityState=${document.visibilityState}：rAF 不触发、定时器被钳到 ~1s，任何延迟数字都不可信`;
  return "";
}

function firstTextNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue.trim()) return node;
  }
  return null;
}

/**
 * 单条采样。t1 用 MutationObserver 抓「首个非空正文节点出现」的 performance.now()，
 * 不等打字动画，也不把骨架屏算作首字（规范 §2.1 明令禁止的两种自欺口径）。
 * 当前链路 stream=false，t1 与 t2 会同帧 —— 如实记录，不粉饰。
 */
export async function measureOne({ lane, buildMessages, label = "", callLLM, signal }) {
  if (!lane) throw new Error("measureOne 需要 lane（角色通道配置），探针不内置第二真理来源");
  const blocked = visibilityBlocker();
  if (blocked) {
    // 必须在任何网络请求之前拒绝：后台标签页里跑一轮，等于把 40 次付费换成一堆假数字。
    return { label, ok: false, error: `拒绝采样：${blocked}`, t1Ms: null, t2Ms: null, promptTokens: null, completionTokens: null, finishReason: "", contentChars: 0, t2Source: "", requestsSent: 0, storageBefore: "", storageAfter: "" };
  }
  const host = document.createElement("div");
  host.className = "hf-perf-probe";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = PROBE_HOST_STYLE;
  const bubble = document.createElement("div");
  bubble.className = "hf-perf-bubble";
  host.appendChild(bubble);
  document.body.appendChild(host);

  let t0 = 0;
  let resolveFirstChar;
  const firstCharSeen = new Promise((resolve) => { resolveFirstChar = resolve; });
  const observer = new MutationObserver(() => {
    if (firstTextNode(bubble)) {
      observer.disconnect();
      resolveFirstChar(performance.now());
    }
  });
  observer.observe(bubble, { childList: true, subtree: true, characterData: true });

  const sample = {
    label,
    ok: false,
    error: "",
    t1Ms: null,
    t2Ms: null,
    promptTokens: null,
    completionTokens: null,
    finishReason: "",
    contentChars: 0,
    t2Source: "",
    requestsSent: 0,
    storageBefore: "",
    storageAfter: ""
  };
  sample.requestsSent = 1;
  sample.storageBefore = String(localStorage.length);
  try {
    t0 = performance.now();
    const result = await callLLM({ ...lane, messages: buildMessages(), signal });
    const content = String(result.content || "");
    // 顺序不能反：t1 由 MutationObserver 在正文进 DOM 之后回调，先把正文插进去，
    // 再 await 那个回调；先 await 就永远等不到。t2 取下一帧，量的是「真的画出来了」，
    // 不是「JS 拿到了字符串」。stream=false 时 t1≈t2，这是架构等式，不是测量误差。
    bubble.textContent = content;
    const painted = await nextFrame();
    sample.t1Ms = Math.min((await firstCharSeen) - t0, painted.at - t0);
    sample.t2Ms = painted.at - t0;
    sample.t2Source = painted.source;
    sample.ok = true;
    sample.contentChars = content.length;
    const usage = result.raw?.usage || {};
    sample.promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? null;
    sample.completionTokens = usage.completion_tokens ?? usage.output_tokens ?? null;
    sample.finishReason = result.raw?.choices?.[0]?.finish_reason || "";
  } catch (error) {
    observer.disconnect();
    resolveFirstChar(performance.now());
    sample.t2Ms = performance.now() - t0;
    sample.t1Ms = null;
    sample.error = String(error?.message || error).slice(0, 200);
  } finally {
    observer.disconnect();
    host.remove();
    sample.storageAfter = String(localStorage.length);
  }
  return sample;
}

/** 逐条串行采样：并发会把网络排队算进延迟，而 SLO 要量的是用户单轮体验。 */
export async function runPerfBatch(cases, { onEach = () => {}, ...shared } = {}) {
  const blocked = visibilityBlocker();
  if (blocked) throw new Error(`拒绝开始采样（0 次请求）：${blocked}。把应用窗口切到前台可见再跑。`);
  const out = [];
  for (const item of cases) {
    const sample = await measureOne({ ...shared, label: item.id, buildMessages: item.buildMessages });
    out.push(sample);
    onEach(sample, out.length);
  }
  return out;
}

/** 采样后自检：探针没碰用户数据。任一不符即报废本轮数据，不能只当警告。 */
export function probeHygiene(samples) {
  const leaked = samples.filter((item) => item.storageBefore !== item.storageAfter).map((item) => item.label);
  const leftovers = document.querySelectorAll(".hf-perf-probe").length;
  return { leaked, leftovers, clean: !leaked.length && !leftovers };
}
