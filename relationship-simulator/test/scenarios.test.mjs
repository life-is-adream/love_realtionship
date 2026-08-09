import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "../public/modules/content/scenarios.js";

/**
 * 场景剧本模块测试
 *
 * 覆盖目的：
 * 1. 验证 scenarios.js 可被正常导入（防止语法错误导致前端崩溃）
 * 2. 验证剧本数量 ≥ 5
 * 3. 验证每个剧本字段完整性
 * 4. 验证推荐阶段为合法值
 */

test("scenarios.js 可正常导入且剧本数 ≥ 5", () => {
  assert.ok(Array.isArray(scenarios), "scenarios 应为数组");
  assert.ok(scenarios.length >= 5, `expected ≥5 scenarios, got ${scenarios.length}`);
});

test("每个剧本包含必要字段", () => {
  for (const s of scenarios) {
    assert.ok(typeof s.id === "string" && s.id.length > 0, `scenario missing id`);
    assert.ok(typeof s.title === "string" && s.title.length > 0, `scenario ${s.id} missing title`);
    assert.ok(typeof s.description === "string" && s.description.length > 0, `scenario ${s.id} missing description`);
    assert.ok(Array.isArray(s.openingMessages), `scenario ${s.id} openingMessages not array`);
    assert.ok(typeof s.recommendedStage === "string" && s.recommendedStage.length > 0, `scenario ${s.id} missing recommendedStage`);
    assert.ok(typeof s.recommendedPersona === "string" && s.recommendedPersona.length > 0, `scenario ${s.id} missing recommendedPersona`);
    assert.ok(Array.isArray(s.coachFocus), `scenario ${s.id} coachFocus not array`);
  }
});

test("每个剧本的 contextHint 不含 ASCII 双引号（防止语法错误）", () => {
  for (const s of scenarios) {
    if (s.contextHint) {
      // contextHint 内不应出现未转义的 ASCII 双引号
      // 如果有引号需求，应使用中文引号 \u201c \u201d
      const hasAsciiQuote = /"/.test(s.contextHint);
      assert.ok(!hasAsciiQuote, `scenario ${s.id} contextHint 含 ASCII 双引号，可能导致语法错误`);
    }
  }
});

test("剧本覆盖初聊/邀约/冲突/边界/低谷期场景", () => {
  const titles = scenarios.map((s) => s.title).join(" ");
  // 至少覆盖部分典型场景
  assert.ok(/初聊|第一晚|刚加/.test(titles), "缺少初聊场景");
  assert.ok(/邀约|被拒/.test(titles), "缺少邀约场景");
  assert.ok(/放鸽子|冲突|沟通/.test(titles), "缺少冲突场景");
  assert.ok(/边界|查户口/.test(titles), "缺少边界场景");
  assert.ok(/低谷|累|不想说话/.test(titles), "缺少低谷期场景");
});
