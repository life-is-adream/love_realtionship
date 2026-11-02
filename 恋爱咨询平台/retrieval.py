#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
课程检索：把 179 课 + 6 节补丁课 + 总纲 建成一个零依赖的本地索引。

设计要点
- 中文不装分词库：用「字 bigram + 英文单词」做检索单元。中文双字重叠已经能覆盖大部分语义近邻，
  代价是召回略宽，用 BM25 的 idf 把它压回来。
- 字段权重：标题 3、目标 2、正文 1。标题里出现的词最说明课程主题。
- 阶段/维度路由：查询里出现「表白/挽回/见家长」这类强意图词时，额外给对应 stage/dim 的课加分。
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # 恋爱15分钟学习/.. = 课程根目录
COURSE_ROOT = Path(r"E:/一门给年轻人的恋爱成长课")
LESSON_DIR = COURSE_ROOT / "恋爱15分钟学习" / "每日课程"
SUPP_DIR = COURSE_ROOT / "恋爱15分钟学习" / "每日课程-v2-样板" / "新增课"
INDEX_V2 = COURSE_ROOT / "恋爱15分钟学习" / "每日课程-v2-样板" / "lesson-index.json"
MANIFEST = COURSE_ROOT / "relationship-simulator" / "public" / "love-learning" / "manifest.json"
OUTLINE = COURSE_ROOT / "恋爱15分钟学习" / "课程总纲.md"
OUTLINE_V2 = COURSE_ROOT / "恋爱15分钟学习" / "每日课程-v2-样板" / "总纲-v2.md"

SAFETY_TERMS = [
    "自杀", "想死", "不想活", "活不下去", "自残", "割腕", "跳楼", "轻生",
    "打死", "家暴", "暴力", "打我", "掐我", "威胁", "性侵", "强奸", "迷药", "跟踪", "非法拘禁",
    "摔", "砸", "动手", "控制我", "查我手机", "不让我见", "监视我", "限制我",
]

STAGE_CN = {
    "attraction": "认识吸引", "connection": "建立联系", "dating": "约会相处",
    "commitment": "确立关系", "stability": "经营稳定", "repair": "危机修复", "marriage": "婚姻家庭",
}
DIM_CN = {
    "advance": "关系推进", "communicate": "沟通与情绪", "intimacy": "亲密与性",
    "life": "生活与家庭", "self": "自我与择偶",
}
LAYER_CN = {
    "M1": "吸引与选择", "M2": "信号与不确定性", "M3": "依恋与情绪调节",
    "M4": "沟通与修复", "M5": "承诺与维持",
}

# 虚词 bigram：出现在标题里会制造假匹配，查询时直接丢弃
STOP = {
    "不是", "是不", "我们", "你们", "他们", "什么", "怎么", "这个", "那个", "自己",
    "可以", "但是", "因为", "所以", "如果", "就是", "还是", "已经", "现在", "知道",
    "觉得", "继续", "一步", "一个", "没有", "可能", "时候", "一样", "这样", "那样",
    "而且", "然后", "其实", "真的", "有点", "一直", "开始", "不要", "不会", "不能",
}

# 口语表达 → 课程词表（查询扩展，权重 0.6）
SYNONYMS = {
    "查手机": ["隐私", "控制", "边界"],
    "查我手机": ["隐私", "控制"],
    "不让我": ["控制", "孤立", "边界"],
    "手机": ["隐私"],
    "说这是爱我": ["情感操控"],
    "爱我": ["情感操控", "控制"],
    "回得": ["回复", "消息节奏"],
    "回我": ["回复", "消息"],
    "不回": ["消息节奏", "冷暴力"],
    "越来越慢": ["回复速度", "节奏"],
    "没话说": ["聊天", "停顿"],
    "聊得": ["聊天", "对话"],
    "表白": ["表达好感", "明确关系", "拒绝"],
    "回消息": ["消息节奏", "回复速度"],
    "慢": ["节奏", "延迟"],
    "不理": ["冷暴力", "沉默"],
    "冷战": ["冷暴力", "暂停"],
    "摔": ["暴力", "控制", "安全"],
    "动手": ["暴力", "安全", "退出"],
    "挽回": ["结束关系", "信任重建", "断联"],
    "复合": ["结束关系", "信任重建"],
    "见家长": ["家庭边界", "父母"],
    "吃醋": ["嫉妒", "归因"],
    "内耗": ["自我价值", "情绪调节"],
    "自卑": ["自我价值"],
    "黏": ["需要感", "依恋"],
    "忽冷忽热": ["操控", "信号"],
    "不知道说什么": ["聊天", "停顿", "提问"],
    "第一次约会": ["低压力约会", "场景"],
    "结婚": ["婚姻准备度", "承诺"],
    "孩子": ["生育", "育儿"],
    "钱": ["金钱透明", "费用"],
}

