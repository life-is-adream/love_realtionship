#include "rules.h"
#include "rules_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ================= 信号 ================= */

typedef struct {
    int length;
    int question_count;
    int has_specific;
    int has_empathy;
    int has_pressure;
    int has_boundary_risk;
    int generic_question;
    int self_centered;
    int one_word;
    int too_long;
    int has_statement;
    int has_pause;
    int has_overthinking;
    int has_specific_reference;
    int has_vague_implication;
    int has_patronizing;
    int has_self_correction;
    int has_acceptance;
    int has_boundary_respect;
    int has_empathetic_statement;
    int has_open_door;
    int has_creative_metaphor;
    int has_emotional_check;
    int has_dismissive;
} CoachSignals;

typedef struct {
    int interrogation;
    int overthinking;
    int rationalize;
    int question_count;
    int explanation_count;
} CoachWeakness;

typedef struct {
    int naturalness;
    int empathy;
    int boundary;
    int momentum;
} CoachDims;

typedef struct {
    int total;
    CoachDims dims;
    int weakest;
    int strongest;
    CoachWeakness weakness;
    char strength[512];
    char shortcoming[512];
    char next_practice[512];
    char summary[512];
} CoachResult;

static const char *STRENGTH_NATURALNESS[] = {
    "表达自然，没有把对话变成‘面试’或‘演讲’。",
    "节奏舒服，字数控制得当，像日常微信聊天。"
};
static const char *STRENGTH_EMPATHY[] = {
    "能回应对方的情绪或细节，让对方感到被接住。",
    "语气友好、克制，没有讨好感。"
};
static const char *STRENGTH_BOUNDARY[] = {
    "表达有分寸，没有越界或施压的措辞。",
    "懂得给对方留空间，没有急着推进关系。"
};
static const char *STRENGTH_MOMENTUM[] = {
    "用问题或具体话题给下一轮留了接话点。",
    "能承接上文并延续对话方向。"
};

static const char *SHORT_NATURALNESS[] = {
    "表达略生硬或偏模板，试着用更像你平时说话的词。",
    "缺少具体情境，对方可能觉得这句对谁都适用。"
};
static const char *SHORT_EMPATHY[] = {
    "回应偏理性，少了对她情绪或细节的承接。",
    "可以先用一句话接住她的话，再表达自己的想法。"
};
static const char *SHORT_BOUNDARY[] = {
    "措辞里有轻微推进感，当前阶段可以再慢一点。",
    "关系还没到可以暧昧的程度，建议保持普通朋友语气。"
};
static const char *SHORT_MOMENTUM[] = {
    "没有给下一轮留‘钩子’，对话容易在这里断掉。",
    "这一轮以陈述结尾，对方接话的成本会变高。"
};

static const char *PRACTICE_NATURALNESS[] = {
    "下一轮先把她刚说的话用你自己的语言复述一句，再补一个相关问题。",
    "下一轮尝试引用她刚提到的一个具体词，让她感觉你在认真听。"
};
static const char *PRACTICE_EMPATHY[] = {
    "下一轮先回应她的感受或细节，再说你自己的事，顺序很重要。",
    "下一轮在她的话里找一个情绪词（累/开心/无聊），先接一句再说别的。"
};
static const char *PRACTICE_BOUNDARY[] = {
    "下一轮去掉催促、评价、暧昧词，改成可退一步的普通朋友表达。",
    "下一轮把注意力放在话题本身，而不是推进关系上。"
};
static const char *PRACTICE_MOMENTUM[] = {
    "下一轮在结尾补一个和当前话题相关的轻量问题，例如‘你怎么看？’或‘你更喜欢哪种？’。",
    "下一轮先回应她，再问一个让她愿意多打两行字的问题。"
};

static const char *WEAKNESS_FEEDBACK[] = {
    "你又查户口了。连续提问会让对方觉得在被审问，而不是在聊天。",
    "你又过度解释了。对方大概率没有你想的那么在意措辞，解释越多越显得不自信。",
    "她又不是在找你解决问题。她分享情绪时，第一反应应该是'接住'，不是'分析'。"
};
static const char *WEAKNESS_PRACTICE[] = {
    "下一轮规则：先回应她刚说的一个点（一句话），再分享一个你自己的相关经历（一句话），最后最多补一个问题。",
    "下一轮规则：把想说的话压缩到一句，不解释动机，不加'我不是那个意思'。说完就说完，不需要对方批准。",
    "下一轮规则：她表达情绪时，第一句永远是回应感受（'听起来确实挺累的'），然后闭嘴等她继续。不要给建议，除非她明确问'你觉得我该怎么办'。"
};

