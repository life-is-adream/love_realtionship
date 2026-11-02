#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
恋爱咨询台 · 本地服务（零依赖：只用 Python 标准库）

启动：python server.py [端口]
默认 http://127.0.0.1:8770

设计原则
- 密钥只在服务端：浏览器永远拿不到 MIMO_API_KEY。
- 安全前置：危机/暴力关键词由代码判定，命中则先注入固定求助信息，再让模型说话。
- 检索先行：先用本地课程索引找出 4 条最相关课程，再让模型基于材料回答，减少编造。
- 不落盘：不写聊天记录，不记内容日志，只记请求数与耗时。
"""
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from retrieval import CourseIndex, STAGE_CN, DIM_CN, LAYER_CN, SAFETY_TERMS

BASE_DIR = Path(__file__).resolve().parent
MIMO_BASE = os.environ.get("MIMO_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1").rstrip("/")
MIMO_KEY = os.environ.get("MIMO_API_KEY", "")
MIMO_MODEL = os.environ.get("MIMO_MODEL", "mimo-v2.6-pro")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770

SAFETY_BLOCK = (
    "**先处理安全，再谈关系。**\n\n"
    "如果你现在有伤害自己或他人的念头：立即联系 **12356（全国心理援助热线）**，"
    "或当地精神卫生中心热线；紧急情况 **110（报警）/ 120（急救）**。\n\n"
    "如果你正在经历推搡、殴打、掐颈、摔东西、限制人身或金钱自由、被威胁、被跟踪："
    "这不是「感情问题」，是安全问题。先确保能安全离开，联系一个可信任的人，必要时报警并保留证据（伤情照片、聊天记录、就医记录）。"
    "下面的建议只用于帮助你判断处境，不构成任何让你留在危险里的理由。\n\n---\n\n"
)

SYSTEM_PROMPT = """你是「恋爱咨询台」的咨询员，依据一套 185 节的本地课程体系回答。你不是话术库，也不做心理诊断。

【铁律】
1. 先安全，后关系。出现暴力、胁迫、跟踪、控制、性胁迫、自伤风险时，优先给退出与求助，不给任何推进技巧。
2. 每次回答同时给「推进」和「停止」两条路：说清什么情况下该停、看什么信号。
3. 不操控：不提供欺骗、冷处理惩罚、嫉妒测试、虚假稀缺、性压力、跟踪、偷拍的方案。
4. 不诊断、不贴类型标签。可以说「这可能是……在起作用」，不说「你是回避型」或「你有某种障碍」。
5. 不编造：不确定就写不确定。医疗、法律、避孕、性病、用药相关问题，明确说明「需以当前权威信息为准」，不给具体剂量或时限。
6. 不给概率：不写「她喜欢你 70%」这类数字。
7. 不复述用户提供的可识别信息（姓名、单位、地址、账号）。

【决策词】先给一个，五选一：
ADVANCE 推进｜MAINTAIN 维持｜OBSERVE 观察｜DE_ESCALATE 降级｜EXIT 退出。
安全触发时，EXIT / DE_ESCALATE 高于任何提高吸引力的目标。证据不足时用 OBSERVE，不要贸然 ADVANCE。

【证据分级】标注判断的可靠程度：
[E] 有研究支持｜[T] 成熟理论但证据混合｜[C] 课程综合与经验｜[U] 流行但有争议。
群体结论不要直接预测个体。

【回答结构】中文，300–600 字，短句，不用开场套话，不用「亲爱的」这类称呼，不写鼓励式排比。
1. **判断**：一句话给决策词 + 理由。
2. **机制**：这件事在心理上怎么运作，只讲一个机制。
3. **可以做的**：1–2 个具体动作，能给原话就给原话。
4. **停止条件**：出现什么信号就停。
5. **参考课程**：格式【第 N 课《标题》】，最多 3 条，只能引用下方材料里出现过的课。

