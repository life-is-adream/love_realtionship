// 从 PyPI JSON API 解析匹配当前 Python/平台 best wheel，输出 URL 列表供 curl 下载。
// 用法: node voice/fetch_wheels.mjs onnxruntime numpy phonemizer segments espeakng-loader
const PY_TAG = "cp313";
const PLATFORM_TAGS = ["win_amd64", "py3-none-any"];

function pickFile(pkg, json) {
  const urls = json?.urls || [];
  const candidates = urls.filter((u) => u.filename.endsWith(".whl"));
  // 优先 cp313-win_amd64，其次 py3-none-any
  const cp = candidates.find((u) => u.filename.includes(PY_TAG) && u.filename.includes("win_amd64"));
  if (cp) return cp;
  const any = candidates.find((u) => u.filename.includes("py3-none-any"));
  if (any) return any;
  const nt = candidates.find((u) => u.filename.includes("win_amd64"));
  return nt || null;
}

const pkgs = process.argv.slice(2);
const results = [];
for (const pkg of pkgs) {
  const res = await fetch(`https://pypi.org/pypi/${pkg}/json`);
  if (!res.ok) {
    console.error(`[skip] ${pkg}: HTTP ${res.status}`);
    continue;
  }
  const json = await res.json();
  const file = pickFile(pkg, json);
  if (!file) {
    console.error(`[warn] ${pkg}: 无匹配 wheel，版本 ${json.info?.version}`);
    continue;
  }
  console.log(`${file.url}|${file.filename}`);
  results.push({ pkg, version: json.info?.version, requires: json.info?.requires_dist || [] });
}
// 依赖信息输出到 stderr，便于人工确认是否还有遗漏
console.error(JSON.stringify(results.map((r) => ({ pkg: r.pkg, version: r.version, requires: r.requires.filter((d) => !d.includes("extra ==")) })), null, 0));
