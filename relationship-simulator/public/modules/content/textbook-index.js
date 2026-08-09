/**
 * 教材检索索引的共享单例。
 *
 * long-content-index.js 是 33,384 行的生成产物，展开成检索索引开销不小；
 * app.js 与 render-learning.js 过去各自 build 一次。这里统一构建一次并缓存，
 * 避免重复全量展开。此模块无 DOM / 网络依赖。
 */
import { longContentIndex } from "./long-content-index.js";
import { buildTextbookSearchIndex } from "./textbook-search.js";

let cachedIndex = null;

/**
 * 返回共享的教材检索索引（懒构建 + 缓存）。
 * @returns {{entries: Array<object>}}
 */
export function getSharedTextbookIndex() {
  if (!cachedIndex) cachedIndex = buildTextbookSearchIndex(longContentIndex);
  return cachedIndex;
}
