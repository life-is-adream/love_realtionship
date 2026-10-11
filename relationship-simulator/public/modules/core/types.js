/**
 * HeartFlow 全局类型定义
 *
 * 本文件仅包含 JSDoc 类型定义，不产生任何运行时导出。
 * 在 IDE 中可通过 import 类型注释获得类型提示。
 *
 * @module types
 */

/**
 * @typedef {Object} PersonaObject
 * @property {string} id - 角色 ID
 * @property {string} name - 角色名称
 * @property {string} [avatar] - 头像文字
 * @property {string} [avatarImage] - 头像图片路径
 * @property {string} meta - 角色元信息
 * @property {Array<string>} tags - 标签列表
 * @property {string} logic - 角色逻辑描述
 * @property {string} systemRole - 系统角色提示词
 * @property {Array<MessageObject>} starterMessages - 初始对话消息
 * @property {string} defaultGoal - 默认对话目标
 * @property {string} [localHerReply] - 默认本地回复
 */

/**
 * @typedef {Object} MessageObject
 * @property {string} who - 发送者名称
 * @property {"me"|"her"} type - 消息类型
 * @property {string} text - 消息文本
 * @property {string} [source] - 消息来源
 * @property {string} [createdAt] - 创建时间 ISO 字符串
 */

/**
 * @typedef {Object} AppState
 * @property {string} personaId - 当前角色 ID
 * @property {Object<string, PersonaObject>} customPersonas - 自定义角色
 * @property {Object<string, MemoryObject>} personaMemory - 角色记忆
 * @property {Object<string, AvatarSettings>} avatarOverrides - 头像覆盖设置
 * @property {Array<MessageObject>} messages - 对话消息列表
 * @property {Array<TrainingLogEntry>} trainingLog - 训练日志
 * @property {Object|null} lastAnalysis - 最近一次分析结果
 * @property {LearningState} learning - 学习状态
 * @property {Object|null} lastGenerationMeta - 最近生成元数据
 */

/**
 * @typedef {Object} MemoryObject
 * @property {string} background - 背景描述
 * @property {string} interests - 兴趣描述
 * @property {string} boundaries - 边界描述
 */

/**
 * @typedef {Object} AvatarSettings
 * @property {string} src - 头像图片源
 * @property {number} x - 头像 X 轴位置 (0-100)
 * @property {number} y - 头像 Y 轴位置 (0-100)
 * @property {boolean} isOverride - 是否为覆盖设置
 */

/**
 * @typedef {Object} CoachScore
 * @property {number} total - 总分 0-100
 * @property {number} naturalness - 自然度
 * @property {number} empathy - 共情
 * @property {number} boundary - 边界感
 * @property {number} momentum - 推进力
 * @property {string} weakestDim - 最弱维度 key
 * @property {string} strongestDim - 最强维度 key
 * @property {string} strength - 亮点
 * @property {string} shortcoming - 短板
 * @property {string} nextPractice - 下一步练习
 * @property {string} summary - 总结
 */

/**
 * @typedef {Object} ReplyOption
 * @property {string} key - 选项标识 (A/B/C)
 * @property {string} label - 选项标签
 * @property {string} text - 回复文本
 * @property {string} [effect] - 预期效果
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {string} herReply - 女方回复
 * @property {string} herIntent - 兼容旧数据的回应概述，不作为心理事实展示
 * @property {Object} [evidenceReasoning] - 行为观察、可能解释、反证与未知
 * @property {string} yourGoal - 当前目标
 * @property {string} judgement - 当前判断
 * @property {string} risk - 风险提醒
 * @property {Array<ReplyOption>} replyOptions - A/B/C 回复选项
 * @property {"model"|"local"} replyOptionsSource - 回复选项来源
 * @property {string} recommendation - 推荐
 * @property {CoachScore} coachScore - 教练评分
 */

/**
 * @typedef {Object} LearningState
 * @property {number} schemaVersion - 数据结构版本
 * @property {Array<LearningEvent>} events - 学习事件列表
 * @property {Array<DailyTask>} dailyTasks - 每日任务
 * @property {Array<SignalAttempt>} signalAttempts - 信号练习记录
 * @property {Array<GrowthSnapshot>} growthSnapshots - 成长快照
 * @property {Array<ReplayAnalysis>} replayAnalyses - 回放分析
 * @property {Object} textbookProgress - 教材进度
 * @property {Object} settings - 设置
 */

/**
 * @typedef {Object} TrainingLogEntry
 * @property {string} time - 时间戳
 * @property {string} stage - 当前阶段
 * @property {string} mine - 我的回复
 * @property {string} herReply - 她的回复
 * @property {string} source - 来源
 * @property {CoachScore} score - 教练评分
 * @property {string} baseline - 基线标识
 */

/**
 * @typedef {Object} ConversationWindow
 * @property {Array<MessageObject>} recent - 最近消息
 * @property {Array<MessageObject>} older - 较旧消息
 */

/**
 * @typedef {Object} LLMResponse
 * @property {Object} raw - 原始 API 响应
 * @property {string} content - 解析后的文本内容
 */

export {};
