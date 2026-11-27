/* neutral.c — 需求 2：一个不站队的第三方
 *
 * 程序在这里刻意不做判断。它只做两件事：
 *   1. 把用户叙述里的「语言习惯」标出来（绝对化、读心、单边归因）
 *   2. 给出 2-3 个可以自问的问题
 *
 * 为什么不给结论：因为任何一个立场都会让用户关闭思考。
 * 站他这边，他得到情绪确认但学不到东西；站对方那边，他立刻离开。
 * 唯一能同时成立的姿态是——把结构指出来，让他自己走。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <string.h>

static const char *ABS[] = {
    "总是", "从来", "每次", "永远", "一直", "全都", "根本",
    "一次都", "老是", NULL
};
static const char *MIND[] = {
    "他就是想", "她就是不想", "肯定是", "摆明了", "故意", "存心",
    "就是不想", "心里根本", "无非是", "说白了就是", NULL
};
static const char *BLAME_O[] = {
    "都怪", "全是因为", "要不是", "就是因为他", "就是因为她",
    "全是他的错", "全是她的错", "他害", "她害", NULL
};
static const char *BLAME_S[] = {
    "全是我的错", "都怪我", "我太差", "我不配", "我就是不行", "我活该", "我是不是太", NULL
};

static int count_occ(const char *text, const char *w)
{
    const char *p = text;
    int n = 0;
    size_t wl = strlen(w);
    while ((p = strstr(p, w)) != NULL) { n++; p += wl; }
    return n;
}

static int scan(const char *text, const char **list, char *hits, size_t hitsz)
{
    int i, total = 0;
    size_t used = 0;
    hits[0] = '\0';
    for (i = 0; list[i]; i++) {
        int c = count_occ(text, list[i]);
        if (c <= 0) continue;
        total += c;
        if (used + strlen(list[i]) + 4 < hitsz) {
            if (used) { hits[used++] = ','; }
            memcpy(hits + used, list[i], strlen(list[i]));
            used += strlen(list[i]);
            hits[used] = '\0';
        }
    }
    return total;
}

void hf_bias(const char *text, HfBias *b)
{
    static char dump[256];
    memset(b, 0, sizeof *b);
    b->absolutism   = scan(text, ABS,     dump, sizeof dump);
    b->mindreading  = scan(text, MIND,    dump, sizeof dump);
    b->blame_other  = scan(text, BLAME_O, dump, sizeof dump);
    b->blame_self   = scan(text, BLAME_S, dump, sizeof dump);
}

void hf_neutral(const char *text, const HfBias *b, FILE *out)
{
    char hits[256];
    int total = b->absolutism + b->mindreading + b->blame_other + b->blame_self;

    fprintf(out, "\n【2 · 另一个视角】\n");

    if (total == 0) {
        fprintf(out, "  这段话里没有出现绝对化的表述，你描述的是具体行为。\n");
        fprintf(out, "  具体，才有得谈——这本身是个不常见的信号。\n");
        return;
    }

    if (b->blame_self > 0) {
        scan(text, BLAME_S, hits, sizeof hits);
        fprintf(out, "  你有 %d 处把责任整个揽到自己身上：%s\n", b->blame_self, hits);
        fprintf(out, "  先停一下。如果是最好的朋友遇到同样的事，\n");
        fprintf(out, "  你会对他说「都是你的错」吗？\n\n");
    }

    if (b->absolutism > 0) {
        scan(text, ABS, hits, sizeof hits);
        fprintf(out, "  %d 处把对方的行为说成了恒定模式：%s\n", b->absolutism, hits);
        fprintf(out, "  人在难受时会用「总是」来压缩时间——真实频率往往没这么高。\n\n");
    }

    if (b->mindreading > 0) {
        scan(text, MIND, hits, sizeof hits);
        fprintf(out, "  %d 处直接给出了对方的动机：%s\n", b->mindreading, hits);
        fprintf(out, "  动机是猜的，行为是看到的。这两样混在一起时，吵架就不会有出口。\n\n");
    }

    if (b->blame_other > 0) {
        scan(text, BLAME_O, hits, sizeof hits);
        fprintf(out, "  %d 处把原因完全归于对方：%s\n", b->blame_other, hits);
        fprintf(out, "  归因越单一，越难找到能改的那一小块。\n\n");
    }

    fprintf(out, "  三个可以自问的问题（不是结论）：\n");
    if (b->absolutism > 0)
        fprintf(out, "      · 如果这一次是例外，它会是什么样子？\n");
    if (b->mindreading > 0)
        fprintf(out, "      · 除了这个解释，还有没有第二种可能是真的？\n");
    if (b->blame_other > 0)
        fprintf(out, "      · 这件事里，有哪一小部分是他可能没意识到的？\n");
    if (b->blame_self > 0)
        fprintf(out, "      · 哪些部分是环境或时机造成的，而不只是你？\n");
    fprintf(out, "      · 你希望他此刻具体做哪一件事？（要具体到能执行）\n");

    fprintf(out, "\n  说明：这里不是在说你错了。站位对理解没有帮助。\n");
}