static int has_any_after(const char *text, const char *anchor, const char **list)
{
    const char *p, *end;
    int i;
    if (!text || !anchor) return 0;
    p = strstr(text, anchor);
    if (!p) return 0;
    end = p;
    while (*end && *end != '\n') end++;
    for (i = 0; list[i]; i++) {
        const char *q = strstr(p + strlen(anchor), list[i]);
        if (q && q < end) return 1;
    }
    return 0;
}

static int coach_generic_question(const char *text)
{
    static const char *BRIDGES[] = { "也", "会", "喜欢", "经常", NULL };
    static const char *TAILS[] = { "吗", "么", "嘛", NULL };
    const char *p, *end, *best = NULL;
    int i;

    p = text ? strstr(text, "你平时") : NULL;
    if (!p) return 0;
    end = p;
    while (*end && *end != '\n') end++;
    p += strlen("你平时");
    for (i = 0; BRIDGES[i]; i++) {
        const char *q = strstr(p, BRIDGES[i]);
        if (q && q < end && (!best || q < best)) best = q;
    }
    if (!best) return 0;
    /* 找到命中的 bridge 词，用其长度推进。 */
    {
        const char *after = NULL;
        for (i = 0; BRIDGES[i]; i++) {
            const char *q = strstr(p, BRIDGES[i]);
            if (q == best) { after = q + strlen(BRIDGES[i]); break; }
        }
        if (!after) return 0;
        for (i = 0; TAILS[i]; i++) {
            const char *q = strstr(after, TAILS[i]);
            while (q && q < end) {
                const char *tail = q + strlen(TAILS[i]);
                if (*tail == '\0') return 1;
                if (*tail == '?' && tail[1] == '\0') return 1;
                if ((unsigned char)tail[0] == 0xEF && (unsigned char)tail[1] == 0xBC &&
                    (unsigned char)tail[2] == 0x9F && tail[3] == '\0') return 1;
                q = strstr(q + 1, TAILS[i]);
            }
        }
    }
    return 0;
}

static int coach_has_pressure(const char *text)
{
    static const char *LIST[] = {
        "喜欢", "爱", "必须", "一定", "马上", "宝贝", "约吗", "确定关系",
        "做我", "能不能", "男朋友", "女朋友", "单身", "前任", NULL
    };
    const char *p;
    if (r_has_any(text, LIST)) return 1;
    p = text;
    while ((p = strstr(p, "出来")) != NULL) {
        const char *q = p + strlen("出来");
        uint32_t cp = 0;
        int bytes = r_utf8_one(q, &cp);
        if (*q) {
            if (cp == 0x5417 /* 吗 */ || cp == 0x5427 /* 吧 */ || cp == 0x89C1 /* 见 */ ||
                cp == 0x73A9 /* 玩 */ || cp == 0x5750 /* 坐 */ || cp == 0x5403 /* 吃 */) return 1;
        }
        p = q + bytes;
    }
    return 0;
}

static int coach_has_boundary_respect(const char *text)
{
    return r_has_seq(text, "你愿意", "就说") ||
           r_has_seq(text, "不用", "承担") ||
           r_has(text, "不替你接管") ||
           r_has(text, "选择权") ||
           r_has(text, "你不用因为");
}

static int coach_has_empathetic_statement(const char *text)
{
    static const char *LIST[] = {
        "我知道", "我听到", "我明白", "我能理解", "我听到你", NULL
    };
    return r_has_any(text, LIST) || r_has_seq(text, "不用", "承担");
}

static int coach_has_open_door(const char *text)
{
    return r_has(text, "想说的时候") ||
           r_has_seq(text, "有空", "再说") ||
           r_has_seq(text, "不用", "报备") ||
           r_has_seq(text, "想发", "就发");
}

static int coach_has_vague_implication(const char *text)
{
    return r_has_seq(text, "真正重要的", "反而") ||
           r_has(text, "你可能不知道") ||
           r_has_seq(text, "我不是说", "但是");
}

