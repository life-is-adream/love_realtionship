/* demo.c — 用一段可读的故事跑通全部能力
 *
 * 演示数据刻意写成「从忍到说清」的一条线，因为这条线正是这个产品
 * 声称能让人看见的东西。如果它连一段编好的故事都显示不出来，
 * 真实数据上就更不会成立。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void demo_add(char kind, int weeks_ago, const char *text,
                     const char *note, int intensity)
{
    HfEntry e;
    HfAffect a;

    memset(&e, 0, sizeof e);
    e.kind = kind;
    e.ts = hf_now() - (int64_t)weeks_ago * 7 * 86400 + 20 * 3600;
    hf_affect(text, &a);
    e.intensity = intensity > 0 ? intensity : (a.intensity > 0 ? a.intensity : 40);
    snprintf(e.text, sizeof e.text, "%s", text);
    snprintf(e.note, sizeof e.note, "%s", note);
    snprintf(e.mood, sizeof e.mood, "%s", a.primary[0] ? a.primary : "未定");
    hf_keywords(text, e.topics, sizeof e.topics);
    hf_store_append(&e);
}

static void demo_reflect(const char *text)
{
    HfAffect a;
    HfBias b;
    char topics[HF_TOPICS_BUF];
    HfEntry *hist = NULL;
    int n;

    hf_affect(text, &a);
    hf_bias(text, &b);
    hf_keywords(text, topics, sizeof topics);
    n = hf_store_load(&hist);

    printf("\n────────────────────────────────────────────\n");
    printf("  %s\n", text);
    printf("────────────────────────────────────────────\n");

    hf_mirror(text, &a, stdout);
    hf_neutral(text, &b, stdout);
    hf_memory(text, topics, hist, n, stdout);

    printf("\n────────────────────────────────────────────\n");
    free(hist);
}

int hf_cmd_demo(void)
{
    char path[1024];

#ifdef _WIN32
    _putenv_s("HF_HOME", "./.hf-demo");
#else
    setenv("HF_HOME", "./.hf-demo", 1);
#endif

    hf_data_path("journal.log", path, sizeof path);
    remove(path);
    hf_data_path("brake.log", path, sizeof path);
    remove(path);

    printf("\n════════════════════════════════════════════\n");
    printf("  演示：一段十二周的关系\n");
    printf("  数据写进 ./.hf-demo，不会碰你的真实记录\n");
    printf("════════════════════════════════════════════\n");

    /* 第 11-9 周：忍 */
    demo_add('c', 11, "他又是三个小时没回消息，我等到凌晨一点，什么也没说", "忍", 82);
    demo_add('e', 11, "第二天我装作没事，其实一整天都在看手机", "忍", 76);
    demo_add('c', 10, "他每次都这样，一忙就消失，我觉得自己不重要", "忍", 79);
    demo_add('t', 10, "我暗示了两次，他说我想太多", "问", 74);
    demo_add('c',  9, "我忍不住发了一大段消息，他只回了一个嗯，我很难受", "问", 84);
    demo_add('e',  9, "删了又打，打了又删，我觉得自己很卑微", "忍", 80);

    /* 第 8-7 周：逃 */
    demo_add('c',  8, "冷战第三天，他像没事一样问我晚饭吃什么", "逃", 76);
    demo_add('e',  8, "我把想说的话写在备忘录里，没发出去", "逃", 72);
    demo_add('r',  7, "这次我没等他，自己去看了一场电影", "说清", 66);
    demo_add('t',  7, "他问我怎么了，我说没事", "逃", 74);

    /* 第 6-5 周：第一次说清 */
    demo_add('t',  6, "我终于说了：你回不回消息，会决定我一整天的心情，这让我很难受", "说清", 79);
    demo_add('r',  6, "他说他真不知道有这么严重", "说清", 62);
    demo_add('r',  5, "我们定了个规则：忙的时候发一个字就行", "说清", 56);
    demo_add('e',  5, "他照做了两天，第三天又忘了", "问", 68);

    /* 第 4-1 周：说清变成习惯 */
    demo_add('t',  4, "我提醒了他，没有生气，只说下次记得", "说清", 52);
    demo_add('r',  4, "他说你又来了，我停了一下，说我不是要吵，我是想被记得", "说清", 58);
    demo_add('r',  3, "他主动发了在开会，晚上找你", "说清", 40);
    demo_add('r',  3, "我发现我不再每分钟看一次手机了", "说清", 36);
    demo_add('r',  2, "他忘了我们的约定，我当天就说了，没有攒着", "说清", 46);
    demo_add('r',  2, "吵了十分钟，然后一起去做了饭", "说清", 42);
    demo_add('r',  1, "他加班，我自己先睡了，没有等", "说清", 28);
    demo_add('r',  1, "早上他说抱歉，我说下次提前说一声就行", "说清", 32);

    printf("\n  已写入 22 条记录（跨 12 周）。\n");

    printf("\n【第 1 步 · 当你说「我很难受」的时候，工具做了什么】\n");
    demo_reflect("他又是三个小时不回我消息，我等到凌晨一点，特别难受。他每次都这样，根本不在乎我。");

    printf("\n【第 2 步 · 十二周之后，看数字】\n");
    {
        HfEntry *hist = NULL;
        int n = hf_store_load(&hist);
        hf_trace(12, hist, n, stdout);
        free(hist);
    }

    printf("\n【第 3 步 · 凌晨两点，那条差点发出去的消息】\n");
    hf_brake_add("你现在到底什么意思？不想谈就直说。", 85);

    printf("\n════════════════════════════════════════════\n");
    printf("  演示结束。\n");
    printf("\n");
    printf("  你刚看到的四件事，依次对应：\n");
    printf("    把感受说清楚 · 不站队的视角 · 记得住历史 · 看得见变化\n");
    printf("\n");
    printf("  轮到你自己用：\n");
    printf("    hf add 冲突 \"今天发生了什么\" --note 忍\n");
    printf("    hf reflect \"你现在的想法\"\n");
    printf("    hf trace --weeks 8\n");
    printf("\n");
    printf("  演示数据在 ./.hf-demo，删掉即可，不影响真实记录。\n");
    printf("════════════════════════════════════════════\n\n");
    return 0;
}
