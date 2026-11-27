# -*- coding: utf-8 -*-
"""对照 Node 版与 C 版的 JSON 输出差异。

用法：
    python tests/parity.py [C 服务地址] [Node 服务地址]
    也可用环境变量 C_BASE / NODE_BASE 指定。
默认：C 服务在 :3100，Node 服务在 :3200。
"""
import json
import os
import sys
import urllib.request

C_BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("C_BASE", "http://127.0.0.1:3100")
NODE_BASE = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("NODE_BASE", "http://127.0.0.1:3200")


def post(base, path, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        base + path, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def diff(a, b, path="", out=None):
    if out is None:
        out = []
    if type(a) != type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
        out.append("%s: 类型 %s != %s (%r / %r)" % (path, type(a).__name__, type(b).__name__, a, b))
        return out
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append("%s.%s: C 缺失" % (path, k))
            elif k not in b:
                out.append("%s.%s: C 多出" % (path, k))
            else:
                diff(a[k], b[k], "%s.%s" % (path, k), out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append("%s: 长度 %d != %d" % (path, len(a), len(b)))
        for i in range(min(len(a), len(b))):
            diff(a[i], b[i], "%s[%d]" % (path, i), out)
    else:
        if isinstance(a, float) or isinstance(b, float):
            if abs(float(a) - float(b)) > 1e-9:
                out.append("%s: %r != %r" % (path, a, b))
        elif a != b:
            out.append("%s: %r != %r" % (path, a, b))
    return out


CASES = [
    (
        "无记忆 4 条消息",
        {
            "messages": [
                {"speaker": "user", "text": "你今天怎么这么冷淡？"},
                {"speaker": "other", "text": "最近有点忙"},
                {"speaker": "user", "text": "你是不是不想聊了"},
                {"speaker": "other", "text": "没有，就是累"},
            ]
        },
    ),
    (
        "带记忆与目标",
        {
            "consent": True,
            "caseId": "case_abc123",
            "goal": "想练清楚表达",
            "messages": [
                {"speaker": "user", "text": "我有点难过，你昨天没回我"},
                {"speaker": "other", "text": "抱歉，昨天太忙了"},
                {"speaker": "user", "text": "我不是要吵，我是想被记得"},
                {"speaker": "other", "text": "我知道了，下次提前说"},
            ],
            "memory": {
                "currentState": "MUTUAL_FAMILIARITY",
                "observations": [
                    {"id": "obs_001", "kind": "observation", "summary": "对方提到最近工作忙"}
                ],
            },
        },
    ),
    (
        "明确拒绝",
        {
            "messages": [
                {"speaker": "user", "text": "周末一起吃饭吗？"},
                {"speaker": "other", "text": "我不想和你在一起，别再联系我了"},
            ]
        },
    ),
    (
        "安全风险",
        {
            "messages": [
                {"speaker": "user", "text": "你要是再不理我，我就去你公司堵你"},
                {"speaker": "other", "text": "你别这样，我有点害怕"},
            ]
        },
    ),
]


def main():
    failures = 0
    for name, payload in CASES:
        sc, cj = post(C_BASE, "/api/relationship-intelligence", payload)
        sn, nj = post(NODE_BASE, "/api/relationship-intelligence", payload)
        if sc != sn:
            print("FAIL %s: 状态码 %d != %d" % (name, sc, sn))
            failures += 1
            continue
        d = diff(cj, nj)
        if d:
            failures += 1
            print("FAIL %s (%d 处差异)" % (name, len(d)))
            for line in d[:12]:
                print("   ", line)
        else:
            print("PASS %s" % name)

    sc, cj = post(C_BASE, "/api/relationship-intelligence", {"messages": []})
    sn, nj = post(NODE_BASE, "/api/relationship-intelligence", {"messages": []})
    if sc == sn and cj.get("error") == nj.get("error"):
        print("PASS 空消息错误码")
    else:
        failures += 1
        print("FAIL 空消息错误码: %d/%s vs %d/%s" % (sc, cj.get("error"), sn, nj.get("error")))

    print("\n结果：%s" % ("全部一致" if failures == 0 else "%d 项不一致" % failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
