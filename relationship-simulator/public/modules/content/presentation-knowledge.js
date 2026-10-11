/** 公开资料的简短原创摘要。事实逐条映射来源；场景练习不是经过验证的治疗方案。 */
export const KNOWLEDGE_REVIEWED_AT = "2026-10-04";

export const KNOWLEDGE_CATEGORIES = Object.freeze([
  { id: "fitness", title: "健身", description: "先了解运动量、动作和恢复，再选择适合自己的计划。" },
  { id: "skincare", title: "护肤", description: "从清洁、保湿、防晒开始，分清日常护理和药物治疗。" },
  { id: "style", title: "穿搭", description: "用版型、面料与色彩理解衣服，再结合场合和个人喜好。" },
  { id: "voice", title: "声音与仪态", description: "练清楚、舒服的表达，以及让双方自在的现场互动。" },
  { id: "physiology", title: "女性生理", description: "了解月经、经前症状与性健康，学会提供合适的支持。" },
  { id: "psychology", title: "心理与相处", description: "理解具体的人，练习倾听、互惠和边界沟通。" }
]);

export const KNOWLEDGE_SOURCES = Object.freeze({
  "cdc-activity": { organization: "CDC", title: "成年人运动建议", kind: "公共卫生指南解读", url: "https://www.cdc.gov/physical-activity-basics/guidelines/adults.html", publishedAt: "2023-12-20", supports: "成人每周有氧运动量、主要肌群强化、分段活动。" },
  "cdc-intensity": { organization: "CDC", title: "如何判断运动强度", kind: "公共卫生科普", url: "https://www.cdc.gov/physical-activity-basics/measuring/index.html", publishedAt: "2025-12-04", supports: "谈话测试判断相对运动强度。" },
  "nhs-strength": { organization: "NHS", title: "居家力量练习示范", kind: "医疗机构健康教育", url: "https://www.nhs.uk/live-well/exercise/strength-exercises/", publishedAt: "2024-02-28", supports: "稳固器材、坐站与靠墙俯卧撑、循序增加次数。" },
  "aad-basics": { organization: "美国皮肤病学会 AAD", title: "简化护肤与产品选择", kind: "专业学会公众建议", url: "https://www.aad.org/public/everyday-care/skin-care-basics/care/skin-care-budget", supports: "温和清洁、保湿、防晒、减少产品刺激与按肤质选择。" },
  "aad-isotretinoin": { organization: "美国皮肤病学会 AAD", title: "异维 A 酸的安全与护理", kind: "专业学会药物教育", url: "https://www.aad.org/public/diseases/acne/derm-treat/isotretinoin/side-effects", publishedAt: "2025-09-22", supports: "处方药评估、干燥与日晒敏感、护理和刺激性产品限制。" },
  "usu-design": { organization: "犹他州立大学 USU Extension", title: "服装与纺织品的设计要素", kind: "服装专业同行审阅教材", url: "https://extension.usu.edu/research/elements-of-design", publishedAt: "2010-01", supports: "廓形、纹理、色相、明度和饱和度；不证明约会吸引力。" },
  "ada-breath": { organization: "美国牙科协会 ADA", title: "口气与口腔护理", kind: "专业学会公众建议", url: "https://www.mouthhealthy.org/all-topics-a-z/bad-breath", supports: "刷牙、牙间清洁、持续口臭需要查找原因。" },
  "nidcd-voice": { organization: "美国 NIH / NIDCD", title: "照顾你的声音", kind: "医学研究机构健康教育", url: "https://www.nidcd.nih.gov/health/taking-care-your-voice", publishedAt: "2025-06-11", supports: "音色个体差异、避免极端发声与疲劳用声、呼吸支持及求助。" },
  "owh-cycle": { organization: "美国 HHS 女性健康办公室 OWH", title: "月经周期基础", kind: "政府健康教育", url: "https://womenshealth.gov/menstrual-cycle/your-menstrual-cycle", supports: "周期从月经第一天开始计算、周期有个体与月间差异。" },
  "owh-pms": { organization: "美国 HHS 女性健康办公室 OWH", title: "经前综合征 PMS", kind: "政府健康教育", url: "https://womenshealth.gov/menstrual-cycle/premenstrual-syndrome", supports: "经前身体与情绪症状、严重程度差异、影响生活时求助。" },
  "owh-period": { organization: "美国 HHS 女性健康办公室 OWH", title: "月经疼痛与异常出血", kind: "政府健康教育", url: "https://womenshealth.gov/menstrual-cycle/period-problems", supports: "严重疼痛、频繁浸透卫生用品及伴随不适需要就医。" },
  "cdc-sti": { organization: "CDC", title: "预防性传播感染", kind: "公共卫生科普", url: "https://www.cdc.gov/sti/prevention/index.html", publishedAt: "2024-04-09", supports: "无症状感染、正确使用安全套、按风险讨论检测。" },
  "cdc-contraception": { organization: "CDC", title: "避孕方法与紧急避孕", kind: "公共卫生科普", url: "https://www.cdc.gov/contraception/about/index.html", publishedAt: "2024-08-06", supports: "避孕方法各有条件、避孕失败后的紧急避孕；多数方法不能预防感染。" },
  "hyde-2005": { organization: "Hyde / American Psychologist", title: "性别相似性假说（2005）", kind: "心理学研究综述", url: "https://pubmed.ncbi.nlm.nih.gov/16173891/", publishedAt: "2005-09", supports: "46 项元分析综述：多数但非全部心理变量相似，差异受年龄与情境影响。" },
  "nhs-relationships": { organization: "NHS Every Mind Matters", title: "健康关系与心理健康", kind: "医疗机构健康教育", url: "https://www.nhs.uk/every-mind-matters/lifes-challenges/maintaining-healthy-relationships-and-mental-wellbeing/", supports: "积极倾听、开放沟通、压力支持、自我照顾与边界。" }
});

