// B2 懒加载修复的回归测试：
// 首屏（索引未触发）只渲染 manifest 占位卡；chunk 仅在教材路径真实触发后加载，
// 且触发后的检索结果与全量索引构建的结果一致（行为等价）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCoachTextbookEvidence, buildAnalysisQuery } from "../public/modules/content/textbook-search.js";
import { getSharedTextbookIndex } from "../public/modules/content/textbook-index.js";
import { renderTextbookEvidence, enableTextbookIndexLoad } from "../public/modules/render/render-learning.js";

const renderLearningSource = await readFile(new URL("../public/modules/render/render-learning.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

// DOM 桩：render-learning 只用到 getElementById("textbookPanel"/"stage") 与 panel.querySelector。
function createPanelStub() {
  return {
    innerHTML: "",
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector(selector) {
      return this.innerHTML.includes(`id="${selector.slice(1)}"`) ? { addEventListener() {} } : null;
    }
  };
}

function installDomStub(panel) {
  globalThis.document = {
    getElementById(id) {
      if (id === "textbookPanel") return panel;
      if (id === "stage") return { value: "" };
      return null;
    }
  };
}

test("空检索意图下证据渲染不依赖索引：空索引与全量索引结果完全一致", async () => {
  const fullIndex = await getSharedTextbookIndex();
  for (const analysis of [null, {}, { stage: "" }]) {
    const analysisWithStage = { ...(analysis || {}), stage: "" };
    assert.equal(buildAnalysisQuery(analysisWithStage), "");
    const withEmptyIndex = buildCoachTextbookEvidence(analysisWithStage, { entries: [] });
    const withFullIndex = buildCoachTextbookEvidence(analysisWithStage, fullIndex);
    assert.deepEqual(withEmptyIndex, withFullIndex);
    assert.equal(withEmptyIndex.results.length, 0);
  }
});

test("非空分析会产出真实检索意图（懒加载 gate 的判定输入）", () => {
  assert.notEqual(buildAnalysisQuery({ summary: "我连续追问了三次，她没有回应", risk: "查户口式施压" }), "");
  assert.notEqual(buildAnalysisQuery({ stage: "暧昧推进" }), "");
});

test("首屏未触发时渲染 manifest 占位卡，不产出检索结果；触发后渲染完整证据", async () => {
  const panel = createPanelStub();
  installDomStub(panel);
  const analysis = { summary: "我连续追问了三次，她没有回应", risk: "查户口式施压" };

  // ① 索引未触发（首屏/会话恢复）：占位卡 + 手动载入按钮，无结果卡片。
  await renderTextbookEvidence(analysis, {});
  assert.match(panel.innerHTML, /FIELD NOTES \/ STANDBY/);
  assert.match(panel.innerHTML, /教材索引待加载/);
  assert.match(panel.innerHTML, /id="textbookLoadIndexBtn"/);
  assert.equal(panel.innerHTML.includes("textbook-result"), false);

  // ② 用户触发（提交分析/点击载入）后：渲染完整证据视图。
  enableTextbookIndexLoad();
  await renderTextbookEvidence(analysis, {});
  const evidence = buildCoachTextbookEvidence({ ...analysis, stage: "" }, await getSharedTextbookIndex());
  assert.equal(panel.innerHTML.includes("textbook-result"), evidence.results.length > 0);
  if (evidence.results.length) {
    assert.match(panel.innerHTML, /FIELD NOTES \/ MATCHED/);
    assert.ok(panel.innerHTML.includes(evidence.results[0].title));
  }
});

test("懒加载装配点：render-learning 在索引 gate 之后才调用共享索引，app.js 在提交分析时放行", () => {
  assert.match(renderLearningSource, /let textbookIndexLoadEnabled = false;/);
  assert.match(renderLearningSource, /export function enableTextbookIndexLoad\(\)/);
  // gate 判断必须出现在 getSharedTextbookIndex 调用之前
  const gateAt = renderLearningSource.indexOf("textbookIndexLoadEnabled");
  const indexCallAt = renderLearningSource.indexOf("getSharedTextbookIndex()");
  assert.ok(gateAt > -1 && indexCallAt > gateAt);
  assert.match(appSource, /enableTextbookIndexLoad\(\);[\s\S]*?renderAll\(\);/);
});
