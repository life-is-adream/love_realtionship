import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCharacterCard,
  personaToCharacterCard,
  characterCardToPersona,
  exportCharacterCard,
  importCharacterCard,
  exportAllPersonas,
  CCC_VERSION
} from "../public/modules/core/character-card.js";
import { builtInPersonas } from "../public/modules/core/config.js";

// ── validateCharacterCard ─────────────────────────────────────────────────────

test("validateCharacterCard null 返回无效", () => {
  const r = validateCharacterCard(null);
  assert.equal(r.valid, false);
});

test("validateCharacterCard 完整卡通过验证", () => {
  const card = {
    ccc_version: CCC_VERSION,
    id: "test",
    name: "测试角色",
    description: "一个测试角色",
    tags: ["测试"],
    starter_messages: [{ who: "我", text: "你好" }, { who: "测试角色", text: "嗨" }]
  };
  const r = validateCharacterCard(card);
  assert.ok(r.valid);
});

test("validateCharacterCard 缺少必填字段", () => {
  const r = validateCharacterCard({});
  assert.equal(r.valid, false);
  assert.ok(r.errors.length > 0);
});

// ── personaToCharacterCard ────────────────────────────────────────────────────

test("personaToCharacterCard 林知夏转换", () => {
  const card = personaToCharacterCard("lin", builtInPersonas.lin);
  assert.equal(card.name, "林知夏");
  assert.equal(card.ccc_version, CCC_VERSION);
  assert.ok(Array.isArray(card.tags));
  assert.ok(Array.isArray(card.starter_messages));
  assert.ok(card.description.includes("慢热知性型"));
  assert.ok(card.language_style);
});

test("personaToCharacterCard 夏紫桐转换", () => {
  const card = personaToCharacterCard("zi", builtInPersonas.zi);
  assert.equal(card.name, "夏紫桐");
  assert.ok(card.description.includes("观察力细"));
});

// ── characterCardToPersona ─────────────────────────────────────────────────────

test("characterCardToPersona 转换回林知夏", () => {
  const card = personaToCharacterCard("lin", builtInPersonas.lin);
  const persona = characterCardToPersona(card);
  assert.equal(persona.name, "林知夏");
  assert.equal(persona.id, "lin");
  assert.ok(Array.isArray(persona.starterMessages));
  assert.ok(persona.systemRole);
});

test("characterCardToPersona 双向转换一致", () => {
  const card = personaToCharacterCard("xu", builtInPersonas.xu);
  const persona = characterCardToPersona(card);
  assert.equal(persona.name, builtInPersonas.xu.name);
  assert.equal(persona.id, "xu");
  assert.equal(persona.defaultGoal, builtInPersonas.xu.defaultGoal);
});

// ── exportCharacterCard ───────────────────────────────────────────────────────

test("exportCharacterCard 导出为 JSON", () => {
  const card = personaToCharacterCard("tang", builtInPersonas.tang);
  const json = exportCharacterCard(card);
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, "唐一禾");
});

test("exportCharacterCard 无效卡抛出错误", () => {
  assert.throws(() => exportCharacterCard({}));
});

// ── importCharacterCard ───────────────────────────────────────────────────────

test("importCharacterCard 合法 JSON 导入成功", () => {
  const json = JSON.stringify({
    ccc_version: CCC_VERSION,
    id: "test",
    name: "测试",
    description: "描述",
    starter_messages: [{ who: "我", text: "你好" }, { who: "测试", text: "嗨" }]
  });
  const r = importCharacterCard(json);
  assert.ok(r.ok);
  assert.equal(r.card.name, "测试");
});

test("importCharacterCard 非法 JSON 返回错误", () => {
  const r = importCharacterCard("不是 JSON");
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// ── exportAllPersonas ─────────────────────────────────────────────────────────

test("exportAllPersonas 导出所有内置角色", () => {
  const cards = exportAllPersonas(builtInPersonas);
  assert.ok(Array.isArray(cards));
  assert.ok(cards.length >= 4);
  const names = cards.map((c) => c.name);
  assert.ok(names.includes("林知夏"));
  assert.ok(names.includes("许砚秋"));
  assert.ok(names.includes("唐一禾"));
  assert.ok(names.includes("夏紫桐"));
});