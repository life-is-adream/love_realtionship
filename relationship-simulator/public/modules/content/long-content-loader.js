/**
 * 长篇内容加载器（P2-13 拆包懒加载）。
 *
 * 产物结构（scripts/build-long-index.mjs 生成，勿手编）：
 *   - long-content-manifest.js   章节元信息 + chunk 映射（~2.7KB，首屏唯一长篇数据）
 *   - long-content/chapter-XX.js 单章完整数据（21~155KB，按需 dynamic import）
 *
 * 职责：manifest 缓存 + 单章 chunk 的 Promise 级缓存 + 全章聚合。
 * 纯 IO 封装：无 DOM、无状态写路径，供渲染模块 / 教材检索 / 测试共用。
 */

let manifestPromise = null;
const chapterCache = new Map(); // String(chapterId) -> Promise<chapter>

/**
 * 加载长篇索引 manifest（章节元信息，同步语义下首次调用即开始拉取）。
 * @returns {Promise<{generatedAt: string, source: string, totalChapters: number, chapters: Array<{id:number,title:string,file:string,summary:string,reviewCount:number,sectionCount:number,chunk:string}>}>}
 */
export function loadManifest() {
  manifestPromise ??= import("./long-content-manifest.js").then((m) => m.longContentManifest);
  return manifestPromise;
}

/**
 * 加载单章完整数据（sections + reviewPoints），结果按 Promise 缓存，重复调用零开销。
 * @param {number|string} chapterId
 * @returns {Promise<object>}
 */
export function loadChapterIndex(chapterId) {
  const id = Number(chapterId);
  if (!Number.isInteger(id) || id < 1) {
    return Promise.reject(new Error(`无效章节 ID：${chapterId}`));
  }
  const key = String(id);
  if (!chapterCache.has(key)) {
    const chunkNumber = key.padStart(2, "0");
    chapterCache.set(key, import(`./long-content/chapter-${chunkNumber}.js`).then((m) => m.chapter));
  }
  return chapterCache.get(key);
}

/**
 * 聚合全部 10 章（与旧 longContentIndex.chapters 等价的数组）。
 * 仅供教材检索索引构建与测试聚合使用，页面交互路径请用 loadChapterIndex。
 * @returns {Promise<Array<object>>}
 */
export async function loadAllChapters() {
  const manifest = await loadManifest();
  return Promise.all(manifest.chapters.map((chapter) => loadChapterIndex(chapter.id)));
}
