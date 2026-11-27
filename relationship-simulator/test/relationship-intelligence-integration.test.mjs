import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const server = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
const requestHandler = await readFile(new URL("../server/request-handler.js", import.meta.url), "utf8");

test("产品主入口接入独立 Relationship Intelligence 控制器", () => {
  assert.match(app, /createRelationshipIntelligenceController/);
  assert.match(app, /renderRelationshipIntelligence/);
  assert.match(app, /intelligenceController\.refresh\(\)/);
  assert.match(app, /intelligenceController\.setConsent/);
  assert.match(app, /intelligenceController\.reset/);
});

test("页面提供本地分析面板和显式匿名记忆同意控件", () => {
  assert.match(index, /id="relationshipIntelligencePanel"/);
  assert.match(index, /id="relationshipIntelligenceConsent"/);
  assert.match(index, /id="refreshRelationshipIntelligenceBtn"/);
  assert.match(index, /聊天和训练记录仍会另存本机/);
});

test("本地服务主路由公开确定性 runtime 接口", () => {
  assert.match(server, /handleRelationshipIntelligence/);
  assert.match(server, /createRequestHandler/);
  assert.match(requestHandler, /\/api\/relationship-intelligence/);
  assert.match(requestHandler, /await handleRelationshipIntelligence\(req, res\)/);
});
