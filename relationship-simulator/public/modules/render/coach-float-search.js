import { searchWeb } from "../core/api-client.js";
import { $, escapeHtml } from "../core/dom.js";
import { createRequestScope } from "../core/request-scope.js";
import { STAGE_VALUES } from "../core/stages.js";

const dimensions = new Set(["naturalness", "empathy", "boundary", "momentum"]);
const targetScopes = new WeakMap();

function scopeFor(target) {
  if (!targetScopes.has(target)) targetScopes.set(target, createRequestScope(() => "search"));
  return targetScopes.get(target);
}

function safeReferenceUrl(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /[\s\\\u0000-\u001f\u007f]/.test(text)) return null;
  const authority = text.slice(text.indexOf("//") + 2).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function runCoachFloatSearch({
  analysis = {},
  stage = "",
  target = $("coachFloatSearchResult"),
  search = searchWeb,
  requestScope
} = {}) {
  if (!target) return null;
  const ticket = (requestScope || scopeFor(target)).begin("coach-search");
  const isCurrent = () => ticket.isCurrent() && target.isConnected !== false;
  const weakest = dimensions.has(analysis?.coachScore?.weakestDim) ? analysis.coachScore.weakestDim : "boundary";
  const query = `${STAGE_VALUES.includes(stage) ? stage : "恋爱沟通"} ${weakest} 沟通建议`;
  target.innerHTML = "检索中（只发送查询词，不发送对话）…";

  try {
    const result = await search(query, { signal: ticket.signal });
    if (!isCurrent()) return null;
    if (!Array.isArray(result?.results)) throw new Error("搜索返回格式无效。");
    const references = result.results.flatMap((item) => {
      const url = safeReferenceUrl(item?.url);
      return url ? [{ ...item, url }] : [];
    });
    const filtered = (Number.isFinite(result.filtered) ? Math.max(0, Math.trunc(result.filtered)) : 0) + result.results.length - references.length;
    const engineTag = result.model ? `（${escapeHtml(result.model)} 联网）` : "";
    if (!references.length) {
      target.innerHTML = filtered
        ? `<div class="coach-float-search-head">搜索完成，但 ${filtered} 条引用未通过域名或链接校验，已过滤。</div>`
        : `<div class="coach-float-search-head">未找到可用参考来源${engineTag}。</div>`;
      return result;
    }
    target.innerHTML = `<div class="coach-float-search-head">参考来源 ${references.length} 条${engineTag}${filtered ? `（过滤 ${filtered} 条）` : ""}</div>` +
      `<div class="coach-float-search-note">域名和链接筛选不能代替观点核验，请查看原文的适用范围。</div>` +
      references.map((item) => `<a class="coach-float-search-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(item.title || "未命名来源")}</b><small>${escapeHtml(item.snippet || "")}</small></a>`).join("");
    return result;
  } catch (error) {
    if (!isCurrent() || error?.name === "AbortError") return null;
    target.innerHTML = `联网搜索不可用：${escapeHtml(error?.message || error)}`;
    return null;
  } finally {
    ticket.finish();
  }
}