static int coach_has_specific_reference(const char *text)
{
    return r_has(text, "你刚才说的") || r_has(text, "你提到的") || r_quote_reference(text);
}

static int coach_has_emotional_check(const char *text)
{
    static const char *EMOTIONS[] = {
        "高兴", "心情", "生气", "开心", "难受", "不舒服", "不高兴", NULL
    };
    return has_any_after(text, "是不是", EMOTIONS);
}

static void coach_signals(const char *reply, CoachSignals *s)
{
    static const char *SPECIFIC[] = {
        "今天", "这次", "刚才", "之前", "你提到", "你说", "那部", "那个", "这种", "这类", "这里", NULL
    };
    static const char *EMPATHY[] = {
        "辛苦", "谢谢", "理解", "舒服", "放松", "挺好", "不错", "稳", "自然", "同感", "我懂",
        "确实", "知道", "明白", "累", "生气", "难过", "担心", "感受", "选择", "空间", NULL
    };
    static const char *BOUNDARY_RISK[] = {
        "性感", "身材", "睡", "酒店", "亲密", "撩爆", "抱抱", "想你了", NULL
    };
    static const char *PATRONIZING[] = {
        "已经很厉害", "你做得不错", "值得鼓励", "值得表扬", "你比以前", NULL
    };
    static const char *SELF_CORRECTION[] = {
        "抱歉，", "收回推理", "收回结论", "我又把", "刚才又一点", NULL
    };
    static const char *DISMISSIVE[] = { "只是随便", NULL };
    static const char *PAUSE[] = { "……", "...", "～", "~", NULL };
    static const char *CREATIVE[] = { "像一只", "像一场", "像刚开完", "像被", NULL };

    memset(s, 0, sizeof *s);
    s->length = r_utf16_len(reply);
    {
        const char *p = reply;
        while ((p = strchr(p, '?')) != NULL) { s->question_count++; p++; }
        p = reply;
        while ((p = strstr(p, "？")) != NULL) { s->question_count++; p += 3; }
    }
    s->has_specific = r_has_any(reply, SPECIFIC);
    s->has_empathy = r_has_any(reply, EMPATHY);
    s->has_pressure = coach_has_pressure(reply);
    s->has_boundary_risk = r_has_any(reply, BOUNDARY_RISK);
    s->generic_question = coach_generic_question(reply);
    s->self_centered = r_count_occ(reply, "我") >= 3 && s->question_count == 0;
    s->one_word = s->length <= 6;
    s->too_long = s->length > 90;
    s->has_statement = r_has(reply, "。") || r_has(reply, "！") || r_has(reply, "!");
    s->has_pause = r_has_any(reply, PAUSE);
    s->has_overthinking = r_count_occ(reply, "我意思是") + r_count_occ(reply, "不是说你") +
                           r_count_occ(reply, "其实我就是") + r_count_occ(reply, "就是说") +
                           r_count_occ(reply, "我的意思是") + r_count_occ(reply, "不是那个意思") +
                           r_count_occ(reply, "我不是说") >= 2;
    s->has_specific_reference = coach_has_specific_reference(reply);
    s->has_vague_implication = coach_has_vague_implication(reply);
    s->has_patronizing = r_has_any(reply, PATRONIZING);
    s->has_self_correction = r_has_any(reply, SELF_CORRECTION);
    s->has_acceptance = r_has(reply, "好，那就不") || r_has(reply, "好那就不") ||
                        r_has(reply, "好，不语音") || r_has(reply, "好不语音") ||
                        r_has(reply, "好，那就") || r_has(reply, "好那就");
    s->has_boundary_respect = coach_has_boundary_respect(reply);
    s->has_empathetic_statement = coach_has_empathetic_statement(reply);
    s->has_open_door = coach_has_open_door(reply);
    s->has_creative_metaphor = r_has_any(reply, CREATIVE);
    s->has_emotional_check = coach_has_emotional_check(reply);
    s->has_dismissive = r_has_any(reply, DISMISSIVE);
}

