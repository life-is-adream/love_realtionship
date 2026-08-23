import { searchWeb } from "../core/api-client.js";
import { $, escapeHtml } from "../core/dom.js";

export async function runCoachFloatSearch({
  analysis = {},
  stage = "",
  target = $("coachFloatSearchResult"),
  search = searchWeb
} = {}) {
  if (!target) return null;
  const weakest = analysis?.coachScore?.weakestDim || "boundary";
  const query = `${stage || "恋爱沟通"} ${weakest} 沟通建议`;
  target.innerHTML = "检索中（只发送查询词，不发送对话）…";

  try {
    const result = await search(query);
    if (!result.results.length) {
      target.innerHTML = result.filtered
        ? "搜索完成，但结果均非白名单权威来源，已过滤。"
        : "未找到权威来源结果。";
      return result;
    }
    target.innerHTML = `<div class="coach-float-search-head">权威来源 ${result.results.length} 条${result.filtered ? `（过滤 ${result.filtered} 条）` : ""}</div>` +
      result.results.map((item) => `<a class="coach-float-search-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(item.title || "未命名来源")}</b><small>${escapeHtml(item.snippet || "")}</small></a>`).join("");
    return result;
  } catch (error) {
    target.innerHTML = `联网搜索不可用：${escapeHtml(error?.message || error)}`;
    return null;
  }
}
