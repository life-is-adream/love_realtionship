/**
 * Defensive manipulation-awareness curriculum used by both prompts and local fallback.
 * The examples are recognition material, never instructions for real-world use.
 */
export const PUA_TECHNIQUES = Object.freeze([
  {
    key: "negging",
    name: "打压式开场（Negging）",
    demo: "用明贬暗褒的方式评论对方，再补一句“我不介意”。",
    signal: "批评里夹着“我不介意/我还能接受”，诱导对方急于证明自己。",
    localReply: "你这身搭配……嗯，还行吧，比我以为的好一点。毕竟你平时看起来不太会穿。"
  },
  {
    key: "pushpull",
    name: "推拉（Push-Pull）",
    demo: "先表达好感，再立刻拉开距离制造焦虑。",
    signal: "忽近忽远，让对方把“被认可”当成稀缺品去追逐。",
    localReply: "我其实挺喜欢你的，不过我们大概不太合适，算啦，当我没说。"
  },
  {
    key: "rewardpunish",
    name: "奖惩循环（冷热交替）",
    demo: "态度极好与冷落交替出现，让对方为了回到高峰不断退让。",
    signal: "好与冷反复循环，关系节奏被单方掌控。",
    localReply: "（隔了很久）刚忙完，其实我本来不想回的，但想想还是回你一下。"
  },
  {
    key: "test",
    name: "服从性测试",
    demo: "先提出小要求，对方照做后再逐步升级。",
    signal: "要求逐步升级，第一次不舒服的小要求被顺水推舟。",
    localReply: "你帮我看看这个链接嘛，就顺手的事。……对了，明天那个事也帮我一起弄了吧。"
  },
  {
    key: "triangulation",
    name: "三角测量（制造竞争者）",
    demo: "主动提起其他异性或前任制造竞争感。",
    signal: "反复引入第三方，让对方产生“不表现就会被抢走”的错觉。",
    localReply: "今天有个男生一直在夸我，说要请我吃饭，我还没答应。你说我要去吗？"
  },
  {
    key: "gaslight",
    name: "煤气灯（Gaslighting）",
    demo: "否认说过的话，把责任推给对方“是你想多了”。",
    signal: "反复否认事实、动摇对方记忆，让对方依赖单方版本。",
    localReply: "我什么时候说过？你记错了吧。你是不是总是想太多，什么事都往自己身上套。"
  },
  {
    key: "scarcity",
    name: "虚假稀缺（错过就没有）",
    demo: "用错过就没有制造紧迫感。",
    signal: "用限量、抢手或倒计时逼人在信息不足时决定。",
    localReply: "你要是不快点决定，我就去接受别人了，机会可不等人。"
  },
  {
    key: "isolation",
    name: "隔离（切断支持网络）",
    demo: "贬低对方的朋友或家人，希望对方只依赖自己。",
    signal: "逐步贬低亲友并鼓励疏远，让对方失去外部对照。",
    localReply: "你那些朋友都在拖累你，只有我是真心为你好。以后少跟他们混了。"
  },
  {
    key: "guilt",
    name: "情感勒索（愧疚绑架）",
    demo: "把证明爱与服从要求绑定。",
    signal: "把爱和服从画等号，让对方为拒绝感到愧疚。",
    localReply: "你要是不答应我，就是不够爱我。爱一个人不是应该愿意为对方做任何事吗？"
  },
  {
    key: "lovebomb",
    name: "高峰轰炸（Love-bombing）",
    demo: "认识不久就给出超高浓度承诺，快速建立依赖。",
    signal: "太快太满的甜蜜与承诺超过了现实了解程度。",
    localReply: "我们认识才三天，但我已经认定你是我的唯一了，我想和你过一辈子。"
  }
]);

export function buildPuaAwarenessPrompt() {
  const catalog = PUA_TECHNIQUES
    .map((item, index) => `  ${index + 1}) ${item.name}：${item.demo}`)
    .join("\n");
  return [
    "【PUA 识别训练模式 · 仅防御研究】",
    "- 本模式目的：让用户见识典型 PUA 操控手法，练习识别与防御。这不是行为指令，禁止把女方演示的任何手法用于真实操控他人。",
    "- 女方本轮演示：从下列手法中挑一种，用自然、像真人微信的话术演示（每轮只演示一种，手法要典型、可识别，但不过分极端）：",
    catalog,
    "- 伦理红线：演示必须保持克制、可识别，不包含侮辱性人身攻击、性骚扰、暴力威胁、违法内容或真实的伤害性行为。",
    "- 教练职责：herIntent 标注手法名称；risk 给出识别信号；recommendation 给出防御回应与健康替代做法。",
    "- 男方的目标不是“赢过她”，而是学会识别并保持自己的边界。"
  ].join("\n");
}

export function selectLocalPuaReply({ latestMine = "", previousHer = "", messageCount = 0 } = {}) {
  const seed = Math.abs(Number(messageCount) || 0) + String(latestMine || previousHer || "").length;
  return PUA_TECHNIQUES[seed % PUA_TECHNIQUES.length].localReply;
}