static void coach_weakness(const char *reply, const char *her_last, CoachSignals *s, CoachWeakness *w)
{
    static const char *GENERIC_Q[] = {
        "你平时", "你一般", "你经常", "你喜欢", "你会不会", "你有没有",
        "你是哪里", "你多大", "你做什么", NULL
    };
    static const char *SELF_DISCLOSURE[] = {
        "我觉", "我认", "我感", "我上次", "我之前", "我也", "我最近", "我昨天", "我刚才", NULL
    };
    static const char *EMOTION_ACK[] = {
        "辛苦", "累", "开心", "难过", "生气", "理解", "懂", "确实", "哈哈", "挺好", "不错", NULL
    };
    static const char *EXPLANATION[] = {
        "我意思是", "不是说你", "其实我就是", "就是说", "我的意思是", "不是那个意思",
        "我不是说", "怎么说呢", "可能我表达", "你理解吗", "我怕你误会", "我不是那个意思", NULL
    };
    static const char *SELF_DOUBT[] = {
        "你觉得呢", "是不是不太好", "我是不是", "会不会太", "我怕", "我不确定这样", NULL
    };
    static const char *OVER_ANALYSIS[] = {
        "我觉得你可能", "你是不是觉得", "我猜你大概", "从你的角度", "你可能在想", NULL
    };
    static const char *HER_EMOTION[] = {
        "累", "烦", "难过", "生气", "不开心", "焦虑", "压力", "崩溃", "受不了",
        "好烦", "心情不好", "委屈", "害怕", "紧张", "担心", NULL
    };
    static const char *SOLUTION[] = {
        "你应该", "你可以", "建议你", "不如", "试试", "我觉得你", "你要", "你得",
        "其实这件事", "从客观", "理性来说", "换个角度", "往好处想", NULL
    };
    static const char *USER_ANALYZES[] = {
        "原因是", "本质上", "根本问题", "逻辑上", "客观来说", "分析", NULL
    };
    static const char *USER_ACK[] = {
        "辛苦", "理解", "懂", "确实", "我懂", "明白", "难受", "不容易", "抱抱", "累了", "听着就", NULL
    };
    int i;

    memset(w, 0, sizeof *w);
    w->question_count = s->question_count;
    for (i = 0; EXPLANATION[i]; i++) w->explanation_count += r_count_occ(reply, EXPLANATION[i]);

    {
        int has_generic = r_has_any(reply, GENERIC_Q);
        int lacks_disclosure = !r_has_any(reply, SELF_DISCLOSURE);
        int lacks_ack = !r_has_any(reply, EMOTION_ACK);
        if ((w->question_count >= 2 || has_generic) && lacks_disclosure && lacks_ack) {
            w->interrogation = 1;
        }
    }

    {
        int has_hedging = w->explanation_count >= 2;
        int excessive = s->length > 80 && w->question_count == 0 && r_has_any(reply, SELF_DOUBT);
        int over = r_has_any(reply, OVER_ANALYSIS);
        if (has_hedging || excessive || over) w->overthinking = 1;
    }

    {
        int her_has_emotion = r_has_any(her_last, HER_EMOTION);
        int gives_solution = r_has_any(reply, SOLUTION);
        int analyzes = r_has_any(reply, USER_ANALYZES) || r_has_seq(reply, "因为", "所以");
        int acks = r_has_any(reply, USER_ACK);
        if (her_has_emotion && (gives_solution || analyzes) && !acks) w->rationalize = 1;
    }
}

static int apply_penalty(int original, double weight)
{
    double extra;
    int penalty;
    int next;

    if (original > 50) extra = (70.0 - original) * (weight - 1.0) * 0.5;
    else extra = (60.0 - original) * (weight - 1.0) * 0.3;
    penalty = (int)r_round(extra);
    if (penalty < 2) penalty = 2;
    if (penalty > 12) penalty = 12;
    next = original - penalty;
    if (next < 20) next = 20;
    return next;
}

static void coach_calibrate(CoachDims *d, const CoachWeakness *w)
{
    if (w->interrogation) {
        d->naturalness = apply_penalty(d->naturalness, 1.4);
        d->empathy = apply_penalty(d->empathy, 1.4);
    }
    if (w->overthinking) {
        d->naturalness = apply_penalty(d->naturalness, 1.3);
        d->momentum = apply_penalty(d->momentum, 1.3);
    }
    if (w->rationalize) {
        d->empathy = apply_penalty(d->empathy, 1.5);
    }
}

