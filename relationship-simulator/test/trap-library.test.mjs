// ④ 常见陷阱图鉴：聚合规则全覆盖 + 标签契约对齐 + 渲染接线源码断言。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TRAP_LIBRARY, TRAP_LIBRARY_NOTE, buildTrapProgress } from "../public/modules/training/trap-library.js";
import { classifyPreflightIssues } from "../public/modules/core/mistakes.js";

const mistake = (extra = {}) => ({ id: `m-${Math.random().toString(36).slice(2, 8)}`, ts: "2026-02-01T10:00:00.000Z", source: "coach", text: "x", dims: {}, issues: [], resolved: false, ...extra });

test("陷阱库静态结构：六个陷阱、matchedIssues 与错题本标签契约一致", () => {
  assert.equal(TRAP_LIBRARY.length, 6);
  const ids = TRAP_LIBRARY.map((trap) => trap.id);
  assert.equal(new Set(ids).size, TRAP_LIBRARY.length, "id 唯一");
  for (const trap of TRAP_LIBRARY) {
    assert.ok(trap.name && trap.why && trap.signal && Array.isArray(trap.matchedIssues) && trap.matchedIssues.length, trap.id);
    for (const label of trap.matchedIssues) {
      assert.ok(
        ["越界词", "施压词", "自然度短板", "共情短板", "边界感短板", "推进力短板"].includes(label),
        `未知标签 ${label}（错题本标签集合变了要同步图鉴）`
      );
    }
  }
});

test("classifyPreflightIssues 的输出能命中图鉴（标签契约端到端）", () => {
  const issues = classifyPreflightIssues(["性感", "必须"]);
  assert.deepEqual(issues.sort(), ["施压词", "越界词"].sort());
  const { traps } = buildTrapProgress([mistake({ issues })]);
  for (const label of issues) {
    assert.equal(traps.some((trap) => trap.matchedIssues.includes(label) && trap.count === 1), true, label);
  }
});

test("无错题：全暗、litCount 0；空数组与非法输入不抛错", () => {
  const empty = buildTrapProgress([]);
  assert.equal(empty.litCount, 0);
  assert.equal(empty.traps.length, TRAP_LIBRARY.length);
  const invalid = buildTrapProgress(null);
  assert.equal(invalid.litCount, 0);
});

test("命中即点亮：一条错题可同时点亮多个陷阱；resolved 计为走出", () => {
  const multi = buildTrapProgress([mistake({ issues: ["施压词", "共情短板"] })]);
  assert.equal(multi.litCount, 2);
  const pressure = multi.traps.find((trap) => trap.id === "pressure");
  assert.equal(pressure.count, 1);
  assert.equal(pressure.resolvedCount, 0);
  assert.ok(pressure.firstSeen);
  const resolved = buildTrapProgress([mistake({ issues: ["边界感短板"], resolved: true, resolvedAt: "2026-02-02T10:00:00.000Z" })]);
  const tryHard = resolved.traps.find((trap) => trap.id === "try-hard");
  assert.equal(tryHard.count, 1);
  assert.equal(tryHard.resolvedCount, 1);
  assert.equal(resolved.litCount, 1, "已走出仍算点亮（图鉴保留收集记录）");
});

test("排序：命中多的陷阱在前，零命中的保持库内声明顺序", () => {
  const { traps } = buildTrapProgress([
    mistake({ issues: ["共情短板"] }),
    mistake({ issues: ["共情短板"] }),
    mistake({ issues: ["施压词"] })
  ]);
  const lit = traps.filter((trap) => trap.count > 0).map((trap) => trap.id);
  assert.deepEqual(lit, ["lecture", "pressure"]);
  assert.equal(traps[2].count, 0, "零命中的排在点亮项之后");
});

test("firstSeen 取最早一条命中时间", () => {
  const { traps } = buildTrapProgress([
    mistake({ id: "late", ts: "2026-02-05T10:00:00.000Z", issues: ["越界词"] }),
    mistake({ id: "early", ts: "2026-02-01T10:00:00.000Z", issues: ["越界词"] })
  ]);
  const crossing = traps.find((trap) => trap.id === "boundary-crossing");
  assert.equal(crossing.firstSeen, "2026-02-01T10:00:00.000Z");
});

test("渲染接线：错题本面板挂图鉴区块、点亮/灰态/走出三种状态、插值过 escapeHtml", async () => {
  const source = await readFile(new URL("../public/modules/render/render-mistakes.js", import.meta.url), "utf8");
  assert.match(source, /renderTrapLibrary\(mistakes\)/);
  assert.match(source, /buildTrapProgress/);
  assert.match(source, /trap-library/);
  assert.match(source, /is-lit|is-dim/);
  assert.match(source, /还没遇到/);
  assert.match(source, /走出 /);
  assert.match(source, /TRAP_LIBRARY_NOTE/);
  assert.equal((source.match(/escapeHtml/g) || []).length >= 6, true);
  // 图鉴不写状态、不改错题数据
  assert.doesNotMatch(source, /mutate\(\(state\) => \{\s*state\.mistakes = buildTrapProgress/);
});