export const KNOWLEDGE_CARDS = [
  {
    id: "fitness-baseline", category: "fitness", title: "运动量：有氧与力量分别安排", summary: "用频率、强度、时长和活动类型规划一周。",
    scope: "一般成人健康教育。伤病、慢性病或医生限制下，应先调整活动种类和强度。",
    facts: [
      { text: "成人每周至少 150 分钟中等强度有氧，或 75 分钟高强度有氧，或等效组合；另安排至少 2 天主要肌群强化。", sources: ["cdc-activity"] },
      { text: "中等强度时通常能说话但难以唱歌；高强度时通常说几句话就要换气。谈话测试是相对强度的粗略判断。", sources: ["cdc-intensity"] },
      { text: "活动可以分段累计；从少量开始也有意义，不需要第一周就完成全部目标。", sources: ["cdc-activity"] }
    ],
    mistake: "把每天高强度训练或体重增加当成更有魅力的必要条件。健康指南没有承诺约会成功率。",
    practice: ["先写下本周能安排的两段运动时间，选择能坚持的走路、骑行等活动。", "根据谈话测试调节速度，记录时长和自己的感受。", "每周回看能否持续，再逐步增加；约会当天避免临时加量造成疲劳。"],
    boundary: "这个一周练习是安排示例，不是个人运动处方；出现明显不适就停止，并按需要咨询医生。",
    quiz: { question: "哪种安排更符合运动指南？", options: ["先累计可承受的有氧活动，并逐步加入主要肌群强化", "为了吸引人，必须每天练到力竭"], answer: 0, explanation: "运动量建议包含有氧和肌群强化，也允许分段累计和循序开始。" }
  },
  {
    id: "fitness-technique", category: "fitness", title: "力量训练：先掌握动作，再逐步增加", summary: "入门动作示范、器材稳定性和恢复感受。",
    scope: "适合阅读入门原则；具体动作能否做取决于活动能力与伤病情况。",
    facts: [
      { text: "NHS 入门示范包括坐站、浅蹲、提踵与靠墙俯卧撑，并建议缓慢增加次数。", sources: ["nhs-strength"] },
      { text: "椅子应稳固、无轮且不易滑动。器材与动作版本需要先匹配自己的能力。", sources: ["nhs-strength"] },
      { text: "肌群强化应覆盖腿、髋、背、腹、胸、肩、臂；单做某一个动作不能代表完整训练。", sources: ["cdc-activity"] }
    ],
    mistake: "直接套用固定杠铃 A/B 计划，或认为助力带可以替代动作学习和安全保护。",
    practice: ["打开 NHS 原文动作示范，先选一个能无痛完成的版本；不熟悉器械时请合格教练检查。", "记录动作、次数与练后感受，稳定完成后再考虑增加一项负荷。", "按个人计划留出恢复；体重记录只看变化，不自动加减热量。"],
    boundary: "不在这里给所有人规定重量、组数、饮水量或热量。既有医疗限制与个体训练计划优先。",
    quiz: { question: "新动作不熟悉时，应先做什么？", options: ["先上大重量，第二天酸痛就算有效", "选合适版本，学习动作并检查器材稳定性"], answer: 1, explanation: "入门示范强调稳定、循序和动作适配；酸痛不等于训练质量。" }
  },
  {
    id: "skin-baseline", category: "skincare", title: "护肤基础：清洁、保湿、防晒", summary: "先做简单、可持续的护理，再处理具体问题。",
    scope: "一般日常护理；湿疹、严重痤疮、持续刺激或过敏需要专业评估。",
    facts: [
      { text: "AAD 建议从温和清洁、保湿、日晒防护三部分建立简单护理，产品价格不是有效性的保证。", sources: ["aad-basics"] },
      { text: "按肤质选产品；叠加很多产品可能刺激皮肤。容易堵塞毛孔时可留意 non-comedogenic 标识。", sources: ["aad-basics"] },
      { text: "遮阴、衣物和防晒霜共同防护；防晒霜选广谱 SPF 30 或以上，户外注意约每 2 小时及游泳、出汗后补涂。", sources: ["aad-basics"] }
    ],
    mistake: "把刷酸、美白或昂贵精华当成约会前必须完成的步骤。",
    practice: ["检查已有产品的用途和标签，先确认自己有温和清洁、适合的保湿和日晒防护。", "出门前按当天日晒和活动安排防护；记录只是帮助回看习惯。", "约会前沿用已耐受的护理，避免临时叠加陌生产品。"],
    boundary: "护理不要求追求某一种肤色；明显刺激时停止新加的非处方产品，持续或严重时就医。",
    quiz: { question: "基础护理优先考虑什么？", options: ["肤质适配、简单护理与日晒防护", "产品越多越贵，效果越好"], answer: 0, explanation: "AAD 强调简化护理和肤质适配，多种产品可能增加刺激。" }
  },
  {
    id: "skin-medication", category: "skincare", title: "药物护理：和普通打卡分开", summary: "异维 A 酸是处方治疗，日常护理卡不能代替随访。",
    scope: "仅用于理解处方药护理；本卡不表示你正在服药，也不推荐开始、停用或调整剂量。",
    facts: [
      { text: "异维 A 酸治疗需皮肤科评估收益与风险；护理和随访应跟随开药医生的安排。", sources: ["aad-isotretinoin"] },
      { text: "治疗可能伴随干燥与日晒敏感，AAD 建议温和清洁、保湿、唇部护理和日晒防护。", sources: ["aad-isotretinoin"] },
      { text: "服药时维生素 A 补充剂、外用 retinol 和刺激性去角质产品需要特别注意；不要自行叠加。", sources: ["aad-isotretinoin"] }
    ],
    mistake: "用一个“漏打卡”提醒判断用药安全，或把他人的医嘱套到每个人身上。",
    practice: ["若确有处方，列出正在使用的药物、补充剂和护肤品，向医生确认是否冲突。", "把持续不适和疑问带到复诊，不靠应用自动诊断。", "尚未服药的人继续使用基础护理卡；无需执行本卡的药物限制。"],
    boundary: "个体医嘱和当地药品说明优先；美国随访制度不能直接当成中国就诊规定。",
    quiz: { question: "出现用药与护肤产品搭配疑问，应怎样处理？", options: ["根据打卡天数自己改剂量", "向开药医生核对，不自行叠加或调整处方"], answer: 1, explanation: "药物治疗需个体评估与随访，习惯记录不能判断药物安全。" }
  },
  {
    id: "style-design", category: "style", title: "穿搭基础：版型、面料与配色", summary: "用服装设计概念理解搭配，用试穿确认适合。",
    scope: "服装设计教育与原创试穿练习。效果受衣服、身形、场合和审美影响。",
    facts: [
      { text: "廓形是衣服的整体轮廓，剪裁和结构会改变廓形；合身不能只看尺码标签。", sources: ["usu-design"] },
      { text: "面料纹理与纤维、纱线、结构有关，同时影响视觉感受和舒适度。", sources: ["usu-design"] },
      { text: "色彩可以从色相、明度、饱和度理解；搭配没有统一的“只能三色”或“某颜色必然吸引人”规则。", sources: ["usu-design"] }
    ],
    mistake: "把修身、露脚踝、同色系规定为每个人都必须遵守的魅力公式。",
    practice: ["拿两件现有上衣试穿，比较肩部、胸背、衣长；坐下、抬手和走动检查是否勒、拉扯或妨碍活动。", "按天气与地点选面料，比较厚薄、触感、透气感和护理要求。", "先试一套低对比搭配，再换一个颜色或配饰；选自己舒服的版本，而不是遮掩所谓身体缺陷。"],
    boundary: "教材支持设计概念；这些试穿步骤是实践建议，没有证明能提高对方好感。",
    quiz: { question: "判断衣服是否适合，哪项更可靠？", options: ["试穿活动，并结合面料、场合与喜好", "只要比平时小一码就一定更好看"], answer: 0, explanation: "版型和舒适需要实物确认，单一尺码或风格不能适合所有人。" }
  },
  {
    id: "style-date", category: "style", title: "约会准备：场景、整洁与口腔护理", summary: "先考虑当天活动，再做出门前检查。",
    scope: "场景搭配为原创示例；口腔护理部分依据牙科协会公众建议。",
    facts: [
      { text: "服装的廓形、纹理和色彩可用来表达个人风格；具体应用由穿着者结合任务与场合选择。", sources: ["usu-design"] },
      { text: "ADA 建议每天刷牙两次、每天清洁牙间。持续口臭需要查明原因，不能只用香气掩盖。", sources: ["ada-breath"] }
    ],
    mistake: "照搬一种“约会制服”，或通过香水、口香糖替代清洁和牙科检查。",
    practice: ["咖啡约会可选舒适上衣与整洁裤鞋；步行活动先考虑鞋和天气；正式餐厅先核对着装要求。", "检查衣鞋污渍、衣服活动余量、发型与指甲；香气用量考虑双方敏感和空间，不必使用香水。", "把口腔清洁放到平日；持续口气问题预约牙科评估。"],
    boundary: "搭配示例可按个人文化与风格调整；整洁和舒适不要求花大钱。",
    quiz: { question: "步行约会该优先检查什么？", options: ["是否足够昂贵、香气足够浓", "鞋与服装是否适合步行、天气和自己的舒适度"], answer: 1, explanation: "场景准备解决实际活动需求，价格和浓香不能替代合适与整洁。" }
  },
  {
    id: "voice-care", category: "voice", title: "声音基础：清楚、自然、不过度用力", summary: "改善表达习惯，保持自己舒服的音域。",
    scope: "一般用声教育和原创朗读练习；不提供声带治疗、变声或吸引力评分。",
    facts: [
      { text: "音高和音色受声带及共鸣腔结构影响，人的声音本来就不同，没有统一的理想音高。", sources: ["nidcd-voice"] },
      { text: "疲劳或嘶哑时应减少用声；喊叫、刻意耳语与噪声中大声讲话都会增加负担。", sources: ["nidcd-voice"] },
      { text: "讲话需要呼吸支持；反复用力、嗓音变化或说话费劲时，应向医生或言语治疗专业人员求助。", sources: ["nidcd-voice"] }
    ],
    mistake: "强压低音、模仿“气泡音”，把喉咙不舒服解释成练出了磁性。",
    practice: ["在安静环境用自然音高读：“周六下午要不要一起喝杯咖啡？不方便也没关系。”", "按意思分成两到三段，句间自然换气，检查自己是否能舒服说完。", "再读一遍，只调整一句的停顿或清晰度。无需录音、上传或比较音色。"],
    boundary: "嗓子疼、嘶哑或费力时停止练习；持续问题就医。不要在噪声中反复提高音量。",
    quiz: { question: "练习时开始喉咙痛，应该怎样做？", options: ["继续压低音，练到声音沙哑", "停止练习、休息；持续或明显问题请专业人员评估"], answer: 1, explanation: "舒服的用声比模仿某种音色更重要，疲劳和嘶哑时需要休息。" }
  },
  {
    id: "voice-presence", category: "voice", title: "仪态与现场表达：放松、倾听、留空间", summary: "练习可观察的互动，不用姿态猜测心理。",
    scope: "原创约会场景练习。姿势、眼神和距离受文化、身体状况与个人偏好影响。",
    facts: [
      { text: "长期夹着电话讲话会造成颈部紧张；自然姿势和呼吸支持有助于健康用声。", sources: ["nidcd-voice"] },
      { text: "积极倾听可以通过复述或澄清，检查自己是否理解对方。", sources: ["nhs-relationships"] }
    ],
    mistake: "用固定眼神秒数、强迫直视或靠近，判断、制造所谓好感。",
    practice: ["坐下时找舒服的支撑，让肩颈放松；不憋气、不刻意挺成某种姿势。", "听完一句再回应；用“我听起来你更想……”复述，并允许对方纠正。", "对方听不清时询问是否换个安静位置；需要更近或身体接触时先确认意愿。"],
    boundary: "回避眼神或姿态变化不能单独证明喜欢、拒绝或某种心理问题；明确表达和实际互动更可靠。",
    quiz: { question: "对方很少看你，能够直接推断什么？", options: ["无法仅凭这个动作判断心理，需要结合表达与互动", "一定不喜欢你，或者一定是在害羞"], answer: 0, explanation: "单个非语言动作有多种可能，场景练习不提供读心结论。" }
  },
  {
    id: "cycle-literacy", category: "physiology", title: "月经周期：知道基础，不替她预测", summary: "月经、排卵和周期差异，不把日期当成行为说明书。",
    scope: "成人女性健康知识。年龄、妊娠、用药和健康状态会改变周期，不能自行诊断。",
    facts: [
      { text: "月经周期从月经第一天算到下一次月经开始；28 天只是常见示例，不是每个人的固定时钟。", sources: ["owh-cycle"] },
      { text: "OWH 描述成人常见周期范围为 24–38 天，个人不同月份也可能有差异；异常或担忧应咨询医生。", sources: ["owh-cycle"] },
      { text: "排卵是卵巢释放卵子，发生时间有差异；了解周期不能保证预测某天不会怀孕。", sources: ["owh-cycle", "cdc-contraception"] }
    ],
    mistake: "根据月经日期推断情绪、性欲或最合适的追求时间，或把估算“安全期”当可靠保证。",
    practice: ["对方主动说身体不适时，先问：“今天要不要改成轻松一点，或者改天？”", "需要准备物品时询问具体偏好；未经允许不追问周期日期，也不代她做记录。", "亲密行为的意愿单独确认；避孕和感染防护单独协商。"],
    boundary: "知识用于理解和支持；本应用不采集、计算或保存对方的月经周期。",
    quiz: { question: "知道对方周期后，可以据此确认她愿意亲密接触吗？", options: ["可以，排卵期就意味着愿意", "不可以，日期不能替代当下明确且可撤回的同意"], answer: 1, explanation: "生理周期与某次互动意愿是不同问题；不能把日期当作许可。" }
  },
  {
    id: "period-support", category: "physiology", title: "经前症状与痛经：支持需要问本人", summary: "理解不适和严重程度差异，避免一句“多喝热水”。",
    scope: "帮助识别需要支持或就医的情况；不提供诊断或止痛药剂量。",
    facts: [
      { text: "PMS 可包含经前的身体和情绪症状；有的人症状轻微或没有明显症状，有的人会影响日常生活。", sources: ["owh-pms"] },
      { text: "严重疼痛或出血影响上学、工作与日常活动时，应寻求医疗评估，而不是要求忍耐。", sources: ["owh-cycle", "owh-period"] },
      { text: "每 1–2 小时浸透卫生巾或棉条，或出血伴头晕、明显虚弱等情况，应及时就医。", sources: ["owh-period"] }
    ],
    mistake: "把每一次不高兴都解释为经前症状，否定她对具体事情的意见。",
    practice: ["用“你现在更需要休息、我帮忙做点什么，还是陪你？”询问。", "根据本人意愿调整行程；饮水、食物或其他用品按她的习惯提供，不代替治疗。", "若症状明显影响生活，支持她联系医疗机构；是否陪同和如何分享信息由她决定。"],
    boundary: "突然严重不适、晕厥、胸痛或呼吸困难应立即求助急救；不要用应用自测决定是否就医。",
    quiz: { question: "她说疼得无法正常工作时，合适的回应是？", options: ["认真对待，询问需要并支持医疗评估", "所有人都这样，忍一忍就好了"], answer: 0, explanation: "影响正常生活的疼痛值得评估，具体支持要尊重本人意愿。" }
  },
  {
    id: "sexual-health", category: "physiology", title: "亲密前：同意、避孕与感染防护", summary: "把共同责任谈清楚，再决定是否发生亲密行为。",
    scope: "仅针对有能力同意的成年人；个体避孕选择和检测安排需医疗咨询。",
    facts: [
      { text: "多数性传播感染可能没有明显症状，不能通过外表或自我感觉确认没有感染。", sources: ["cdc-sti"] },
      { text: "正确、持续使用安全套有助于降低感染与妊娠风险，但不能保证完全保护；多数其他避孕方法不预防感染。", sources: ["cdc-sti", "cdc-contraception"] },
      { text: "无保护性行为或避孕失败后存在紧急避孕选择，应尽快咨询医疗人员；方法、时限和适用性不同。", sources: ["cdc-contraception"] }
    ],
    mistake: "把愿意约会、牵手或过去发生过亲密行为，当成这一次的同意；把避孕责任全部交给女性。",
    practice: ["提前询问双方边界：什么可以、什么不想做；允许随时改变决定。", "共同讨论安全套、其他避孕方法、检测与出现问题后的求助安排，不要求对方公开全部病史。", "任何一方犹豫、拒绝、睡着或醉到无法清楚决定，就停止推进；尊重与退出优先。"],
    boundary: "不使用本卡计算安全日、诊断感染或指定药物；具体方式必须得到双方明确同意。",
    quiz: { question: "对方之前同意过亲密行为，这次沉默，你应该？", options: ["默认持续同意", "停下来确认当下意愿，无法明确确认就不继续"], answer: 1, explanation: "同意需要针对当下具体行为，且随时可以撤回。" }
  },
  {
    id: "psych-individual", category: "psychology", title: "女性心理：从具体的人开始理解", summary: "区分群体研究、个体差异和自己的推测。",
    scope: "心理学研究素养，不是女性行为预测模型，也不是诊断工具。",
    facts: [
      { text: "Hyde（2005）综述 46 项元分析，支持多数但非全部心理变量上的性别相似性；差异还受年龄与情境影响。", sources: ["hyde-2005"] },
      { text: "这是历史研究综述，不能证明所有人相同，也不能从性别直接推断某个人的想法。", sources: ["hyde-2005"] },
      { text: "开放沟通、支持和倾听是健康关系的基础，而不是把对方装进一种性别模板。", sources: ["nhs-relationships"] }
    ],
    mistake: "用“女人都喜欢强势”“冷淡就是考验”解释具体行为。",
    practice: ["把判断拆成两句：可观察事实是什么？我补上的解释是什么？", "用不预设答案的问题询问偏好：“你更喜欢提前约，还是临近再决定？”", "结合她自己的回答与持续行为调整，不因一次回复给人格或依恋类型贴标签。"],
    boundary: "不计算好感概率，不从月经、性别或少量聊天诊断心理；未知的部分保留未知。",
    quiz: { question: "她回复慢，当前可以确认什么？", options: ["这一次回复较慢，原因仍需更多信息", "她在测试你，必须冷落她"], answer: 0, explanation: "事实是回复节奏；动机不能仅凭这一条行为确定。" }
  },
  {
    id: "psych-listening", category: "psychology", title: "情绪支持：先理解，再决定怎么帮", summary: "复述、澄清和询问，比抢着给答案更稳妥。",
    scope: "适用于日常交流，男女都可使用。临床心理问题需要专业支持。",
    facts: [
      { text: "积极倾听包括复述对方的话，或在不清楚时进一步询问，以核对理解。", sources: ["nhs-relationships"] },
      { text: "压力可能影响互动；提供支持也应保留自己的边界和自我照顾。", sources: ["nhs-relationships"] }
    ],
    mistake: "一边说“我懂”，一边立刻否定感受、接管决定，或把照顾当成交换好感的投资。",
    practice: ["听到“今天真的很累”时，先复述：“听起来今天消耗挺大的，我理解得对吗？”", "再问：“想让我听你说，还是一起想个办法？”", "只承诺能做到的帮助；若需要休息，说明何时能再聊，不使用惩罚性冷落。"],
    boundary: "这是原创对话练习；对方可以不倾诉，你也不承担无限支持或治疗责任。",
    quiz: { question: "对方正在倾诉，你还不清楚她需要什么，先做什么？", options: ["立刻解释她哪里想错了", "核对理解，再问需要倾听还是具体帮助"], answer: 1, explanation: "复述和澄清用于确认理解，支持方式需要问本人。" }
  },
  {
    id: "psych-reciprocity", category: "psychology", title: "好感与安全感：看互惠，尊重选择", summary: "学会表达兴趣，也接受对方不同的节奏或拒绝。",
    scope: "原创约会练习；健康关系原则不能保证他人产生好感。",
    facts: [
      { text: "健康关系需要尊重、支持与开放交流；个人边界与自己的生活同样重要。", sources: ["nhs-relationships"] },
      { text: "冲突时可以先暂停、平静后再谈；不舒服或影响心理健康的关系可以退出。", sources: ["nhs-relationships"] }
    ],
    mistake: "用故意失联、嫉妒测试、虚假稀缺或不断追问制造所谓安全感。",
    practice: ["表达一个具体、低压力的邀请，给时间与地点，也允许拒绝或改期。", "回看是否双方都有发起、回应与协商；一次笑容、一次关心不能单独证明恋爱意愿。", "明确拒绝后停止推进；节奏不合时直接沟通，不把付出变成对方的义务。"],
    boundary: "本卡支持诚实互动，不提供操控技巧；互惠是观察线索，只有本人能表达是否愿意发展关系。",
    quiz: { question: "对方明确说不想发展关系，应怎样做？", options: ["接受并停止追求，不把之前的付出当成债务", "加倍投入，证明她迟早会改主意"], answer: 0, explanation: "拒绝应被接受，安全感与互惠不能通过施压换来。" }
  }
];

export function getKnowledgeCards(category = "fitness") {
  return KNOWLEDGE_CARDS.filter((card) => card.category === category);
}

/** 仅反馈知识理解，不评估外形、人格、健康状况或恋爱成功率。 */
export function evaluateKnowledgeAnswer(cardId, optionIndex) {
  const card = KNOWLEDGE_CARDS.find((item) => item.id === cardId);
  if (!card || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= card.quiz.options.length) return null;
  return { correct: optionIndex === card.quiz.answer, explanation: card.quiz.explanation };
}
