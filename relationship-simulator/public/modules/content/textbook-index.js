/**
 * 教材检索索引的共享单例。
 *
 * 长篇数据自 P2-13 起按章拆分为懒加载 chunk（经 long-content-loader 获取），
 * 全量聚合只在首次构建检索索引时发生一次并缓存，避免重复展开。
 * 此模块无 DOM / 网络依赖；自本版本起构建过程为异步（需等待 chunk 加载完成）。
 */
import { loadAllChapters } from "./long-content-loader.js";
import { buildTextbookSearchIndex } from "./textbook-search.js";

let cachedIndex = null;

/**
 * 返回共享的教材检索索引（懒构建 + 缓存）。
 * @returns {Promise<{entries: Array<object>}>}
 */
export async function getSharedTextbookIndex() {
  if (!cachedIndex) cachedIndex = buildTextbookSearchIndex(await loadAllChapters());
  return cachedIndex;
}