【引用必须可核验】每条引用后跟一句「对应原文：……」，用下方该课「原文」字段里的话，不要自己改写。
材料没支持的判断，不要挂课程编号，改标 [C]。引错编号会被系统标为「未核验」——宁可不引，也不要凑数。

【课程材料】只能基于下面的材料与通用心理学常识回答。材料没覆盖的，直说「课程里没有直接讲这个」。
"""


def build_context(hits, quotes_map, max_body=600):
    if not hits:
        return "（未检索到相关课程）"
    blocks = []
    for score, d in hits:
        meta = []
        if d.get("stage"):
            meta.append(f"阶段：{STAGE_CN.get(d['stage'], d['stage'])}")
        if d.get("dim"):
            meta.append(f"维度：{DIM_CN.get(d['dim'], d['dim'])}")
        if d.get("layer"):
            meta.append(f"机制层：{LAYER_CN.get(d['layer'], d['layer'])}")
        label = f"第 {d['no']} 课" if d["kind"] == "lesson" else str(d["no"])
        head = f"【{label}《{d['title']}》｜{' ｜ '.join(meta) if meta else '补丁课/总纲'}】"
        body = (d.get("body") or "")[:max_body]
        goal = d.get("goal") or ""
        qs = quotes_map.get((d["kind"], str(d["no"])), [])
        qlines = "".join(f"\n  原文〔{q['heading']}〕：{q['text']}" for q in qs)
        blocks.append(f"{head}\n目标：{goal}\n摘要：{body}{qlines}")
    return "\n\n".join(blocks)


def call_mimo(messages, temperature=0.4, max_tokens=900):
    payload = {
        "model": MIMO_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    # mimo-v2.5 默认会先生成思考链，实测把 9.3s 压到 2.8s。
    # 需要更深推理时设 MIMO_THINKING=on 再启动。
    if os.environ.get("MIMO_THINKING", "off").lower() != "on":
        payload["thinking"] = {"type": "disabled"}
    req = urllib.request.Request(
        f"{MIMO_BASE}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {MIMO_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8", "replace"))
    msg = data.get("choices", [{}])[0].get("message", {}) or {}
    text = (msg.get("content") or "").strip()
    if not text and msg.get("reasoning_content"):
        text = msg["reasoning_content"].strip()
    return text, time.time() - t0, data.get("usage") or {}


def call_mimo_stream(messages, temperature=0.4, max_tokens=700):
    payload = {
        "model": MIMO_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if os.environ.get("MIMO_THINKING", "off").lower() != "on":
        payload["thinking"] = {"type": "disabled"}
    req = urllib.request.Request(
        f"{MIMO_BASE}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {MIMO_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=180)


DECISIONS = ("ADVANCE", "MAINTAIN", "OBSERVE", "DE_ESCALATE", "EXIT")

# 「判断：XXX」这类带标签的写法优先采信，避免正文里随口提到别的词被误取
DECISION_LABEL_RE = re.compile(
    r"(?:判断|结论|决策)[^\n]{0,6}?[：:][\*\s]*"
    r"(ADVANCE|MAINTAIN|OBSERVE|DE_ESCALATE|EXIT)"
)


def detect_decision(text, crisis=False):
    """识别五档判断。

    1) 优先取带标签的「判断：XXX」；
    2) 否则取全文中**最早出现**的那个词（不能按 DECISIONS 的顺序取，
       否则正文里先说了 OBSERVE、后结论 EXIT 时会被判成 OBSERVE）；
    3) 危机场景兜底 EXIT——安全路径不允许出现「没有判断」。

    注意不能只看开头若干字符：危机路径会在最前面插入安全提示块，
    模型的判断词会被挤到后面。
    """
    t = text or ""
    m = DECISION_LABEL_RE.search(t)
    if m:
        return m.group(1)
    best, best_pos = None, len(t) + 1
    for d in DECISIONS:
        p = t.find(d)
        if p != -1 and p < best_pos:
            best, best_pos = d, p
    if best:
        return best
    return "EXIT" if crisis else None


CITE_RE = re.compile(r"第\s*(\d{1,3})\s*课")

# 归一化：只保留汉字与字母数字，丢弃标点/空白/markdown 记号。
# 目的：模型常把原文的“”写成 ""、把「，」写成 ","，这类排版差异不该算作"没引原文"，
# 否则核验器会频繁误报，反而让使用者不再信任核验条。
_KEEP_RE = re.compile(r"[^\u4e00-\u9fffA-Za-z0-9]+")
QUOTE_WINDOW = 10  # 归一化后连续多少"实字"即认定复述了原文


def _norm(s):
    return _KEEP_RE.sub("", s or "").lower()


def _reproduces(quote_text, reply_norm):
    """quote 的某段连续 QUOTE_WINDOW 个实字是否原样出现在回答里。"""
    body = _norm(quote_text)
    if not body:
        return False
    if len(body) <= QUOTE_WINDOW:
        return body in reply_norm
    for i in range(0, len(body) - QUOTE_WINDOW + 1):
        if body[i:i + QUOTE_WINDOW] in reply_norm:
            return True
    return False


def verify_citations(reply, refs, fulltexts=None):
    """引用核验（两层）：
    1) 编号核验：回答里的「第 N 课」是否真的在本次检索结果里；
    2) 原文核验：被引内容是否真的出现在该课原文中（防止"只写编号、内容自己编"）。

    核验集用的是该课**全部小节原文**（fulltexts），不是只展示给用户的 2 条摘录——
    模型在上下文里能看到整段摘要，引第三段是合法的，不能因此判成编造。
    比对前做标点归一化，避免把换引号这类排版差异误判。
    """
    allowed = [str(r["no"]) for r in refs if r["kind"] == "lesson"]
    cited = []
    for m in CITE_RE.finditer(reply or ""):
        if m.group(1) not in cited:
            cited.append(m.group(1))

    reply_norm = _norm(reply)
    fulltexts = fulltexts or {}
    grounded = []
    for r in refs:
        if r["kind"] != "lesson":
            continue
        no = str(r["no"])
        if no not in cited:
            continue
        # 优先用整课原文；拿不到就退回展示用摘录
        src = fulltexts.get(no)
        candidates = [src] if src else [q.get("text") or "" for q in r.get("quotes", [])]
        if any(_reproduces(c, reply_norm) for c in candidates):
            grounded.append(no)

    return {
        "cited": cited,
        "verified": [n for n in cited if n in allowed],
        "unverified": [n for n in cited if n not in allowed],
        "grounded": grounded,
        "ungrounded": [n for n in cited if n in allowed and n not in grounded],
    }


class ClientGone(Exception):
    """客户端在回答生成过程中断开（关标签页、切网络、进程被杀）。

    这不是服务端错误：SSE 是一次长写，用户随时可能走开。必须静默收尾，
    否则会在日志里留下「写失败 → 想发错误消息 → 又写失败 → 兜底写 JSON → 还是失败」
    的三层嵌套异常，看着像服务崩了，实际只是对面没人接了。
    """


class Handler(SimpleHTTPRequestHandler):
    index: CourseIndex = None
    stats = {"chat": 0, "errors": 0, "crisis": 0}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(BASE_DIR / "web"), **kw)

    # 静音访问日志（只保留 4xx/5xx，便于排错）
    def log_message(self, fmt, *args):
        try:
            if args and str(args[1]).startswith(("4", "5")):
                sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))
        except Exception:
            pass

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
        except (ConnectionError, OSError) as e:  # ConnectionAborted/Reset 都是 OSError 子类
            raise ClientGone(str(e))

    def do_GET(self):
        try:
            return self._do_get()
        except ClientGone:
            pass

    def _do_get(self):
        if self.path.startswith("/api/health"):
            return self._json({
                "ok": True,
                "model": MIMO_MODEL,
                "key_present": bool(MIMO_KEY),
                "lessons": self.index.stats()["lessons"],
                "supplements": self.index.stats()["supplements"],
            })
        if self.path.startswith("/api/stats"):
            return self._json(self.index.stats())
        if self.path.startswith("/api/lesson"):
            m = re.search(r"no=(\d+)", self.path)
            if not m:
                return self._json({"error": "no required"}, 400)
            d = self.index.get(int(m.group(1)))
            if not d:
                return self._json({"error": "not found"}, 404)
            return self._json({
                "no": d["no"], "title": d["title"], "goal": d["goal"],
                "stage": STAGE_CN.get(d["stage"], ""), "dim": DIM_CN.get(d["dim"], ""),
                "layer": LAYER_CN.get(d["layer"], ""), "file": d["file"],
                "body": d.get("body", ""),
            })
        return super().do_GET()

    def _prepare(self, body):
        """解析请求 → 安全判定 + 检索 + 组装 messages。两种接口共用。"""
        messages = body.get("messages") or []
        if not messages:
            raise ValueError("messages required")
        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user = m.get("content") or ""
                break
        if not last_user.strip():
            raise ValueError("empty message")

        crisis = any(k in last_user for k in SAFETY_TERMS)
        hits = self.index.search(last_user, k=4)
        quotes_map = {(d["kind"], str(d["no"])): self.index.quotes(d, last_user) for _, d in hits}
        sys_msgs = [{"role": "system", "content": SYSTEM_PROMPT + "\n\n" + build_context(hits, quotes_map)}]
        if crisis:
            sys_msgs.append({"role": "system", "content": (
                "本条用户消息触发安全筛查。第一段必须先给现实安全建议（求助渠道、离开现场、保留证据），"
                "再做判断。禁止给任何推进、挽回、话术技巧；禁止把危险解释成爱的表现。")})
        history = [m for m in messages[-8:] if m.get("role") in ("user", "assistant")]
        refs = [{
            "no": d["no"] if d["kind"] == "lesson" else str(d["no"]),
            "title": d["title"],
            "stage": STAGE_CN.get(d["stage"], ""),
            "dim": DIM_CN.get(d["dim"], ""),
            "layer": LAYER_CN.get(d["layer"], ""),
            "kind": d["kind"],
            "file": d["file"],
            "score": round(score, 2),
            "quotes": quotes_map.get((d["kind"], str(d["no"])), []),
        } for score, d in hits]
        # 核验集：每课全部小节原文（不发给前端，只在服务端用于判定 grounded）
        fulltexts = {}
        for _, d in hits:
            if d["kind"] != "lesson":
                continue
            secs = d.get("sections") or []
            fulltexts[str(d["no"])] = " ".join((s.get("t") or "") for s in secs)
        return crisis, sys_msgs + history, refs, fulltexts

    # ---- SSE ----
    def _sse_open(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
        except (ConnectionError, OSError) as e:
            raise ClientGone(str(e))

    def _sse_send(self, obj):
        try:
            self.wfile.write(("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8"))
            self.wfile.flush()
        except (ConnectionError, OSError) as e:
            raise ClientGone(str(e))

    def _stream(self, crisis, msgs, refs, fulltexts=None):
        t0 = time.time()
        self._sse_open()
        text = []
        try:
            if crisis:
                self._sse_send({"type": "delta", "text": SAFETY_BLOCK})
                text.append(SAFETY_BLOCK)
            resp = call_mimo_stream(msgs)
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    j = json.loads(data)
                    delta = j["choices"][0].get("delta", {}) or {}
                except Exception:
                    continue
                piece = delta.get("content")
                if piece:
                    text.append(piece)
                    self._sse_send({"type": "delta", "text": piece})
            full = "".join(text)
            self._sse_send({
                "type": "done",
                "refs": refs,
                "crisis": crisis,
                "decision": detect_decision(full, crisis),
                "citations": verify_citations(full, refs, fulltexts),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })
            self.stats["chat"] += 1
            self.stats["crisis"] += 1 if crisis else 0
        except ClientGone:
            # 用户中途走了：保留已生成的部分，不记为错误
            self.stats["errors"] += 0
            sys.stderr.write("[client gone] 客户端在生成中断开，已静默收尾\n")
        except urllib.error.HTTPError as e:
            self.stats["errors"] += 1
            try:
                self._sse_send({"type": "error", "error": f"模型接口返回 {e.code}"})
            except ClientGone:
                pass
        except Exception as e:  # noqa: BLE001
            self.stats["errors"] += 1
            try:
                self._sse_send({"type": "error", "error": f"{type(e).__name__}: {str(e)[:160]}"})
            except ClientGone:
                pass

    def do_POST(self):
        if not self.path.startswith("/api/chat"):
            return self._json({"error": "not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            crisis, msgs, refs, fulltexts = self._prepare(body)

            if self.path.startswith("/api/chat/stream"):
                return self._stream(crisis, msgs, refs, fulltexts)

            try:
                reply, elapsed, usage = call_mimo(msgs)
            except urllib.error.HTTPError as e:
                self.stats["errors"] += 1
                detail = e.read().decode("utf-8", "replace")[:300]
                return self._json({"error": f"模型接口返回 {e.code}", "detail": detail}, 502)
            except Exception as e:  # noqa: BLE001
                self.stats["errors"] += 1
                return self._json({"error": f"模型调用失败：{type(e).__name__}", "detail": str(e)[:300]}, 502)

            if crisis and reply and not reply.startswith("**先处理安全"):
                reply = SAFETY_BLOCK + reply

            self.stats["chat"] += 1
            self.stats["crisis"] += 1 if crisis else 0
            return self._json({
                "reply": reply,
                "refs": refs,
                "crisis": crisis,
                "decision": detect_decision(reply or "", crisis),
                "citations": verify_citations(reply, refs, fulltexts),
                "elapsed_ms": int(elapsed * 1000),
                "usage": usage,
            })
        except ClientGone:
            sys.stderr.write("[client gone] 客户端已断开，跳过响应\n")
        except ValueError as e:
            try:
                return self._json({"error": str(e)}, 400)
            except ClientGone:
                pass
        except Exception as e:  # noqa: BLE001
            self.stats["errors"] += 1
            traceback.print_exc()
            try:
                return self._json({"error": str(e)}, 500)
            except ClientGone:
                pass


def check_model():
    """启动自检：模型名是否仍在上游可用列表里。

    上游会下架模型（mimo-v2.5 就已被移除，报 400 Unsupported model）。
    不自检的话，服务能正常启动、直到用户提问才炸，问题会被误判成"平台坏了"。
    连不上不影响启动，只警告。
    """
    try:
        req = urllib.request.Request(
            f"{MIMO_BASE}/models", headers={"Authorization": f"Bearer {MIMO_KEY}"}
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            ids = [m.get("id") for m in (json.loads(r.read().decode("utf-8")).get("data") or [])]
    except Exception as e:  # noqa: BLE001
        print(f"[自检] 无法获取模型列表（{type(e).__name__}），跳过检查", file=sys.stderr)
        return
    if MIMO_MODEL in ids:
        print(f"[自检] 模型 {MIMO_MODEL} 可用", flush=True)
        return
    print(
        f"[自检] 模型 {MIMO_MODEL} 不在可用列表中，请求会返回 400。\n"
        f"        当前可用：{', '.join(x for x in ids if x) or '（空）'}\n"
        f"        用 MIMO_MODEL=xxx 启动可切换。",
        file=sys.stderr,
    )


def main():
    if not MIMO_KEY:
        print("缺少 MIMO_API_KEY，无法启动。", file=sys.stderr)
        sys.exit(1)
    t0 = time.time()
    Handler.index = CourseIndex()
    st = Handler.index.stats()
    print(f"[索引] {st['lessons']} 课 + {st['supplements']} 补丁课，用时 {time.time()-t0:.1f}s", flush=True)
    print(f"[服务] http://127.0.0.1:{PORT}  模型={MIMO_MODEL}", flush=True)
    check_model()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