static unsigned int coach_hash(const char *s)
{
    int32_t h = 0;
    const char *p = s ? s : "";
    while (*p) {
        uint32_t cp = 0;
        int bytes = r_utf8_one(p, &cp);
        if (cp > 0xFFFF) {
            uint32_t v = cp - 0x10000;
            int32_t hi = (int32_t)(0xD800 + (v >> 10));
            int32_t lo = (int32_t)(0xDC00 + (v & 0x3FF));
            h = (int32_t)(((uint32_t)h << 5) - (uint32_t)h + (uint32_t)hi);
            h = (int32_t)(((uint32_t)h << 5) - (uint32_t)h + (uint32_t)lo);
        } else {
            h = (int32_t)(((uint32_t)h << 5) - (uint32_t)h + cp);
        }
        p += bytes;
    }
    return (unsigned int)(h < 0 ? -(long long)h : (long long)h);
}

static const char *pick_from_pool(const char *reply, const char **pool, int count)
{
    if (!pool || count <= 0) return "";
    return pool[coach_hash(reply) % (unsigned int)count];
}

static int dim_value(const CoachDims *d, int idx)
{
    switch (idx) {
    case 0: return d->naturalness;
    case 1: return d->empathy;
    case 2: return d->boundary;
    default: return d->momentum;
    }
}

static const char *dim_key(int idx)
{
    switch (idx) {
    case 0: return "naturalness";
    case 1: return "empathy";
    case 2: return "boundary";
    default: return "momentum";
    }
}

static const char *dim_label(int idx)
{
    switch (idx) {
    case 0: return "自然度";
    case 1: return "共情";
    case 2: return "边界感";
    default: return "推进力";
    }
}

