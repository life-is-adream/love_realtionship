# 个人恋爱能力画像 Implementation Plan

> **For agentic workers:** 按本文接口使用当前 collaboration 子代理并行实现纯评分规则和页面，由主代理负责状态装配及最终验收。用户已授权实现，不提交 Git。

**Goal:** 在 HeartFlow 添加八维个人能力画像，支持本地初评、证据说明、两个训练重点和定期复评。

**Architecture:** 规则内容、纯评分引擎和页面渲染分别独立。结构化答案放入现有 `learning.abilityAssessment`，持久化统一经过 state/backup 边界；旧聊天分不参与综合分。

**Tech Stack:** 原生 ES modules、HTML/CSS、Node test runner，无新增依赖。

## Global Constraints

- 八维 ID：`appearance / voice / communication / emotion / dating / boundaries / reliability / knowledge`。
- 每维 2 个 0–4 行为自评指标、1 个情境题，共 24 个证据槽位；缺失值为未知，明确的 0 是有效值。
- 分项是已回答项的 level 均值 × 25；24 项齐全才显示等权综合分。关键题错误独立提示并阻断高评级。所有分数标为产品规则下的初评。
- 不累计刷题积分，首次与重试分别标记；历史最多 30 次，相同提交不新增记录。
- 默认仅本页评估，明确同意才保存枚举答案；撤回同意清除记录。无姓名、聊天原文、照片、声音上传或模型调用。
- 沿用原 plum/rose/gold 主题和教程式疏朗布局；179 节课程和 Automation 15 不改动。

## Task 1: 评分内容和纯引擎

**Files:** `public/modules/training/ability-rubric.js`、`ability-assessment.js`、`test/ability-assessment.test.mjs`。

**Interfaces:**

```js
normalizeAbilityAssessment(value)
toPersistedAbilityAssessment(value)
setAbilityConsent(value, granted)
recordAbilityAssessment(value, { answers, scenarioAnswers }, { now = Date.now() } = {})
buildAbilityProfile(value, { now = Date.now() } = {})
setAbilityFocus(value, ids)
```

- [x] 实现八维行为指标、情境题、解释和下一步训练链接。
- [x] 实现答案白名单、版本、历史、重复提交、首次/重试和最多两个重点。
- [x] 回归验证未知不等于零、关键缺口不被平均、无旧分混入、版本与异常记录、不可变和同意控制。

## Task 2: 独立页面

**Files:** `public/modules/render/render-ability-assessment.js`、`public/ability-assessment.css`、`public/index.html`、`public/modules/render/workspace-nav.js`、相关 UI 和导航测试。

**Interfaces:** `renderAbilityAssessment()`、`resetAbilityAssessmentDrafts()`；从现有 store 读取，通过同步 `mutate` 提交。页面路由为 `#abilities`。

- [x] 添加导航、首页入口、顶部评级与覆盖度、八个折叠分项和评估表单。
- [x] 支持部分提交、两个重点、复评历史、训练链接、保存同意和清除。
- [x] 验证输入在重新渲染及导航后保留、保存失败保留草稿，恢复时清理旧草稿。

## Task 3: 状态装配和旧评分口径

**Files:** `core/learning-state.js`、`core/state.js`、`core/state-reset.js`、`public/app.js`、`server/asset-versioning.js`、状态/备份/生成提交回归。

```js
learning.abilityAssessment = normalizeAbilityAssessment(input.abilityAssessment);
persisted.learning.abilityAssessment = toPersistedAbilityAssessment(persisted.learning.abilityAssessment);
```

- [x] 接入状态规范化、导出备份、恢复及对话重置；旧存档加载为空评估。
- [x] 将旧 coach-event 的总分与最弱维度绑定改为分项证据，缺失时机不臆造；旧历史保留原记录，明确其旧口径。
- [x] 加入匿名现实/生活记录计数作为复核材料，计数不转化为外貌或现实能力分。

## Task 4: 验收

- [x] `npm test`、runtime 测试、`npm run check:circular`、新改 JS 语法及差异检查通过。
- [x] 使用隔离本地测试页面进行桌面/窄屏走查，不改用户当前浏览器档案、不调用模型。
- [x] 更新 README 与 `docs/verification/2026-10-13-personal-ability-assessment.md`，记录实际结果及边界。

完成：2026-10-13（Asia/Shanghai）。应用 769/769，runtime 43/43；96 模块无循环，121 次语法检查通过。详见验收记录；桌面完整截图受工具限制，使用 DOM 尺寸和状态验证，窄屏截图已检查。
