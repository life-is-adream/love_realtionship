// A/B/C 与角色回复的**行为**评测（付费、opt-in，不在 npm test 里）。
//
// 为什么需要这一层：npm test 的 900+ 个断言只能验证「已覆盖的功能没违反现有断言」，
// 证明不了「她像不像真人」「三条建议有没有回答她的问题」。这两件事需要模型裁判。
//
// 用法：
//   node scripts/eval-behavior.mjs              干跑：只打印用例、token 与费用预估，不联网
//   node scripts/eval-behavior.mjs --yes        真正执行（会调用付费 API）
//   可选：--limit=3 --base-url=http://127.0.0.1:3000 --out=docs/verification/xxx.md
//
// 密钥不进这个脚本：请求走本地代理，钥匙只存在于服务端 .env，报告里也就不会泄漏它。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { builtInPersonas } from "../public/modules/core/config.js";
import { buildHerMessages, buildCoachMessages, callLLM } from "../public/modules/core/api-client.js";
import { parseModelContent, extractJsonObject, normalizeReplyOptions } from "../public/modules/coach/parser.js";
import { parseHerBubbles, joinHerReply } from "../public/modules/coach/her-reply.js";

const args = process.argv.slice(2);
const flag = (name) => args.some((item) => item === `--${name}`);
const opt = (name, fallback) => args.find((item) => item.startsWith(`--${name}=`))?.slice(`--${name}=`.length) ?? fallback;
const BASE_URL = opt("base-url", "http://127.0.0.1:3000").replace(/\/$/, "");
const LIMIT = Number(opt("limit", "99"));
const OUT = opt("out", "");
const RUN = flag("yes");
/** --coach-json：给教练通道开 MiMo 的 JSON 模式，用来和默认输出做 A/B 对比。 */
const COACH_JSON = flag("coach-json");
/** --coach-nothinking：教练通道也关思考，用来量「推理 token ↔ 延迟 ↔ 质量」的交换比。 */
const COACH_NO_THINKING = flag("coach-nothinking");

/** 与 public/app.js 的 HER_LANE 保持一致；改这里必须同步改那边。 */
const HER_LANE = Object.freeze({ thinking: { type: "disabled" }, maxCompletionTokens: 200 });
const JUDGE_LANE = Object.freeze({ thinking: { type: "disabled" }, maxCompletionTokens: 800 });

// 价格量级估计：输入未命中缓存 ¥1/M。输出价与缓存价请按 mimo.mi.com 当前价目核对。
const PRICE_INPUT_PER_M = 1;
const PRICE_OUTPUT_PER_M = 2;
const CHARS_PER_TOKEN = 1.4;

/** 固定用例：每条都是「我」刚发出去的一句，考察教练与角色在她追问时的表现。 */
const CASES = [
  { id: "q-exhibit", mine: "周末有个画展，要不要一起去看？", stage: "初聊", goal: "把邀约说清楚" },
  { id: "q-food", mine: "我知道有家云南菜很可以，改天带你去。", stage: "初聊", goal: "自然约一次饭" },
  { id: "q-study", mine: "你这周是不是又在赶论文？", stage: "熟络", goal: "表达关心但不施压" },
  { id: "a-cold", mine: "昨天发你的消息你是不是没看到？", stage: "熟络", goal: "确认节奏而不追问" },
  { id: "a-boundary", mine: "那我不问了，你想说的时候我都在。", stage: "初聊", goal: "尊重边界" }
];

function costEstimate(promptTokens, completionTokens) {
  return (promptTokens / 1e6) * PRICE_INPUT_PER_M + (completionTokens / 1e6) * PRICE_OUTPUT_PER_M;
}

function useFor(raw) {
  const usage = raw?.usage || {};
  return {
    prompt: Number(usage.prompt_tokens ?? 0),
    completion: Number(usage.completion_tokens ?? 0),
    reasoning: Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0),
    finishReason: raw?.choices?.[0]?.finish_reason || raw?.choices?.[0]?.status || "?"
  };
}

const persona = builtInPersonas.lin;
const memory = {};

