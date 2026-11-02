// 本地可编辑应用使用统一模块版本，避免新入口配上浏览器里的旧依赖。
export const APP_ASSET_VERSION = "20261013-abilities-r1";

export function versionModuleSpecifier(specifier, version = APP_ASSET_VERSION) {
  if (!/^\.\.?\//.test(specifier)) return specifier;
  const [withoutHash, hash] = specifier.split("#", 2);
  const [pathname, query = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("v", version);
  return `${pathname}?${params}${hash ? `#${hash}` : ""}`;
}

export function versionModuleImports(source, version = APP_ASSET_VERSION) {
  const update = (prefix, quote, specifier) => `${prefix}${quote}${versionModuleSpecifier(specifier, version)}${quote}`;
  return String(source)
    .replace(/(^[ \t]*(?:import|export)\s+[^'";]*?\s+from\s*)(['"])(\.\.?\/[^'"\r\n]+)\2/gm, (_, prefix, quote, specifier) => update(prefix, quote, specifier))
    .replace(/(^[ \t]*import\s*)(['"])(\.\.?\/[^'"\r\n]+)\2/gm, (_, prefix, quote, specifier) => update(prefix, quote, specifier))
    .replace(/(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"\r\n]+)\2/g, (_, prefix, quote, specifier) => update(prefix, quote, specifier));
}

export function staticCacheControl(extension) {
  return [".html", ".js", ".css", ".json", ".md", ".txt"].includes(extension)
    ? "no-cache" : "public, max-age=86400";
}
