import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 测试用的约定检查器辅助函数。
 *
 * 存在理由：把「某文件的插值是否转义」这件事交给**真正执行的 R1 规则**判定，
 * 而不是靠 `assert.match(source, /escapeHtml/)` 这种只要文件里出现过一次
 * escapeHtml 就通过的假断言。
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKER = path.join(REPO_ROOT, "scripts", "check-conventions.mjs");

/** 跑一次全仓检查器，返回指定文件上的指定规则违规 */
export function conventionViolationsFor(relPath, rule) {
  const result = spawnSync(process.execPath, [CHECKER, "--root", REPO_ROOT, "--json"], {
    encoding: "utf8",
    cwd: REPO_ROOT
  });
  const parsed = JSON.parse(result.stdout);
  return parsed.violations.filter((v) => v.file === relPath && (!rule || v.rule === rule));
}

/** R1 专用：该文件是否存在未转义的文本类 HTML 插值 */
export function r1ViolationsFor(relPath) {
  return conventionViolationsFor(relPath, "html-interpolation-escape");
}
