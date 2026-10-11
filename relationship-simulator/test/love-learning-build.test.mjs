import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildLoveLearning } from "../scripts/build-love-learning.mjs";

async function fixture(t, numbers) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "love-learning-build-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true });
  });
  const sourceDirectory = path.join(directory, "source");
  const outputDirectory = path.join(directory, "public", "love-learning");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(path.join(outputDirectory, "books"), { recursive: true });
  const books = [{ id: "existing", file: "love-learning/books/existing.txt", bytes: 4, provenance: { license: "unknown", reviewed: true }, custom: ["keep"] }];
  await writeFile(path.join(outputDirectory, "books", "existing.txt"), "keep");
  await writeFile(path.join(outputDirectory, "manifest.json"), JSON.stringify({ books, book_count: 1, extra: "preserve" }));
  for (const number of numbers) {
    const bytes = Buffer.from(`\uFEFF# 第 ${number} 课：练习\r\n\r\n## 今天的目标\r\n\r\n保留原有字节与换行。\r\n`);
    await writeFile(path.join(sourceDirectory, `2027-01-01-第${number}课-练习.md`), bytes);
  }
  return { directory, sourceDirectory, outputDirectory, books };
}

test("courses-only indexes 1–179, publishes exact source bytes, and preserves every book field", async (t) => {
  const setup = await fixture(t, Array.from({ length: 179 }, (_, index) => index + 1));
  const manifest = await buildLoveLearning({ ...setup, coursesOnly: true, bookSourceDirectory: path.join(setup.directory, "missing") });
  assert.equal(manifest.course_count, 179);
  assert.deepEqual(manifest.courses.map((course) => course.no), Array.from({ length: 179 }, (_, index) => index + 1));
  assert.deepEqual(manifest.books, setup.books);
  assert.equal(manifest.book_count, 1);
  assert.equal(manifest.extra, "preserve");
  assert.equal(await readFile(path.join(setup.outputDirectory, "books", "existing.txt"), "utf8"), "keep");
  assert.deepEqual(await readdir(path.join(setup.outputDirectory, "books")), ["existing.txt"]);
  const stages = new Set(manifest.stages.map((stage) => stage.id));
  const dims = new Set(manifest.dims.map((dim) => dim.id));
  for (const course of manifest.courses) {
    assert.ok(stages.has(course.stage));
    assert.ok(dims.has(course.dim));
    assert.equal(course.date, "2027-01-01");
    assert.equal(course.goal, "保留原有字节与换行。");
    const published = path.resolve(setup.outputDirectory, "..", course.file);
    assert.ok(published.startsWith(path.join(setup.outputDirectory, "courses") + path.sep));
    const source = path.join(setup.sourceDirectory, `2027-01-01-第${course.no}课-练习.md`);
    assert.deepEqual(await readFile(published), await readFile(source));
  }
  for (const no of [161, 162, 163, 165, 169, 170, 176, 179]) {
    assert.notEqual(manifest.courses[no - 1].stage, "marriage");
  }
  assert.equal(manifest.courses[172].dim, "intimacy");
  assert.equal(manifest.courses[176].stage, "repair");
});

test("invalid or duplicate lesson numbers leave the existing manifest unchanged", async (t) => {
  for (const numbers of [[1, 3], []]) {
    const setup = await fixture(t, numbers);
    const manifestPath = path.join(setup.outputDirectory, "manifest.json");
    const before = await readFile(manifestPath);
    await assert.rejects(buildLoveLearning({ ...setup, coursesOnly: true }), /连续且唯一/);
    assert.deepEqual(await readFile(manifestPath), before);
    assert.deepEqual(await readdir(setup.outputDirectory), ["books", "manifest.json"]);
  }
  const setup = await fixture(t, [1]);
  await writeFile(path.join(setup.sourceDirectory, "2027-01-02-第01课-重复.md"), "重复");
  await assert.rejects(buildLoveLearning({ ...setup, coursesOnly: true }), /连续且唯一/);
});

async function bookFixture(t, { sources = true, published = true } = {}) {
  const setup = await fixture(t, [1]);
  const existing = JSON.parse(await readFile(new URL("../public/love-learning/manifest.json", import.meta.url), "utf8"));
  const books = existing.books.map((book) => ({ ...book, note: "保留人工核验备注", provenance: { license: "unknown", reviewed: true }, custom: ["keep"] }));
  const bookSourceDirectory = path.join(setup.directory, "外道");
  await mkdir(bookSourceDirectory);
  const bytes = Buffer.from("中文书籍测试内容\r\n");
  for (const book of books) {
    book.bytes = bytes.length;
    if (sources) await writeFile(path.join(bookSourceDirectory, book.src), bytes);
    if (published) await writeFile(path.resolve(setup.outputDirectory, "..", book.file), bytes);
  }
  await writeFile(path.join(setup.outputDirectory, "manifest.json"), JSON.stringify({ books, book_count: books.length }));
  return { ...setup, books, bookSourceDirectory, bytes };
}

test("a full rebuild keeps 19 books, reviewed metadata, and actual byte sizes", async (t) => {
  const setup = await bookFixture(t, { published: false });
  const manifest = await buildLoveLearning(setup);
  assert.equal(manifest.book_count, 19);
  assert.equal(manifest.books.length, 19);
  for (const book of manifest.books) {
    assert.equal(book.note, "保留人工核验备注");
    assert.deepEqual(book.provenance, { license: "unknown", reviewed: true });
    assert.deepEqual(book.custom, ["keep"]);
    assert.equal(book.bytes, setup.bytes.length);
    assert.notEqual(book.bytes, setup.bytes.toString("utf8").length);
    assert.deepEqual(await readFile(path.resolve(setup.outputDirectory, "..", book.file)), setup.bytes);
  }
});

test("missing book sources preserve all readable published books and their metadata", async (t) => {
  const setup = await bookFixture(t, { sources: false });
  const warnings = [];
  const before = await Promise.all(setup.books.map((book) => stat(path.resolve(setup.outputDirectory, "..", book.file))));
  const manifest = await buildLoveLearning({ ...setup, onWarning: (message) => warnings.push(message) });
  assert.equal(manifest.book_count, 19);
  assert.deepEqual(manifest.books, setup.books);
  assert.equal(warnings.length, 19);
  for (const [index, book] of manifest.books.entries()) {
    const published = path.resolve(setup.outputDirectory, "..", book.file);
    assert.deepEqual(await readFile(published), setup.bytes);
    assert.equal((await stat(published)).mtimeMs, before[index].mtimeMs);
  }
});

test("unavailable source and published book fail before writing any assets", async (t) => {
  const setup = await bookFixture(t, { sources: false, published: false });
  const filename = path.join(setup.outputDirectory, "manifest.json");
  const previous = await readFile(filename);
  const entries = await readdir(setup.outputDirectory);
  await assert.rejects(buildLoveLearning(setup), /来源与公开副本均不可用.*未更新课程或 manifest/);
  assert.deepEqual(await readFile(filename), previous);
  assert.deepEqual(await readdir(setup.outputDirectory), entries);
});

test("book metadata cannot copy assets outside the selected directories", async (t) => {
  const setup = await bookFixture(t);
  const filename = path.join(setup.outputDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  manifest.books.push({ id: "../outside", src: "../outside.txt", file: "../outside.txt" });
  await writeFile(filename, JSON.stringify(manifest));
  const previous = await readFile(filename);
  await assert.rejects(buildLoveLearning(setup), /书籍 ID 不合法/);
  assert.deepEqual(await readFile(filename), previous);
  assert.deepEqual(await readdir(setup.outputDirectory), ["books", "manifest.json"]);
});
