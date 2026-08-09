import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "long-simulation");
const endpoint = "http://localhost:3000/api/chat";
const targetDialogueChars = 12_500;
const maxSegments = 5;

const chapters = [
  {
    file: "05_第3章_低谷边界与信任考验.md",
    title: "第三章：低谷、边界与信任考验",
    brief: "两人稳定联系一个多月、完成一次语音和一次咖啡见面后，夏紫桐进入一段低能量期，拒绝邀约；男方焦虑、连续发消息并越界。双方围绕为什么不告诉我、独处权、回复时限、支持菜单、专业帮助和伴侣不是治疗师发生争执并具体修复。穿插猫、吃饭、工作和书，不用低谷推动浪漫。"
  },
  {
    file: "06_第4章_现实冲突与关系修复.md",
    title: "第四章：现实冲突与关系修复",
    brief: "关系恢复后继续见面。处理工作加班、临时取消、男方朋友把夏紫桐当成追到的目标、夏对被照顾的抵触、男方需要确认感。包含一次说重话、一天冷静期、重新陈述事实与感受、具体行为修复。禁止背叛和狗血误会。"
  },
  {
    file: "07_第5章_喜欢出现但不急着命名.md",
    title: "第五章：喜欢出现，但不急着命名",
    brief: "第二、第三次约会逐渐自然。双方承认有好感，却对确定关系的速度不同。谈暧昧排他性、与异性朋友来往、如何称呼、是否告诉朋友。安排书店、菜市场、雨天散步和一次做饭失败。出现一次吃醋但不查手机，最后形成临时共识。"
  },
  {
    file: "08_第6章_确认关系与第一轮磨合.md",
    title: "第六章：确认关系与第一轮磨合",
    brief: "双方明确、自愿确认恋爱关系。确认不是结尾：讨论联系频率、约会轮流提议、公开程度、身体接触需确认、各自独处时间。第一次牵手和拥抱写得克制真实。包含男方过度兴奋、夏感觉压力、双方重新校准。"
  },
  {
    file: "09_第7章_亲密之后的普通日子.md",
    title: "第七章：亲密之后的普通日子",
    brief: "恋爱初期进入普通生活：早晨消息、加班、买菜、各自见朋友、周末不见面、无聊电话、一次对方忘记约定。写出平淡、重复和不推进感情的闲聊。围绕陪伴是否必须有内容发生一次小争执并修复。"
  },
  {
    file: "10_第8章_家庭朋友与外部目光.md",
    title: "第八章：家庭、朋友与外部目光",
    brief: "双方逐步见朋友，但不急着见家长。男方朋友的玩笑触发夏的不适，夏的大学朋友担心男方重演执着追求。双方处理外部评价、隐私公开、社交疲劳和各自朋友圈边界。包含一次聚餐后的争执与道歉。"
  },
  {
    file: "11_第9章_金钱时间与未来选择.md",
    title: "第九章：金钱、时间与未来选择",
    brief: "讨论约会费用分担、礼物、收入差异、工作变动、是否换城市。男方想提前规划获得安全感，夏不愿过度承诺。出现一次关于未来的僵持，但通过区分愿望、计划、承诺来修复。穿插预算、超市、通勤和旅行计划。"
  },
  {
    file: "12_第10章_继续练习而不是童话结尾.md",
    title: "第十章：继续练习，而不是童话结尾",
    brief: "一年内的阶段性总结。经历一次较大的误会、低谷复发期的边界实践、工作选择与短暂异地讨论。双方重新谈关系规则，确认愿意继续，但不承诺永远不会变化。结尾是一段普通晚饭后的对话，呈现可持续关系而非童话。"
  }
];

const system = `你是现实主义中文对话作家兼关系训练教练。只写两个虚构成年人的自愿恋爱关系。
人物固定：
1. 男方用“我”标记，与夏紫桐同岁。初中曾追求她三年未成功，高考后失联。现在工作稳定但会焦虑，容易把沉默解释成拒绝；他愿意成长，但不是完美的高情商男主。
2. 夏紫桐知性、独立，湖南中医药大学毕业，目前职业细节保持适度模糊。她有自己的工作、朋友、兴趣和拒绝权。她有抑郁症，并拥有专业帮助和朋友支持；不浪漫化疾病，不让伴侣替代医生或咨询师，不写自伤细节。
写作规则：不使用PUA、欲擒故纵、贬低、情感债；过去三年追求不能成为索取回报的理由。人物会说错话、停顿、改口、无聊、重复普通话题。不要让每句话都成为金句或推进感情。`;

