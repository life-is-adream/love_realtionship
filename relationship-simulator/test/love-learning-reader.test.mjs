import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.textContent = "";
    this.value = "";
    this.style = {};
    this.attributes = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
    };
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ""; }
  appendChild(child) { this.children.push(child); }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
}

async function page(search = "") {
  const html = await readFile(new URL("../public/love-learning.html", import.meta.url), "utf8");
  const elements = new Map();
  const getElement = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const tabs = ["courses", "map", "books"].map((view) => {
    const tab = new Element("button");
    tab.dataset = { view };
    return tab;
  });
  const requests = [];
  const storageWrites = [];
  const context = createContext({
    document: {
      getElementById: getElement,
      createElement: (tag) => new Element(tag),
      querySelectorAll(selector) {
        if (selector === ".tab") return tabs;
        if (selector === ".view") return ["courses", "map", "books"].map((view) => getElement("view-" + view));
        return [];
      },
      addEventListener() {},
    },
    localStorage: { getItem: () => null, setItem: (...args) => storageWrites.push(args) },
    window: { location: { search } },
    URLSearchParams,
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
  });
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { context, elements, requests, storageWrites, tabs };
}

const course = { no: 179, title: "课程标题", date: "2027-01-12", stage: "connection", dim: "communicate", file: "love-learning/courses/179.md" };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("course reading consumes the manifest path, shows plain text, and does not mark learning complete", async () => {
  const setup = await page();
  setup.context.course = course;
  const row = runInContext("courseRow(course)", setup.context);
  const read = row.children[3].children.find((element) => element.tagName === "button");
  assert.equal(read.textContent, "阅读全文");
  read.onclick();
  const request = setup.requests.at(-1);
  assert.equal(request.url, "/love-learning/courses/179.md");
  request.resolve({ ok: true, text: async () => "# 课程原文\n<script>不可执行</script>" });
  await flush();
  assert.equal(setup.elements.get("readerTitle").textContent, "第 179 课：课程标题");
  assert.equal(setup.elements.get("readerMeta").textContent, "2027-01-12 · 建立联系 · 沟通与情绪");
  assert.equal(setup.elements.get("readerBody").children[0].textContent, "# 课程原文\n<script>不可执行</script>");
  assert.deepEqual(setup.storageWrites, []);
});

test("a slow earlier reader request cannot replace the selected course", async () => {
  const setup = await page();
  setup.context.course = course;
  runInContext("openReader({ ...course, kind: '课程', note: '' })", setup.context);
  const first = setup.requests.at(-1);
  runInContext("openReader({ ...course, no: 178, title: '新的课程', file: 'love-learning/courses/178.md', kind: '课程', note: '' })", setup.context);
  const second = setup.requests.at(-1);
  second.resolve({ ok: true, text: async () => "新课程原文" });
  await flush();
  first.resolve({ ok: true, text: async () => "旧课程原文" });
  await flush();
  assert.equal(setup.elements.get("readerTitle").textContent, "新的课程");
  assert.equal(setup.elements.get("readerBody").children[0].textContent, "新课程原文");
});

async function loadManifest(setup, courses = [course]) {
  setup.requests[0].resolve({ ok: true, json: async () => ({ course_count: courses.length, courses, books: [] }) });
  await flush();
}

test("a direct course link opens the requested original after fresh manifest loading", async () => {
  const setup = await page("?course=179");
  assert.equal(setup.requests[0].url, "/love-learning/manifest.json?v=20261003-tutorial-r1");
  assert.equal(setup.requests[0].options.cache, "no-store");
  await loadManifest(setup);
  const requested = setup.requests.at(-1);
  assert.equal(requested.url, "/love-learning/courses/179.md");
  assert.equal(requested.options.cache, "no-cache");
  requested.resolve({ ok: true, text: async () => "第179课原文" });
  await flush();
  assert.equal(setup.elements.get("readerBody").children[0].textContent, "第179课原文");
  assert.deepEqual(setup.storageWrites, []);
});

test("invalid, repeated, or unavailable lesson numbers give a readable message without requesting assets", async () => {
  for (const search of ["?course=0", "?course=-1", "?course=1.5", "?course=abc", "?course=1&course=179", "?course=999"]) {
    const setup = await page(search);
    await loadManifest(setup);
    assert.equal(setup.requests.length, 1);
    assert.match(setup.elements.get("readerBody").children[0].textContent, /编号无效|没有第 999 课/);
    assert.deepEqual(setup.storageWrites, []);
  }
});

test("a legacy course without an asset path gives the safe rebuild command", async () => {
  const setup = await page("?course=179");
  const legacy = { ...course };
  delete legacy.file;
  await loadManifest(setup, [legacy]);
  assert.equal(setup.requests.length, 1);
  assert.match(setup.elements.get("readerBody").children[0].textContent, /正文暂未生成.*--courses-only/);
});

test("a failed manifest response keeps the safe rebuild instruction visible", async () => {
  const setup = await page("?course=179");
  setup.requests[0].resolve({ ok: false, status: 404 });
  await flush();
  assert.match(setup.elements.get("view-courses").innerHTML, /无法加载学习数据.*--courses-only/);
  assert.equal(setup.requests.length, 1);
});

test("the tutorial page starts with courses and keeps map and bookshelf navigation available", async () => {
  const setup = await page();
  assert.equal(setup.elements.get("view-courses").classList.contains("is-active"), true);
  assert.equal(setup.elements.get("view-map").classList.contains("is-active"), false);
  assert.equal(setup.tabs[0].attributes["aria-selected"], "true");
  setup.tabs.find((tab) => tab.dataset.view === "map").onclick();
  assert.equal(setup.elements.get("view-map").classList.contains("is-active"), true);
  assert.equal(setup.elements.get("view-courses").classList.contains("is-active"), false);
  setup.tabs.find((tab) => tab.dataset.view === "books").onclick();
  assert.equal(setup.elements.get("view-books").classList.contains("is-active"), true);
  assert.equal(setup.elements.get("view-map").classList.contains("is-active"), false);
  assert.deepEqual(setup.storageWrites, []);
});

test("view links select only list, map, or books and repeated or invalid views return to the list", async () => {
  for (const [search, active] of [
    ["?view=list", "courses"], ["?view=map", "map"], ["?view=books", "books"],
    ["?view=unknown", "courses"], ["?view=constructor", "courses"],
    ["?view=books&view=map", "courses"], ["?view=books&view=books", "courses"]
  ]) {
    const setup = await page(search);
    for (const view of ["courses", "map", "books"]) {
      assert.equal(setup.elements.get("view-" + view).classList.contains("is-active"), view === active);
    }
  }
});

test("a requested course takes precedence over the bookshelf view without marking it learned", async () => {
  const setup = await page("?view=books&course=179");
  assert.equal(setup.elements.get("view-courses").classList.contains("is-active"), true);
  await loadManifest(setup);
  assert.equal(setup.requests.at(-1).url, "/love-learning/courses/179.md");
  assert.deepEqual(setup.storageWrites, []);
});
