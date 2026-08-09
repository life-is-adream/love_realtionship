import test from "node:test";
import assert from "node:assert/strict";
import { buildStageProgress, buildStageProgressHtml, STAGE_TOTAL } from "../public/modules/render/stage-progress.js";

test("STAGE_TOTAL 为 7", () => {
  assert.equal(STAGE_TOTAL, 7);
});

test("buildStageProgress 中间阶段计算百分比与解锁节点", () => {
  const progress = buildStageProgress("暧昧推进");
  assert.equal(progress.index, 4);
  assert.equal(progress.total, 7);
  assert.equal(progress.percent, Math.round((5 / 7) * 100));
  assert.equal(progress.current, "暧昧推进");
  assert.deepEqual(progress.unlocked, ["刚加微信后的第一晚", "隔天轻联系", "第一次邀约", "第一次约会后", "暧昧推进"]);
});

test("buildStageProgress 非法阶段按未开始处理", () => {
  const progress = buildStageProgress("不存在的阶段");
  assert.equal(progress.index, -1);
  assert.equal(progress.percent, 0);
  assert.deepEqual(progress.unlocked, []);
  assert.equal(progress.current, "");
});

test("buildStageProgress 最后一个阶段百分比为 100", () => {
  assert.equal(buildStageProgress("确定关系").percent, 100);
});

test("buildStageProgressHtml 输出安全的进度条结构", () => {
  const html = buildStageProgressHtml("第一次邀约");
  assert.match(html, /stage-progress-bar/);
  assert.match(html, /stage-dot active/);
  assert.match(html, /stage-dot done/);
  assert.match(html, /stage-dot todo/);
  assert.match(html, /width:43%/);
  assert.doesNotMatch(html, /[<>]/u.test(html.replace(/<\/?[a-z-]+[^>]*>/giu, "")) ? /<>/ : /never-match/);
});
