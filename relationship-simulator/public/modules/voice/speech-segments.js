/**
 * 角色音色的分段朗读策略（S2）。
 *
 * 与 voice/character_voices/eval/evaluate.py::split_segments 保持同口径，
 * 保证评测里测到的「分段 + 400ms 留白」能原样落到生产播放链路。
 * 这里只放纯函数，不碰 DOM、不碰网络，便于 tts-client、试听页与测试共用同一份实现。
 */

// 标点集合与 evaluate.py 的 PUNCT_CHARS 逐字一致：切段时标点留在段尾，
// 连续标点（……！？）并入同一段。
export const SEGMENT_PUNCT_CHARS = "，。、！？；：,.;!?…";

// 段间留白。eval/PROSODY.md 实测 400ms 是唯一「声纹无损 + 中文留白显著」的取值。
export const SEGMENT_GAP_MS = 400;

// 短句多请求只会增加固定开销，不分段。
export const SEGMENT_MIN_CHARS = 12;

const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff]/;

/** 文本里是否含日文假名。日语的 seg 在评测里不显著，整句一次请求更稳。 */
export function hasKana(text) {
  return KANA_RE.test(String(text || ""));
}

/** 按标点切段，标点留在段尾；与评测的 split_segments 同口径。 */
export function splitSpeechSegments(text) {
  const source = String(text || "");
  const segments = [];
  let buffer = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (SEGMENT_PUNCT_CHARS.includes(ch)) {
      buffer += ch;
      let j = i + 1;
      while (j < source.length && SEGMENT_PUNCT_CHARS.includes(source[j])) {
        buffer += source[j];
        j += 1;
      }
      if (buffer.trim()) segments.push(buffer.trim());
      buffer = "";
      i = j;
    } else {
      buffer += ch;
      i += 1;
    }
  }
  if (buffer.trim()) segments.push(buffer.trim());
  return segments;
}

/**
 * 是否启用 S2 分段播放。
 *
 * 仅角色引擎 + 中文长句：其它引擎服务端按句批处理更快（前端切句会让总时长翻倍）；
 * 含假名的日语文本，seg 的最长停顿改善落在噪声内，没有分段收益。
 */
export function shouldUseSegmentedSpeech(text, engine) {
  const source = String(text || "").trim();
  if (engine !== "character") return false;
  if (hasKana(source)) return false;
  if (source.length < SEGMENT_MIN_CHARS) return false;
  return splitSpeechSegments(source).length >= 2;
}