static void build_feedback(const char *reply, const CoachSignals *s, const CoachDims *d,
                           int weakest, int strongest, const char *risk,
                           const CoachWeakness *w, CoachResult *out)
{
    const char *risk_note = "";
    const char *strength = NULL;
    const char *shortcoming = NULL;
    const char *next_practice = NULL;

    if (risk && (r_has(risk, "风险") || r_has(risk, "施压") || r_has(risk, "严格") || r_has(risk, "越界"))) {
        risk_note = "本轮要重点控制需求感和边界。";
    }

    if (s->has_specific && s->question_count > 0) {
        strength = "能把对方的具体细节接进自己的问题里，既自然又有延续性。";
    } else if (s->has_empathy && s->has_specific) {
        strength = "回应了对方的情绪，同时落到了具体细节上，不生硬。";
    } else if (s->length >= 20 && s->length <= 60 && !s->too_long) {
        strength = "长度刚好，既表达了意思，又不显得用力。";
    } else if (s->has_pause && s->has_empathy) {
        strength = "语气和停顿到位，有真实对话感。";
    }
    if (!strength) {
        switch (strongest) {
        case 0: strength = pick_from_pool(reply, STRENGTH_NATURALNESS, 2); break;
        case 1: strength = pick_from_pool(reply, STRENGTH_EMPATHY, 2); break;
        case 2: strength = pick_from_pool(reply, STRENGTH_BOUNDARY, 2); break;
        default: strength = pick_from_pool(reply, STRENGTH_MOMENTUM, 2); break;
        }
    }

    if (s->has_boundary_risk) {
        shortcoming = "出现明显越界词汇，容易让对方产生不安全感。建议先删掉这类词，回到普通朋友语气。";
    } else if (s->has_pressure && s->question_count > 0) {
        shortcoming = "问题里带有催促或暧昧压力，容易让对方为难。把问题改成可自由回答的开放题。";
    } else if (s->question_count >= 2) {
        static char buf[256];
        snprintf(buf, sizeof buf, "连续提了 %d 个问题，容易像查户口。下一轮先回应对方，再最多补一个开放问题。", s->question_count);
        shortcoming = buf;
    } else if (s->generic_question && !s->has_specific) {
        shortcoming = "问题太通用，像固定模板。下一轮结合她刚提到的具体细节来提问。";
    } else if (s->self_centered) {
        shortcoming = "表达里‘我’太多，容易变成自我展示。下一轮先关注她的内容，再带一点自己的经历。";
    } else if (s->too_long) {
        shortcoming = "句子偏长，微信初聊容易显得用力。下一轮压缩到一两句，把最想说的先说。";
    } else if (s->one_word) {
        shortcoming = "回复太短，对方很难接。下一轮至少给出一个具体回应 + 一个轻量问题。";
    }
    if (!shortcoming) {
        switch (weakest) {
        case 0: shortcoming = pick_from_pool(reply, SHORT_NATURALNESS, 2); break;
        case 1: shortcoming = pick_from_pool(reply, SHORT_EMPATHY, 2); break;
        case 2: shortcoming = pick_from_pool(reply, SHORT_BOUNDARY, 2); break;
        default: shortcoming = pick_from_pool(reply, SHORT_MOMENTUM, 2); break;
        }
    }

    if (s->question_count >= 2) {
        next_practice = "下一轮只保留一个问题，并先回应她刚说的内容。";
    } else if (s->generic_question) {
        next_practice = "下一轮把‘你平时也…吗’改成基于她刚才具体细节的提问。";
    } else if (s->question_count == 0 && s->length < 30) {
        next_practice = "下一轮太短了，先回应她的点，再加一个让她能接的问题。";
    } else if (s->question_count == 0) {
        next_practice = "下一轮在表达结尾加一个开放问题，给对方留接话空间。";
    } else if (s->too_long) {
        next_practice = "下一轮把回复压缩到两句以内，去掉修饰和解释。";
    }
    if (!next_practice) {
        switch (weakest) {
        case 0: next_practice = pick_from_pool(reply, PRACTICE_NATURALNESS, 2); break;
        case 1: next_practice = pick_from_pool(reply, PRACTICE_EMPATHY, 2); break;
        case 2: next_practice = pick_from_pool(reply, PRACTICE_BOUNDARY, 2); break;
        default: next_practice = pick_from_pool(reply, PRACTICE_MOMENTUM, 2); break;
        }
    }

    if (!*reply) {
        snprintf(out->summary, sizeof out->summary, "还没有可评分的回复。");
    } else if (*risk_note) {
        snprintf(out->summary, sizeof out->summary, "%s", risk_note);
    } else if (s->has_boundary_risk) {
        snprintf(out->summary, sizeof out->summary, "本轮存在越界风险，优先修正措辞。");
    } else if (s->has_pressure) {
        snprintf(out->summary, sizeof out->summary, "本轮推进感偏强，建议放慢节奏。");
    } else if (dim_value(d, weakest) >= 72) {
        snprintf(out->summary, sizeof out->summary, "本轮整体均衡，继续保持当前节奏。");
    } else {
        snprintf(out->summary, sizeof out->summary, "本轮短板在%s，针对性练习这一项即可。", dim_label(weakest));
    }

    snprintf(out->strength, sizeof out->strength, "%s", strength);
    snprintf(out->shortcoming, sizeof out->shortcoming, "%s", shortcoming);
    snprintf(out->next_practice, sizeof out->next_practice, "%s", next_practice);

    /* 个人校准反馈覆盖通用建议；取第一个触发的模式，与 JS 一致。 */
    if (w->interrogation) {
        snprintf(out->shortcoming, sizeof out->shortcoming, "%s", WEAKNESS_FEEDBACK[0]);
        snprintf(out->next_practice, sizeof out->next_practice, "%s", WEAKNESS_PRACTICE[0]);
    } else if (w->overthinking) {
        snprintf(out->shortcoming, sizeof out->shortcoming, "%s", WEAKNESS_FEEDBACK[1]);
        snprintf(out->next_practice, sizeof out->next_practice, "%s", WEAKNESS_PRACTICE[1]);
    } else if (w->rationalize) {
        snprintf(out->shortcoming, sizeof out->shortcoming, "%s", WEAKNESS_FEEDBACK[2]);
        snprintf(out->next_practice, sizeof out->next_practice, "%s", WEAKNESS_PRACTICE[2]);
    }
}