async function checkServer() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function judgePrompt({ mine, herReply, options }) {
  const abc = options.map((item) => `${item.key}：${item.text}`).join("\n");
  return [
    "你是严格的对话质量评审。只输出一个合法 JSON 对象，不要解释、不要代码块。",
    "背景：男方（用户）发了下面这句，女方回了一句，然后教练给了三条备选回复。",
    `男方原话：${mine}`,
    `女方回复：${herReply}`,
    `教练三选一：\n${abc}`,
    "逐项判断（boolean），并给不超过 40 字的理由：",
    "answered_question: 女方若在提问，三条里是否至少有一条先直接回答了她问的那件事；她没提问则给 true。",
    "abc_actionable: 三条是否都是可以直接发送的聊天文本（不是教练点评、没有元话语）。",
    "abc_distinct: 三条的沟通动作是否真的不同（而不是同一句话的三种说法）。",
    "her_natural: 女方那句是否像真人微信（短、口语、没有括号动作、没有教练腔）。",
    "输出字段：answered_question, abc_actionable, abc_distinct, her_natural, worst_option(A|B|C|none), reason。"
  ].join("\n");
}

async function judge(api, { mine, herReply, options }) {
  const messages = [
    { role: "system", content: "你只输出 JSON，判断严格，不迁就。" },
    { role: "user", content: judgePrompt({ mine, herReply, options }) }
  ];
  const result = await callLLM({ ...api, ...JUDGE_LANE, messages });
  const raw = String(result.content || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { parsed: null, usage: useFor(result.raw), ms: 0 };
  try {
    return { parsed: JSON.parse(raw.slice(start, end + 1)), usage: useFor(result.raw), ms: 0 };
  } catch {
    return { parsed: null, usage: useFor(result.raw), ms: 0 };
  }
}

function report(rows, totals) {
  const header = [
    "# A/B/C 与角色回复行为评测",
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- 模型：${totals.model}｜用例：${rows.length}｜单用例调用：角色 + 教练 + 裁判 = 3 次`,
    `- 教练通道输出模式：${COACH_JSON ? "json_object" : "默认文本"}｜思考：${COACH_NO_THINKING ? "关闭" : "开启（默认）"}`,
    "- 判定口径：`answered_question` 等四项由模型裁判给出，`her_first_ms` 为角色通道实测耗时。",
    "- 价格假设：输入 ¥1/M、输出 ¥2/M（**未核实缓存价，量级估计**）。",
    "",
    "| 用例 | 她（角色通道） | 她首次可见 | 教练耗时 | 教练 JSON | ABC 来源 | 回答问题 | 可发送 | 三条有别 | 像真人 | 最差项 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.id} | ${JSON.stringify(row.herReply)} | ${row.herFirstMs}ms | ${row.coachMs}ms | ${row.coachJsonOk === undefined ? "-" : row.coachJsonOk ? "合法" : "**非法**"} | ${row.replyOptionsSource} | ${row.answered_question} | ${row.abc_actionable} | ${row.abc_distinct} | ${row.her_natural} | ${row.worst_option} |`),
    "",
    "## 本地兜底原因（ABC 来源为 local 的用例）",
    ...fallbackNotes(rows),
    "",
    "## 裁判理由",
    ...rows.map((row) => `- **${row.id}**：${row.reason || "（裁判未返回理由）"}${row.judgeFailed ? "（裁判 JSON 解析失败）" : ""}`),
    "",
    "## 汇总",
    ...[
      "回答问题",
      "可发送",
      "三条有别",
      "像真人"
    ].map((label) => {
      const key = { 回答问题: "answered_question", 可发送: "abc_actionable", 三条有别: "abc_distinct", 像真人: "her_natural" }[label];
      const pass = rows.filter((row) => row[key] === true).length;
      return `- ${label}：${pass}/${rows.length}`;
    }),
    "",
    `- 角色通道首次可见：P50 ${totals.herP50}ms（样本 ${rows.length}）`,
    `- 教练通道耗时：P50 ${totals.coachP50}ms，最慢 ${totals.coachMax}ms（样本 ${totals.coachSamples}）——一轮完整体验由它决定`,
    `- token 合计：输入 ${totals.prompt}，输出 ${totals.completion}`,
    `- 估算成本：¥${totals.cost.toFixed(4)}（按上面的价格假设）`,
    ""
  ];
  return header.join("\n");
}