# 意图 → (stage, dim) 加权路由
ROUTES = [
    (["表白", "确立关系", "在一起", "暧昧", "确定关系"], {"commitment": 1.6, "dating": 0.9, "advance": 0.3}),
    (["约会", "见面", "邀约", "第一次"], {"dating": 1.6}),
    (["聊天", "回复", "怎么回", "尬聊", "消息", "微信"], {"connection": 1.4, "advance": 0.6}),
    (["认识", "搭讪", "开场", "社交", "圈子"], {"attraction": 1.4, "connection": 0.6}),
    (["吵架", "冲突", "冷战", "冷暴力", "沟通", "道歉", "情绪"], {"stability": 1.2, "communicate": 1.4}),
    (["分手", "挽回", "断联", "复合", "离开", "离婚"], {"repair": 1.6}),
    (["出轨", "不忠", "信任", "背叛"], {"repair": 1.4, "stability": 0.6}),
    (["结婚", "婚姻", "彩礼", "婚礼", "见家长", "订婚"], {"marriage": 1.6}),
    (["性", "亲密", "避孕", "同意", "身体"], {"intimacy": 1.5}),
    (["钱", "家务", "异地", "父母", "生育", "孩子", "房子"], {"life": 1.5}),
    (["自卑", "焦虑", "内耗", "自我价值", "依恋", "择偶", "喜欢什么"], {"self": 1.5}),
    (["家暴", "暴力", "控制", "威胁", "跟踪", "骚扰", "摔"], {"repair": 1.8, "stability": 0.5}),
]


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "")).strip()


def tokenize(text: str):
    text = (text or "").lower()
    toks = []
    for w in re.findall(r"[a-z0-9]{2,}", text):
        toks.append(w)
    zh = re.findall(r"[\u4e00-\u9fff]+", text)
    for seg in zh:
        if len(seg) == 1:
            toks.append(seg)
            continue
        for i in range(len(seg) - 1):
            toks.append(seg[i:i + 2])
    return toks


def _clean_body(md: str) -> str:
    md = re.sub(r"^#.*$", " ", md, flags=re.M)
    md = re.sub(r"`{1,3}[^`]*`{1,3}", " ", md)
    md = re.sub(r"[|>#*\-]{2,}", " ", md)
    return _norm(md)


def parse_sections(md: str):
    """按二级标题切段，保留原文，供"引用核验"使用。"""
    parts = re.split(r"^##\s+", md, flags=re.M)
    out = []
    for p in parts[1:]:
        head, _, rest = p.partition("\n")
        text = _clean_body(rest)
        if len(text) >= 12:
            out.append({"h": head.strip(), "t": text})
    if not out:
        text = _clean_body(md)
        if text:
            out.append({"h": "", "t": text})
    return out