await mkdir(root, { recursive: true });

function normalizeDialogue(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/^\*\*(我|夏紫桐)：\*\*\s*\n+/gm, "**$1：** ")
    .replace(/^###?\s*第?\d+章[^\n]*\n?/gm, "")
    .trim();
}

function dialogueChars(text) {
  const matches = [...String(text).matchAll(/^\*\*(?:我|夏紫桐)：\*\*\s*(.+)$/gm)];
  return matches.reduce((sum, match) => sum + match[1].replace(/\s/g, "").length, 0);
}

function dialogueLines(text) {
  return [...String(text).matchAll(/^\*\*(?:我|夏紫桐)：\*\*\s*(.+)$/gm)].map(m => m[0]);
}

function duplicateRatio(text) {
  const lines = dialogueLines(text).map(line => line.replace(/\s/g, ""));
  if (!lines.length) return 1;
  return 1 - new Set(lines).size / lines.length;
}

async function ask(messages) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      model: "mimo-v2.5",
      messages,
      temperature: 0.9,
      top_p: 0.95,
      max_completion_tokens: 8000,
      stream: false
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`);
  const json = JSON.parse(raw);
  return json?.choices?.[0]?.message?.content || json?.output_text || "";
}

async function generateSegment(chapter, existing, segment) {
  const currentChars = dialogueChars(existing);
  const tail = existing.slice(-5000);
  const prompt = segment === 1
    ? `写《${chapter.title}》。场景要求：${chapter.brief}

本章必须以Markdown正文输出。每条消息严格写成单独一行，例如“**我：** 今天有点累。”或“**夏紫桐：** 那你先休息。”不要把消息正文另起一行。写至少70条对话消息；使用时间标记分成多个自然场景。每10到16条消息可加入不超过180字的“### 教练复盘”，但复盘不能代替对话。单次输出尽量达到7000至9000个中文字符。不要写本章总结，不要提前进入下一章。`
    : `继续写《${chapter.title}》的第${segment}部分。当前纯对话字符约${currentChars}，目标至少${targetDialogueChars}。承接下面末尾，不要复述、不要重新开章、不要重复相同事件：

---末尾---
${tail}
---末尾结束---

继续增加至少60条一行一条的真实对话，推进本章剩余的普通日常、冲突或修复。必须保持“**我：** 正文”和“**夏紫桐：** 正文”格式。避免金句堆砌、避免教科书腔、避免重复道歉。除非达到本章完整收束，否则不要总结。`;

  return normalizeDialogue(await ask([
    { role: "system", content: system },
    { role: "user", content: prompt }
  ]));
}

const progress = [];
for (const chapter of chapters) {
  const target = path.join(root, chapter.file);
  let content = "";
  try {
    content = await readFile(target, "utf8");
  } catch {}

  if (!content.trim()) content = `# ${chapter.title}\n\n`;
  let segment = 1;
  while (dialogueChars(content) < targetDialogueChars && segment <= maxSegments) {
    let addition = "";
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        addition = await generateSegment(chapter, content, segment);
        if (dialogueChars(addition) < 1000) throw new Error("segment dialogue too short");
        break;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 3000));
      }
    }
    if (!addition) throw lastError || new Error("empty segment");
    content += `\n\n## 片段 ${segment}\n\n${addition}\n`;
    await writeFile(target, content, "utf8");
    const row = {
      file: chapter.file,
      segment,
      totalCharacters: content.length,
      dialogueCharacters: dialogueChars(content),
      dialogueLines: dialogueLines(content).length,
      duplicateRatio: Number(duplicateRatio(content).toFixed(4))
    };
    progress.push(row);
    await writeFile(path.join(root, "generation-progress.json"), JSON.stringify(progress, null, 2), "utf8");
    console.log(JSON.stringify(row));
    segment++;
  }

  if (dialogueChars(content) < targetDialogueChars) {
    throw new Error(`${chapter.file} did not reach target: ${dialogueChars(content)}`);
  }
}

const summary = [];
for (const chapter of chapters) {
  const content = await readFile(path.join(root, chapter.file), "utf8");
  summary.push({
    file: chapter.file,
    totalCharacters: content.length,
    dialogueCharacters: dialogueChars(content),
    dialogueLines: dialogueLines(content).length,
    duplicateRatio: Number(duplicateRatio(content).toFixed(4))
  });
}
await writeFile(path.join(root, "generation-summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify({ complete: true, summary }));
