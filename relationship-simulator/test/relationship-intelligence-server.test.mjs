import test from "node:test";
import assert from "node:assert/strict";
import {
  ProductIntelligenceInputError,
  normalizeProductMessages,
  runProductRelationshipIntelligence
} from "../server/relationshipIntelligence.js";
import { server } from "../server/index.js";

test("HeartFlow 消息会转换为 runtime 消息并执行有界裁剪", () => {
  const messages = Array.from({ length: 82 }, (_, index) => ({
    id: `ui-${index}`,
    type: index % 2 === 0 ? "me" : "her",
    text: `${index}:${"很长".repeat(1200)}`,
    createdAt: "2026-08-20T08:00:00.000Z"
  }));

  const normalized = normalizeProductMessages(messages);

  assert.equal(normalized.length, 80);
  assert.equal(normalized[0].id, "ui-2");
  assert.equal(normalized[0].speaker, "user");
  assert.equal(normalized[1].speaker, "other");
  assert.equal(normalized[0].text.length, 2000);
  assert.equal(normalized[0].timestamp, "2026-08-20T08:00:00.000Z");
});

test("消息上限按非空消息计算，不让尾部空项挤掉有效上下文", () => {
  const normalized = normalizeProductMessages([
    { type: "me", text: "应保留" },
    ...Array.from({ length: 80 }, () => ({ type: "her", text: " " }))
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].text, "应保留");
});

test("未同意时可分析，但不返回原始消息或 memory patch", () => {
  const result = runProductRelationshipIntelligence({
    messages: [
      { type: "me", text: "我的手机号是 13800138000，最近有空喝咖啡吗？" },
      { type: "her", text: "最近有点忙，之后再说吧。" }
    ],
    goal: "练习尊重边界，联系电话 13800138000",
    consent: false
  });

  const serialized = JSON.stringify(result);
  assert.equal(result.memoryPatch, null);
  assert.equal(result.privacy.rawMessagesReturned, false);
  assert.equal(result.privacy.consentProvided, false);
  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(serialized.includes("之后再说吧"), false);
});

test("显式同意后只累计匿名结构化 memory，并支持保守状态推进", () => {
  const first = runProductRelationshipIntelligence({
    messages: [
      { type: "me", text: "你好，最近怎么样？" },
      { type: "her", text: "还可以，谢谢。" }
    ],
    goal: "自然重新联系",
    consent: true,
    caseId: "case_heartflow_test"
  });

  assert.equal(first.state.to, "INITIAL_CONTACT");
  assert.equal(first.memoryPatch.caseId, "case_heartflow_test");
  assert.equal(first.memoryPatch.consent.granted, true);
  assert.equal(first.memoryPatch.privacy.rawChatRetained, false);

  const second = runProductRelationshipIntelligence({
    messages: [
      { type: "me", text: "你好，最近怎么样？" },
      { type: "her", text: "还可以，谢谢。" },
      { type: "me", text: "我最近开始学做饭。" },
      { type: "her", text: "听起来挺有趣，你学了什么菜？" }
    ],
    goal: "自然重新联系",
    consent: true,
    caseId: "case_heartflow_test",
    memory: first.memoryPatch
  });

  assert.equal(second.state.from, "INITIAL_CONTACT");
  assert.equal(second.state.to, "MUTUAL_FAMILIARITY");
  assert.equal(second.memoryPatch.observations.length, 2);
  assert.equal(JSON.stringify(second.memoryPatch).includes("学做饭"), false);
});

test("同意长期记忆时必须使用匿名 case_ 标识", () => {
  assert.throws(
    () => runProductRelationshipIntelligence({
      messages: [{ type: "me", text: "你好" }],
      consent: true,
      caseId: "张三"
    }),
    (error) => error instanceof ProductIntelligenceInputError && error.code === "invalid_case_id"
  );
});

test("没有可分析消息时拒绝请求", () => {
  assert.throws(
    () => runProductRelationshipIntelligence({ messages: [{ type: "me", text: "   " }] }),
    (error) => error instanceof ProductIntelligenceInputError && error.code === "messages_required"
  );
});

test("产品 API 将明确停止联系置于过时约会与替代安排信号之前", () => {
  const result = runProductRelationshipIntelligence({
    messages: [{ type: "her", text: "我不想继续，请别再联系我。" }],
    signals: { concreteDatePlan: true, counterOffer: true }
  });
  assert.equal(result.decision.value, "EXIT");
  assert.equal(result.state.to, "EXIT");
  assert.match(result.action, /停止推进/);
});

test("普通拒绝食物或当日时间不成为关系退出判断", () => {
  const result = runProductRelationshipIntelligence({
    messages: [{ type: "her", text: "今天不方便，也不想吃火锅，下周一起吃饭可以。" }],
    signals: { concreteDatePlan: true }
  });
  assert.notEqual(result.decision.value, "EXIT");
});

test("产品 API 重建已同意记忆时拒绝敏感 ID 和各复盘字段", () => {
  const result = runProductRelationshipIntelligence({
    messages: [{ type: "me", text: "一条合成消息" }],
    consent: true, caseId: "case_synthetic_privacy",
    memory: {
      observations: [{ id: "example-person@example.invalid", summary: "普通观察", evidenceIds: ["example-person@example.invalid"] }],
      outcomes: [{ id: "outcome_synthetic", prediction: "预测", observedOutcome: "结果", update: "微信号: synthetic_account", lessons: ["姓名: 合成样例"] }]
    }
  });
  const serialized = JSON.stringify(result.memoryPatch);
  assert.doesNotMatch(serialized, /example-person@example\.invalid|synthetic_account|合成样例/);
  assert.equal(result.memoryPatch.privacy.knownIdentifiersRedacted, true);
  assert.equal(result.memoryPatch.privacy.anonymized, false);
  assert.equal(result.memoryPatch.privacy.manualReviewRequired, true);
});

test("产品 API 新观察即使消息条数相同也保留，原上下文重试幂等", () => {
  const input = { consent: true, caseId: "case_synthetic_events", messages: [{ type: "her", text: "合成消息第一条" }] };
  const first = runProductRelationshipIntelligence(input);
  const second = runProductRelationshipIntelligence({ ...input, messages: [{ type: "her", text: "合成消息另一条" }], memory: first.memoryPatch });
  const retry = runProductRelationshipIntelligence({ ...input, messages: [{ type: "her", text: "合成消息另一条" }], memory: second.memoryPatch });
  assert.equal(second.memoryPatch.observations.length, 2);
  assert.equal(retry.memoryPatch.observations.length, 2);
});

test("HTTP 主路由端到端调用本地 runtime，且响应不回显原始消息", async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  try {
    const health = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const page = await fetch(`http://127.0.0.1:${address.port}/`);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/relationship-intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { type: "me", text: "这是只应在本地消费的原始消息" },
          { type: "her", text: "收到" }
        ],
        consent: false
      })
    });
    const text = await response.text();
    const payload = JSON.parse(text);

    assert.equal(health.status, 200);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="relationshipIntelligencePanel"/);
    assert.equal(response.status, 200);
    assert.equal(payload.version, 1);
    assert.equal(payload.privacy.rawMessagesReturned, false);
    assert.equal(text.includes("只应在本地消费"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