class CourseIndex:
    def __init__(self):
        self.docs = []
        self._build()
        self.N = len(self.docs)
        self.avgdl = sum(d["len"] for d in self.docs) / max(1, self.N)
        self.avgdl_topic = sum(d["len_topic"] for d in self.docs) / max(1, self.N)
        self.df = {}
        for d in self.docs:
            for t in set(d["tf_topic"]) | set(d["tf"]):
                self.df[t] = self.df.get(t, 0) + 1

    # ---------- 构建 ----------
    def _manifest(self):
        if not MANIFEST.exists():
            return {}
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        return {int(c["no"]): c for c in data.get("courses", []) if "no" in c}

    def _layers(self):
        if not INDEX_V2.exists():
            return {}
        data = json.loads(INDEX_V2.read_text(encoding="utf-8"))
        return {int(x["id"]): x for x in data.get("lessons", [])}

    def _add(self, doc):
        raw = doc.pop("raw", "") or ""
        sections = parse_sections(raw)
        doc["sections"] = sections
        doc["body"] = _norm(" ".join(s["t"] for s in sections))

        # 主题场：标题 + 概念标签 + 目标。这三个字段才决定"这课讲什么"。
        topic_tf, body_tf = {}, {}
        for field, weight in (("title", 2.0), ("concepts", 3.0), ("goal", 1.5)):
            val = doc.get(field, "")
            if isinstance(val, (list, tuple)):
                val = " ".join(val)
            for t in tokenize(val):
                topic_tf[t] = topic_tf.get(t, 0.0) + weight
        for t in tokenize(doc["body"]):
            body_tf[t] = body_tf.get(t, 0.0) + 1.0
        d = dict(doc)
        d["tf_topic"] = topic_tf
        d["len_topic"] = sum(topic_tf.values()) or 1.0
        d["tf"] = body_tf                      # 兼容旧字段
        d["len"] = sum(body_tf.values()) or 1.0
        d["title_toks"] = set(tokenize(doc.get("title", "")))
        self.docs.append(d)

    def _build(self):
        man = self._manifest()
        layers = self._layers()

        for no in sorted(man):
            m = man[no]
            path = None
            for p in LESSON_DIR.glob(f"*-第{no:02d}课-*.md"):
                path = p
                break
            body = path.read_text(encoding="utf-8", errors="replace") if path else ""
            v2 = layers.get(no, {})
            self._add({
                "kind": "lesson", "no": no,
                "title": m.get("title", f"第 {no} 课"),
                "goal": m.get("goal", ""),
                "concepts": v2.get("concepts", []),
                "raw": body,
                "stage": m.get("stage", ""), "dim": m.get("dim", ""),
                "layer": v2.get("layer", ""), "season": v2.get("season", ""),
                "module_name": v2.get("module_name", ""),
                "file": str(path.relative_to(COURSE_ROOT)).replace("\\", "/") if path else m.get("file", ""),
            })

        if SUPP_DIR.exists():
            for p in sorted(SUPP_DIR.glob("*.md")):
                txt = p.read_text(encoding="utf-8", errors="replace")
                head = next((ln.lstrip("# ").strip() for ln in txt.splitlines() if ln.startswith("# ")), p.stem)
                head = re.sub(r"^新增课\s*[A-Z0-9\-]+：", "", head).strip()
                m = re.search(r"机制层：(M\d)", txt)
                goal_m = re.search(r"## 今天的目标\s*\n+([^\n#]{4,200})", txt)
                sid = "-".join(p.stem.split("-")[1:3])
                self._add({
                    "kind": "supplement", "no": sid,
                    "title": head,
                    "goal": (goal_m.group(1).strip() if goal_m else ""),
                    "raw": txt,
                    "stage": "", "dim": "", "layer": m.group(1) if m else "",
                    "season": "", "module_name": "补丁课",
                    "file": str(p.relative_to(COURSE_ROOT)).replace("\\", "/"),
                })

        for p, title in ((OUTLINE, "课程总纲 v1"), (OUTLINE_V2, "课程总纲 v2")):
            if p.exists():
                self._add({
                    "kind": "outline", "no": "总纲", "title": title, "goal": "",
                    "raw": p.read_text(encoding="utf-8", errors="replace"),
                    "stage": "", "dim": "", "layer": "", "season": "", "module_name": "",
                    "file": str(p.relative_to(COURSE_ROOT)).replace("\\", "/"),
                })

    # ---------- 查询 ----------
    def _idf(self, t):
        df = self.df.get(t, 0)
        return math.log(1 + (self.N - df + 0.5) / (df + 0.5))

    def search(self, query: str, k: int = 6):
        q = tokenize(query)
        if not q:
            return []
        weights = {}
        for t in q:
            weights[t] = weights.get(t, 0) + 1

        # 口语扩展：同义词只加 0.6 权重，避免盖过原始查询
        for w, extras in SYNONYMS.items():
            if w in query:
                for e in extras:
                    for t in tokenize(e):
                        weights[t] = max(weights.get(t, 0), 0.6)

        qset = set(weights)
        safety_hit = any(k in query for k in SAFETY_TERMS)

        # 查询词筛选：去掉虚词与高频词即可。不能按 idf 取前 N——那会专挑最罕见的
        # 噪声 bigram（"们认""识三"），反而把"慢""道歉""摔"这类真信号挤掉。
        filtered = {}
        for t, w in weights.items():
            if t in STOP:
                continue
            if self.df.get(t, 0) / max(1, self.N) > 0.25:
                continue
            filtered[t] = w
        weights = filtered or weights

        boosts = {"stage": {}, "dim": {}}
        for words, boost in ROUTES:
            if any(w in query for w in words):
                for key, v in boost.items():
                    if key in ("attraction", "connection", "dating", "commitment", "stability", "repair", "marriage"):
                        boosts["stage"][key] = max(boosts["stage"].get(key, 0), v)
                    else:
                        boosts["dim"][key] = max(boosts["dim"].get(key, 0), v)

        scored = []
        for d in self.docs:
            s_topic = 0.0
            s_body = 0.0
            for t, w in weights.items():
                f = d["tf_topic"].get(t)
                if f:
                    denom = f + 1.5 * (1 - 0.75 + 0.75 * d["len_topic"] / self.avgdl_topic)
                    s_topic += w * self._idf(t) * (f * 2.5) / denom
                fb = d["tf"].get(t)
                if fb:
                    denom = fb + 1.5 * (1 - 0.75 + 0.75 * d["len"] / self.avgdl)
                    s_body += w * self._idf(t) * (fb * 2.5) / denom
            # 主题场决定"是不是讲这个"，正文场只做确认，权重压到 0.22
            s = s_topic + 0.22 * s_body
            if s_topic <= 0 and s_body <= 0:
                continue
            # 主题场完全没命中 → 基本是正文里的巧合词，压掉大部分分
            if s_topic <= 0:
                s *= 0.25
            # 安全类查询：安全相关课必须排到最前，其余课整体降权，
            # 避免《道歉要包含改变》这类技巧课把《婚姻中的暴力与控制》压下去
            if safety_hit:
                blob = d["title"] + " " + " ".join(d.get("concepts") or [])
                if any(k in blob for k in ("暴力控制", "安全优先", "危险关系", "操控", "威胁", "风险识别", "暴力与")):
                    s *= 3.2
                else:
                    s *= 0.75
            # 标题命中：用户词直接出现在标题里，是强信号（封顶 6 分）
            hit = len(qset & d["title_toks"])
            if hit:
                s += min(6.0, 1.8 * hit)
            s *= boosts["stage"].get(d.get("stage"), 1.0) * boosts["dim"].get(d.get("dim"), 1.0)
            if d["kind"] == "lesson":
                s *= 1.05
            scored.append((s, d))

        scored.sort(key=lambda x: -x[0])
        out, seen = [], set()
        for s, d in scored:
            key = (d["kind"], str(d["no"]))
            if key in seen:
                continue
            seen.add(key)
            out.append((s, d))
            if len(out) >= k:
                break
        return out

    def _trim(self, text, hits, maxlen):
        pos = -1
        for h in hits:
            i = text.find(h)
            if i >= 0 and (pos < 0 or i < pos):
                pos = i
        if pos < 0:
            return text[:maxlen] + ("…" if len(text) > maxlen else "")
        start = max(0, pos - maxlen // 3)
        end = min(len(text), start + maxlen)
        seg = text[start:end]
        return ("…" if start > 0 else "") + seg + ("…" if end < len(text) else "")

    def quotes(self, doc, query, k=2, maxlen=150):
        """返回该课内与查询最相关的原文段落，用于"引用可核验"。"""
        secs = doc.get("sections") or []
        if not secs:
            return []
        toks = {t for t in tokenize(query) if t not in STOP}
        if not toks:
            toks = set(tokenize(query))
        scored = []
        for s in secs:
            st = set(tokenize(s["t"]))
            hit = [t for t in toks if t in st]
            if not hit:
                continue
            sc = sum(self._idf(t) for t in hit) / (1 + math.log(1 + len(s["t"]) / 120))
            scored.append((sc, s, hit))
        scored.sort(key=lambda x: -x[0])
        out = [{"heading": s["h"], "text": self._trim(s["t"], hit, maxlen)}
               for _, s, hit in scored[:k]]
        # 命中段落不足时，用「核心概念/机制」段兜底，保证引用卡至少有一条可核验的原文
        if len(out) < k:
            used = {o["heading"] for o in out}
            for s in secs:
                if len(out) >= k:
                    break
                if s["h"] in used:
                    continue
                if any(w in s["h"] for w in ("核心概念", "机制", "今天的目标")):
                    out.append({"heading": s["h"], "text": self._trim(s["t"], [], maxlen)})
        return out

    def get(self, no: int):
        for d in self.docs:
            if d["kind"] == "lesson" and d["no"] == no:
                return d
        return None

    def stats(self):
        lessons = [d for d in self.docs if d["kind"] == "lesson"]
        return {
            "total": self.N,
            "lessons": len(lessons),
            "supplements": len([d for d in self.docs if d["kind"] == "supplement"]),
            "stages": {STAGE_CN.get(k, k): len([d for d in lessons if d["stage"] == k])
                       for k in STAGE_CN},
            "layers": {LAYER_CN.get(k, k): len([d for d in lessons if d["layer"] == k])
                       for k in LAYER_CN},
        }


if __name__ == "__main__":
    idx = CourseIndex()
    print(json.dumps(idx.stats(), ensure_ascii=False, indent=1))
    for q in ["她回消息越来越慢", "我想表白但怕被拒绝", "吵架时他会摔东西"]:
        print("\nQ:", q)
        for s, d in idx.search(q, 4):
            print(f"  {s:6.2f} [{d['kind']}] {d['no']} {d['title']} | {STAGE_CN.get(d['stage'],'')} / {DIM_CN.get(d['dim'],'')} / {d['layer']}")