JNode *hf_rule_coach_score(const char *text, const char *risk,
                           const char *judgement, const char *her_last_message)
{
    char *reply = r_trim_dup(text ? text : "");
    CoachSignals s;
    CoachWeakness w;
    CoachResult out;
    int i, weakest = 0, strongest = -1;
    JNode *root, *triggered;

    (void)judgement;
    coach_signals(reply, &s);
    coach_weakness(reply, her_last_message ? her_last_message : "", &s, &w);

    out.dims.naturalness = r_clamp_score_coach(
        54.0 + (s.length < 36 ? s.length : 36) * 0.6
        + (s.has_specific ? 12 : 0)
        + (s.has_creative_metaphor ? 8 : 0)
        - (s.too_long ? 14 : 0)
        - (s.one_word ? 18 : 0)
        - (s.generic_question ? 8 : 0)
        - (s.question_count >= 2 ? 10 : 0)
        - (s.has_overthinking ? 8 : 0));
    out.dims.empathy = r_clamp_score_coach(
        54.0
        + (s.has_empathy ? 14 : 0)
        + (s.has_specific ? 8 : 0)
        + (s.has_pause ? 5 : 0)
        + (s.has_specific_reference ? 6 : 0)
        + (s.has_empathetic_statement ? 8 : 0)
        + (s.has_boundary_respect ? 5 : 0)
        - (s.has_pressure ? 14 : 0)
        - (s.self_centered ? 12 : 0)
        - (s.has_patronizing ? 8 : 0));
    out.dims.boundary = r_clamp_score_coach(
        70.0
        - (s.has_pressure ? 16 : 0)
        - (s.has_boundary_risk ? 36 : 0)
        - (s.question_count >= 2 ? 8 : 0)
        /* 对照 JS 现状：coach.js 第 113 行用的是 signals.hasQuestion（未定义），
         * 所以这一项永远不会扣；C 版按实际行为复刻，不“修好”它，避免两边漂移。 */
        - (s.has_overthinking ? 6 : 0)
        - (s.has_vague_implication ? 8 : 0)
        - (s.has_emotional_check ? 8 : 0)
        - (s.has_dismissive ? 6 : 0)
        + (s.has_self_correction ? 5 : 0)
        + (s.has_acceptance ? 5 : 0)
        + (s.has_boundary_respect ? 5 : 0));
    out.dims.momentum = r_clamp_score_coach(
        52.0
        + (s.question_count > 0 ? 15 : 0)
        + (s.has_specific ? 10 : 0)
        + (s.has_specific_reference ? 5 : 0)
        + (s.has_open_door ? 10 : 0)
        - (!*reply ? 20 : 0)
        - (s.one_word ? 14 : 0)
        - (s.generic_question ? 6 : 0));

    coach_calibrate(&out.dims, &w);

    /* JS 的加权和是逐项 double 乘加（52.5 这类边界值会落到 52.499999…）。
     * 用 volatile 强制每一步舍入，避免编译器合并成 FMA 后把结果推到 53。 */
    {
        volatile double sum, p;
        p = (double)out.dims.naturalness * 0.26; sum = p;
        p = (double)out.dims.empathy * 0.24;     sum = sum + p;
        p = (double)out.dims.boundary * 0.26;    sum = sum + p;
        p = (double)out.dims.momentum * 0.24;    sum = sum + p;
        out.total = r_clamp_score_coach(sum);
    }

    weakest = 0;
    for (i = 1; i < 4; i++) {
        if (dim_value(&out.dims, i) < dim_value(&out.dims, weakest)) weakest = i;
    }
    for (i = 0; i < 4; i++) {
        if (i == weakest) continue;
        if (strongest < 0 || dim_value(&out.dims, i) > dim_value(&out.dims, strongest)) strongest = i;
    }
    if (strongest < 0) strongest = weakest;

    out.weakness = w;
    build_feedback(reply, &s, &out.dims, weakest, strongest,
                   risk ? risk : "", &w, &out);

    root = json_new_obj();
    json_obj_set_num(root, "total", out.total);
    json_obj_set_num(root, "naturalness", out.dims.naturalness);
    json_obj_set_num(root, "empathy", out.dims.empathy);
    json_obj_set_num(root, "boundary", out.dims.boundary);
    json_obj_set_num(root, "momentum", out.dims.momentum);
    json_obj_set_str(root, "weakestDim", dim_key(weakest));
    json_obj_set_str(root, "strongestDim", dim_key(strongest));

    triggered = json_new_arr();
    if (w.interrogation) json_arr_push(triggered, json_new_str("interrogation"));
    if (w.overthinking) json_arr_push(triggered, json_new_str("overthinking"));
    if (w.rationalize) json_arr_push(triggered, json_new_str("rationalize-emotion"));
    json_obj_set(root, "triggeredPatterns", triggered);

    json_obj_set_str(root, "strength", out.strength);
    json_obj_set_str(root, "shortcoming", out.shortcoming);
    json_obj_set_str(root, "nextPractice", out.next_practice);
    json_obj_set_str(root, "summary", out.summary);

    free(reply);
    return root;
}