function fallbackNotes(rows) {
  const local = rows.filter((row) => row.replyOptionsSource === "local");
  if (!local.length) return ["- 本轮全部使用模型生成的 A/B/C。"];
  return local.map((row) => {
    if (!row.coachJsonOk) {
      const cause = row.coachFinish === "length" ? "输出被 token 上限截断" : `finish_reason=${row.coachFinish}（不是截断，是格式本身不合 JSON）`;
      return `- **${row.id}**：教练通道 JSON 解析失败 —— ${cause}。输出 ${row.coachCompletion} token（推理 ${row.coachReasoning}）。解析器报错：\`${row.coachParseError}\`。首尾各 120 字：${JSON.stringify({ head: row.coachHead, tail: row.coachTail })}`;
    }
    if (!row.rawOptions.length) return `- **${row.id}**：教练 JSON 合法但没带 replyOptions 字段`;
    return `- **${row.id}**：模型 ABC 未过 isUsableModelReplyOptions → ${JSON.stringify(row.rawOptions.map((item) => item.text), null, 0)}`;
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

async function main() {
  const planned = CASES.slice(0, LIMIT);
  let promptChars = 0;
  for (const testCase of planned) {
    const messages = [{ type: "me", text: testCase.mine, who: "我" }];
    const placeholder = "（评测中由模型生成）";
    const her = buildHerMessages(persona, memory, messages, { stage: testCase.stage, mode: "anti" });
    const coach = buildCoachMessages({ persona, memory, messages, herReply: placeholder, uiValues: { stage: testCase.stage, goal: testCase.goal } });
    const judgeMessages = [
      { role: "system", content: "你只输出 JSON，判断严格，不迁就。" },
      { role: "user", content: judgePrompt({ mine: testCase.mine, herReply: placeholder, options: [{ key: "A", text: placeholder }, { key: "B", text: placeholder }, { key: "C", text: placeholder }] }) }
    ];
    promptChars += [her, coach, judgeMessages].flatMap((list) => list.map((item) => String(item.content || "").length)).reduce((sum, size) => sum + size, 0);
  }
  const estPrompt = Math.round(promptChars / CHARS_PER_TOKEN);
  const estCompletion = planned.length * 3 * 160;
  const estCost = costEstimate(estPrompt, estCompletion);

  console.log(`用例 ${planned.length} 条，每条 3 次调用（角色 / 教练 / 裁判）= ${planned.length * 3} 次请求`);
  console.log(`预估输入 token ≈ ${estPrompt}（未计缓存命中），预估输出 token ≈ ${estCompletion}`);
  console.log(`预估成本 ≈ ¥${estCost.toFixed(4)}（假设 输入¥${PRICE_INPUT_PER_M}/M、输出¥${PRICE_OUTPUT_PER_M}/M，缓存价未核实）`);
  console.log(`本地代理：${BASE_URL}/api/chat（密钥只留在服务端 .env，本脚本不读取）`);

  if (!RUN) {
    console.log("\n这是干跑：没有发出任何请求。确认要花钱请加 --yes。");
    return;
  }
  if (!(await checkServer())) {
    console.error(`\n无法访问 ${BASE_URL}/api/health。请先 npm start，再重试。`);
    process.exitCode = 1;
    return;
  }

  // 模型由服务端 .env 的 LLM_MODEL 决定（llmProxy 恒用 LLM_MODEL），脚本不覆盖它。
  const api = { endpoint: `${BASE_URL}/api/chat` };
  const rows = [];
  let totalPrompt = 0;
  let totalCompletion = 0;

  for (const testCase of planned) {
    // 单条用例失败不能丢掉整轮数据：这时钱已经花了，而且「角色通道偶发空返回」本身就是要记下来的结论。
    try {
      const history = [{ type: "me", text: testCase.mine, who: "我" }];
      const herStart = Date.now();
      const herResult = await callLLM({ ...api, ...HER_LANE, messages: buildHerMessages(persona, memory, history, { stage: testCase.stage, mode: "anti" }) });
      const herFirstMs = Date.now() - herStart;
      const bubbles = parseHerBubbles(herResult.content, persona.name);
      const herReply = joinHerReply(bubbles) || String(herResult.content || "").slice(0, 60);
      const coachStart = Date.now();
      const coachResult = await callLLM({
        ...api,
        ...(COACH_JSON ? { responseFormat: { type: "json_object" } } : {}),
        ...(COACH_NO_THINKING ? { thinking: { type: "disabled" } } : {}),
        messages: buildCoachMessages({ persona, memory, history, herReply, uiValues: { stage: testCase.stage, goal: testCase.goal, latestMine: testCase.mine } })
      });
      const coachMs = Date.now() - coachStart;
      const analysis = parseModelContent(coachResult.content, { latestMine: testCase.mine, stage: testCase.stage, goal: testCase.goal, styleBias: "mix", herReply });
      // 免费诊断：ABC=local 到底是「模型没给 JSON」还是「给了但没过校验」，两者是完全不同的问题。
      let coachJsonOk = false;
      let coachParseError = "";
      let rawOptions = [];
      try {
        const parsed = JSON.parse(extractJsonObject(coachResult.content));
        coachJsonOk = true;
        rawOptions = normalizeReplyOptions(parsed.replyOptions || parsed.choices || parsed["A/B/C回复"] || []);
      } catch (error) {
        coachJsonOk = false;
        coachParseError = error.message;
      }
      const verdict = await judge(api, { mine: testCase.mine, herReply, options: analysis.replyOptions });

      for (const usage of [useFor(herResult.raw), useFor(coachResult.raw), verdict.usage]) {
        totalPrompt += usage.prompt;
        totalCompletion += usage.completion;
      }
      const coachUsage = useFor(coachResult.raw);
      rows.push({
        id: testCase.id,
        herReply,
        herFirstMs,
        coachMs,
        replyOptionsSource: analysis.replyOptionsSource,
        coachFinish: coachUsage.finishReason,
        coachCompletion: coachUsage.completion,
        coachReasoning: coachUsage.reasoning,
        coachJsonOk,
        coachParseError,
        coachHead: String(coachResult.content || "").slice(0, 120),
        coachTail: String(coachResult.content || "").slice(-120),
        rawOptions,
        answered_question: verdict.parsed?.answered_question ?? "?",
        abc_actionable: verdict.parsed?.abc_actionable ?? "?",
        abc_distinct: verdict.parsed?.abc_distinct ?? "?",
        her_natural: verdict.parsed?.her_natural ?? "?",
        worst_option: verdict.parsed?.worst_option ?? "?",
        reason: verdict.parsed?.reason || "",
        judgeFailed: !verdict.parsed
      });
      console.log(`✓ ${testCase.id} 她=${JSON.stringify(herReply)} 首次可见=${herFirstMs}ms ABC=${analysis.replyOptionsSource} 教练 finish=${coachUsage.finishReason} out=${coachUsage.completion}(推理${coachUsage.reasoning}) 裁判=${JSON.stringify(verdict.parsed)}`);
    } catch (error) {
      rows.push({
        id: testCase.id,
        herReply: "（调用失败）",
        herFirstMs: "-",
        coachMs: "-",
        replyOptionsSource: "-",
        answered_question: "error",
        abc_actionable: "error",
        abc_distinct: "error",
        her_natural: "error",
        worst_option: "-",
        reason: error.message,
        judgeFailed: false
      });
      console.log(`✗ ${testCase.id} 失败：${error.message}`);
    }
  }

  const coachTimes = rows.map((row) => row.coachMs).filter((value) => Number.isFinite(value));
  const totals = {
    model: rows.length ? "mimo（以本地 .env 的 LLM_MODEL 为准）" : "-",
    herP50: median(rows.map((row) => row.herFirstMs).filter((value) => Number.isFinite(value))),
    coachP50: median(coachTimes),
    coachMax: coachTimes.length ? Math.max(...coachTimes) : 0,
    coachSamples: coachTimes.length,
    prompt: totalPrompt,
    completion: totalCompletion,
    cost: costEstimate(totalPrompt, totalCompletion)
  };
  const markdown = report(rows, totals);
  const target = OUT || path.join("docs", "verification", `ab-behavior-eval-${new Date().toISOString().slice(0, 10)}.md`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, "utf8");
  console.log(`\n报告已写入 ${target}`);
  console.log(`实际 token：输入 ${totalPrompt}，输出 ${totalCompletion}｜估算 ¥${totals.cost.toFixed(4)}`);
}

main().catch((error) => {
  console.error(`评测失败：${error.message}`);
  process.exitCode = 1;
});
