import test from "node:test";
import assert from "node:assert/strict";
import {
  DATE_JOURNEY_STAGES, DATE_JOURNEY_SCENARIOS, createDateJourney, getDateJourneyScene, getDateJourneySummary,
  submitDateJourneyResponse, retryDateJourneyResponse, recordDateJourneyObservation,
  advanceDateJourney, beginDateJourneyFollowup, stopDateJourney, invalidateDateJourneyResponse
} from "../public/modules/training/date-journey.js";
import { buildDateJourneyHtml, renderDateJourney, resetDateJourney } from "../public/modules/render/render-date-journey.js";

const reply = "我也喜欢展览里那幅漫画，聊这些让我很开心。你愿意周六一起去看展吗？不方便也没关系。";
const answered = () => submitDateJourneyResponse(createDateJourney(), reply);

test("six explicit mutual responses create one coherent journey without inferring interest", () => {
  let session = createDateJourney();
  for (let index = 0; index < DATE_JOURNEY_STAGES.length; index += 1) {
    const scene = getDateJourneyScene(session);
    assert.equal(scene.id, DATE_JOURNEY_STAGES[index]);
    assert.ok(scene.task && scene.counterEvidence && scene.unknowns.length);
    assert.equal(scene.responses.length, 4);
    if (index) assert.equal(scene.previousEvidence, getDateJourneyScene({ stageIndex: index - 1 }).responses[0].observation);
    session = submitDateJourneyResponse(session, reply);
    session = recordDateJourneyObservation(session, "positive");
    assert.equal(getDateJourneySummary(session).canAdvance, true);
    session = advanceDateJourney(session);
  }
  assert.equal(session.status, "complete");
  assert.equal(session.decision, "MAINTAIN");
  assert.equal(session.history.length, 6);
  assert.equal(getDateJourneySummary(session).canAdvance, false);
});

test("an attractive reply never manufactures a response or upgrades an uncertain observation", () => {
  let session = answered();
  assert.equal(session.decision, "OBSERVE");
  assert.equal(session.observation, null);
  assert.equal(getDateJourneySummary(session).canAdvance, false);
  session = recordDateJourneyObservation(session, "uncertain");
  const before = structuredClone(session);
  session = retryDateJourneyResponse(session, "我理解你最近忙，不用急着回复，我也会安排自己的周末。");
  assert.equal(session.stageIndex, 0);
  assert.equal(session.observation, "uncertain");
  assert.equal(session.decision, "OBSERVE");
  assert.deepEqual(session.history, before.history);
  assert.equal(session.status, "paused");
  assert.deepEqual(advanceDateJourney(session), session);
  assert.deepEqual(recordDateJourneyObservation(session, "positive"), session);
});

test("new evidence is separate from retry; repeated uncertainty lowers investment", () => {
  let session = recordDateJourneyObservation(answered(), "uncertain");
  session = beginDateJourneyFollowup(session);
  assert.equal(session.stageIndex, 0);
  assert.equal(session.observation, null);
  assert.equal(session.history.length, 1);
  assert.match(getDateJourneyScene(session).context, /没有追加催促/);
  assert.equal(getDateJourneySummary(session).canAdvance, false);
  session = submitDateJourneyResponse(session, reply);
  session = recordDateJourneyObservation(session, "uncertain");
  assert.equal(session.decision, "DE_ESCALATE");
  assert.equal(session.history.length, 2);
  assert.equal(session.history[1].kind, "followup");
  assert.deepEqual(advanceDateJourney(session), session);
});

test("an explicit new mutual observation can progress while retaining the original uncertainty", () => {
  let session = beginDateJourneyFollowup(recordDateJourneyObservation(answered(), "uncertain"));
  session = recordDateJourneyObservation(submitDateJourneyResponse(session, reply), "positive");
  assert.deepEqual(session.history.map((item) => item.branch), ["uncertain", "positive"]);
  assert.equal(advanceDateJourney(session).stageIndex, 1);
});

test("explicit rejection stops every stage and cannot be changed by improved wording", () => {
  let session = createDateJourney();
  for (let index = 0; index < DATE_JOURNEY_STAGES.length; index += 1) {
    const atStage = submitDateJourneyResponse(session, reply);
    const rejected = recordDateJourneyObservation(atStage, "declined");
    const retried = retryDateJourneyResponse(rejected, "我明白，谢谢你坦诚表达。祝你顺利，我不会再邀请。");
    assert.equal(retried.status, "stopped");
    assert.equal(retried.decision, "EXIT");
    assert.equal(retried.stopReason, "declined");
    assert.equal(retried.stageIndex, index);
    assert.deepEqual(retried.history, rejected.history);
    assert.deepEqual(advanceDateJourney(retried), retried);
    assert.deepEqual(beginDateJourneyFollowup(retried), retried);
    assert.deepEqual(recordDateJourneyObservation(retried, "positive"), retried);
    assert.match(getDateJourneyScene(retried).task, /不追加邀约/);
    session = advanceDateJourney(recordDateJourneyObservation(atStage, "positive"));
  }
});

test("incompatibility and the learner's own choice are valid terminal outcomes", () => {
  const incompatible = recordDateJourneyObservation(answered(), "incompatible");
  assert.equal(incompatible.decision, "EXIT");
  assert.equal(incompatible.stopReason, "incompatible");
  assert.deepEqual(advanceDateJourney(incompatible), incompatible);
  const selfExit = stopDateJourney(answered());
  assert.equal(selfExit.stopReason, "self-exit");
  assert.equal(retryDateJourneyResponse(selfExit, reply).status, "stopped");
  assert.deepEqual(beginDateJourneyFollowup(selfExit), selfExit);
  assert.equal(createDateJourney().history.length, 0);
  assert.equal(selfExit.status, "stopped");
});

test("every terminal outcome presents gains and costs without scoring or blaming", () => {
  let session = createDateJourney();
  for (let index = 0; index < DATE_JOURNEY_STAGES.length; index += 1) {
    assert.equal(getDateJourneySummary(session).tradeoff, null, "ongoing stages must not reveal the ending tradeoff");
    session = advanceDateJourney(recordDateJourneyObservation(submitDateJourneyResponse(session, reply), "positive"));
  }
  const complete = getDateJourneySummary(session);
  assert.ok(complete.tradeoff.gains.length >= 2 && complete.tradeoff.costs.length >= 2);
  assert.ok(complete.tradeoff.note.some((item) => /已保留的 6 条/.test(item)));
  assert.equal(JSON.stringify(complete.tradeoff).includes("失败"), false);
  assert.equal(JSON.stringify(complete.tradeoff).includes("低分"), false);

  const outcomes = {
    declined: recordDateJourneyObservation(answered(), "declined"),
    incompatible: recordDateJourneyObservation(answered(), "incompatible"),
    "self-exit": stopDateJourney(answered())
  };
  for (const [reason, stopped] of Object.entries(outcomes)) {
    const tradeoff = getDateJourneySummary(stopped).tradeoff;
    assert.ok(tradeoff, `missing tradeoff for ${reason}`);
    assert.ok(tradeoff.gains.length >= 2 && tradeoff.costs.length >= 2, reason);
    assert.equal(JSON.stringify(tradeoff).includes("失败"), false, reason);
    assert.equal(JSON.stringify(tradeoff).includes("低分"), false, reason);
  }
  const declinedText = JSON.stringify(getDateJourneySummary(outcomes.declined).tradeoff);
  assert.match(declinedText, /清晰的答案/);
  assert.match(declinedText, /失落感是真实/);
  assert.match(JSON.stringify(getDateJourneySummary(outcomes["self-exit"]).tradeoff), /决定权/);
  const paused = recordDateJourneyObservation(answered(), "uncertain");
  assert.equal(getDateJourneySummary(paused).tradeoff, null);

  const rejectionView = buildDateJourneyHtml(outcomes.declined);
  assert.match(rejectionView, /不计分、不进错题本/);
  assert.match(rejectionView, /这条路你得到了/);
  assert.match(rejectionView, /它同时意味着放弃/);
  const branchView = buildDateJourneyHtml(answered());
  assert.match(branchView, /每条分支都是有效结局、也各有代价/);
});

test("critique precedes progression and flagged pressure cannot unlock a positive branch", () => {
  const noReply = createDateJourney();
  assert.equal(recordDateJourneyObservation(noReply, "positive").observation, null);
  const pressure = submitDateJourneyResponse(noReply, "你必须答应见我，不回我就说明你在吊着我。");
  assert.equal(pressure.lastFeedback.blocked, true);
  assert.equal(recordDateJourneyObservation(pressure, "positive").observation, null);
  assert.equal(recordDateJourneyObservation(pressure, "uncertain").observation, null);
  assert.equal(recordDateJourneyObservation(pressure, "declined").status, "stopped");
  const revised = retryDateJourneyResponse(pressure, reply);
  assert.equal(revised.lastFeedback.blocked, false);
  assert.equal(recordDateJourneyObservation(revised, "positive").observation, "positive");
});

test("safe negation is not treated as pressure and feedback stays limited", () => {
  const session = submitDateJourneyResponse(createDateJourney(), "我希望慢慢了解你，不需要马上决定关系，不用立刻回复。你愿意下周看展吗？");
  assert.equal(session.lastFeedback.blocked, false);
  assert.ok(session.lastFeedback.improvements.length <= 3);
  assert.equal("score" in session.lastFeedback, false);
  const mindReading = submitDateJourneyResponse(createDateJourney(), "你肯定喜欢我，你在考验我？");
  assert.ok(mindReading.lastFeedback.improvements.some((item) => /心理/.test(item)));
  assert.equal(mindReading.lastFeedback.blocked, true);
  assert.equal(recordDateJourneyObservation(mindReading, "positive").observation, null);
});

test("drafts never enter pure function results and operations preserve input state", () => {
  const original = createDateJourney();
  const snapshot = structuredClone(original);
  const draft = "私密练习原文 unique-draft-42：我也喜欢这次展览。";
  const first = submitDateJourneyResponse(original, draft);
  assert.deepEqual(original, snapshot);
  assert.equal(JSON.stringify(first).includes("unique-draft-42"), false);
  assert.equal(JSON.stringify(retryDateJourneyResponse(first, draft)).includes("unique-draft-42"), false);
  assert.equal(JSON.stringify(recordDateJourneyObservation(first, "positive")).includes("unique-draft-42"), false);
});

test("stored rejection evidence dominates a contradictory active status", () => {
  const rejected = recordDateJourneyObservation(answered(), "declined");
  const tampered = { ...rejected, status: "active", stopReason: null, observation: "positive", decision: "ADVANCE" };
  assert.equal(advanceDateJourney(tampered).status, "stopped");
  assert.equal(getDateJourneySummary(tampered).decision, "EXIT");
});

test("the view offers critique before branches, escapes drafts, and preserves stopping semantics", () => {
  const unstarted = buildDateJourneyHtml(createDateJourney(), '</textarea><script>alert("draft")</script>');
  assert.equal(unstarted.includes('<script>alert("draft")</script>'), false);
  assert.match(unstarted, /&lt;script&gt;/);
  assert.equal(unstarted.includes('name="dateJourneyBranch"'), false);
  const feedbackView = buildDateJourneyHtml(answered());
  assert.match(feedbackView, /name="dateJourneyBranch"/);
  const uncertainView = buildDateJourneyHtml(recordDateJourneyObservation(answered(), "uncertain"));
  assert.equal(uncertainView.includes('data-journey-action="advance"'), false);
  assert.match(uncertainView, /data-journey-action="followup"/);
  const rejectionView = buildDateJourneyHtml(recordDateJourneyObservation(answered(), "declined"));
  assert.equal(rejectionView.includes('data-journey-action="advance"'), false);
  assert.equal(rejectionView.includes('data-journey-action="followup"'), false);
  assert.equal(rejectionView.includes('name="dateJourneyBranch"'), false);
  assert.match(rejectionView, /练习体面收尾/);
});

// 最小 DOM 事件适配器：验证真正的 renderer 事件路径，而非只检查静态模板。
class EventPanel {
  get innerHTML() { return this.html; }
  set innerHTML(html) {
    this.html = html;
    this.draftInput = html.includes('id="dateJourneyDraft"') ? this.element() : null;
    this.scenarioSelect = this.element();
    this.feedbackStatus = html.includes('id="dateJourneyReviewStatus"') ? this.element() : null;
    this.noticeNode = this.element();
    this.branches = [...html.matchAll(/name="dateJourneyBranch" value="([^"]+)"/g)].map((match) => this.element({ value: match[1] }));
    this.actions = [...html.matchAll(/data-journey-action="([^"]+)"/g)].map((match) => this.element({ dataset: { journeyAction: match[1] } }));
  }
  element(extra = {}) {
    return { ...extra, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
  }
  querySelector(selector) {
    if (selector === "#dateJourneyDraft") return this.draftInput;
    if (selector === "#dateJourneyScenario") return this.scenarioSelect;
    if (selector === "#dateJourneyReviewStatus") return this.feedbackStatus;
    if (selector === "#dateJourneyNotice") return this.noticeNode;
    const actionMatch = selector.match(/^button\[data-journey-action="([^"]+)"\]$/);
    if (actionMatch) return this.actions.find((item) => item.dataset.journeyAction === actionMatch[1]);
    return null;
  }
  querySelectorAll(selector) { return selector.startsWith("input") ? this.branches : this.actions; }
  write(value) { this.draftInput.listeners.input({ target: { value } }); }
  selectScenario(value) { this.scenarioSelect.listeners.change({ target: { value } }); }
  choose(value) {
    const input = this.branches.find((item) => item.value === value);
    assert.ok(input, `missing simulated branch: ${value}`);
    input.listeners.change({ target: { value } });
  }
  click(action) {
    const button = this.actions.find((item) => item.dataset.journeyAction === action);
    assert.ok(button, `missing journey action: ${action}`);
    button.listeners.click();
  }
}

test("renderer preserves drafts across app rerenders and its event path never writes storage", () => {
  const priorStorage = globalThis.localStorage;
  const priorFetch = globalThis.fetch;
  globalThis.localStorage = { getItem() { assert.fail("journey must not read persisted private data"); }, setItem() { assert.fail("journey must not persist drafts"); } };
  globalThis.fetch = () => { assert.fail("journey must remain local"); };
  try {
    resetDateJourney();
    const panel = new EventPanel();
    renderDateJourney(panel);
    panel.write(reply);
    renderDateJourney(panel);
    assert.ok(panel.innerHTML.includes(reply));
    panel.click("critique");
    assert.equal(panel.branches.length, 4);
    panel.choose("uncertain");
    panel.click("observe");
    assert.match(panel.innerHTML, /证据仍模糊/);
    assert.equal(panel.actions.some((item) => item.dataset.journeyAction === "advance"), false);
    panel.write("我理解，先给彼此空间，之后再说。");
    panel.click("critique");
    assert.match(panel.innerHTML, /原有观察、阶段和决策保持不变/);
    assert.equal(panel.branches.length, 0);
    panel.click("followup");
    panel.write(reply);
    panel.click("critique");
    panel.choose("declined");
    panel.click("observe");
    assert.match(panel.innerHTML, /停止本次探索/);
    assert.match(panel.innerHTML, /练习体面收尾/);
    panel.write("我尊重你的决定，谢谢你的坦诚，我不再邀请。");
    panel.click("critique");
    assert.equal(panel.branches.length, 0);
    assert.equal(panel.actions.some((item) => ["advance", "followup"].includes(item.dataset.journeyAction)), false);
    assert.match(panel.innerHTML, /已保留 2 条模拟观察/);
    panel.click("restart");
    assert.equal(panel.innerHTML.includes("我尊重你的决定"), false);
    assert.equal(panel.branches.length, 0);
  } finally {
    if (priorStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorStorage;
    globalThis.fetch = priorFetch;
  }
});

test("all three adult scenarios retain six-stage continuity and the same consent gates", () => {
  const replies = {
    gallery: reply,
    sport: "我也觉得那个打偏的球很好笑，和大家练球很开心。你愿意周六参加球场活动吗？不方便也没关系。",
    friends: "我也喜欢刚才桌游那一局的反转，聊这些很开心。你愿意周六去桌游咖啡店吗？不方便也没关系。"
  };
  assert.equal(DATE_JOURNEY_SCENARIOS.length, 3);
  for (const { id } of DATE_JOURNEY_SCENARIOS) {
    let session = createDateJourney(id);
    assert.match(getDateJourneyScene(session).context, /成年人/);
    for (let stage = 0; stage < 6; stage += 1) {
      const scene = getDateJourneyScene(session);
      assert.equal(scene.id, DATE_JOURNEY_STAGES[stage]);
      assert.equal(scene.scenarioId, id);
      if (stage) assert.equal(scene.previousEvidence, getDateJourneyScene({ scenarioId: id, stageIndex: stage - 1 }).responses[0].observation);
      const reviewed = submitDateJourneyResponse(session, replies[id]);
      const paused = recordDateJourneyObservation(reviewed, "uncertain");
      assert.equal(paused.stageIndex, stage);
      assert.equal(getDateJourneySummary(paused).canAdvance, false);
      for (const branch of ["declined", "incompatible"]) {
        const stopped = recordDateJourneyObservation(reviewed, branch);
        assert.equal(stopped.decision, "EXIT");
        assert.equal(advanceDateJourney(stopped).stageIndex, stage);
        assert.equal(beginDateJourneyFollowup(stopped).status, "stopped");
      }
      session = advanceDateJourney(recordDateJourneyObservation(reviewed, "positive"));
      assert.equal(session.scenarioId, id);
    }
    assert.equal(session.status, "complete");
    const observations = getDateJourneySummary(session).observations;
    assert.equal(observations.length, 6);
    assert.ok(observations.every((item) => item.observation));
    if (id !== "gallery") assert.ok(observations.every((item) => !/展览|看展/.test(item.observation)));
  }
});

test("known privacy threats, coercion and harassment block advancement, including after a benign prefix", () => {
  const riskReplies = [
    "你今晚必须出来见我，不然我就公开你的聊天记录。",
    "把你的聊天截图发给同事，让他们知道你怎么对我。",
    "你不答应我就去你家堵你。",
    "我会一直给你打电话直到你答应。",
    "我不会骚扰你，但不见我就公开你的私密照片。"
  ];
  for (const scenario of DATE_JOURNEY_SCENARIOS) {
    for (const text of riskReplies) {
      const reviewed = submitDateJourneyResponse(createDateJourney(scenario.id), text);
      assert.equal(reviewed.lastFeedback.blocked, true, text);
      assert.equal(recordDateJourneyObservation(reviewed, "positive").observation, null);
      assert.equal(recordDateJourneyObservation(reviewed, "uncertain").observation, null);
      assert.equal(recordDateJourneyObservation(reviewed, "declined").status, "stopped");
    }
  }
  const safe = submitDateJourneyResponse(createDateJourney(), "我不会公开你的聊天记录，也不会骚扰你。我尊重你的选择，不用立刻回复。");
  assert.equal(safe.lastFeedback.blocked, false);
});

test("invalidated feedback cannot record a positive outcome until the draft is reviewed again", () => {
  const reviewed = answered();
  const stale = invalidateDateJourneyResponse(reviewed);
  assert.equal(stale.lastFeedback.current, false);
  assert.equal(recordDateJourneyObservation(stale, "positive").observation, null);
  assert.equal(recordDateJourneyObservation(stale, "uncertain").observation, null);
  assert.equal(recordDateJourneyObservation(stale, "declined").status, "stopped");
  const renewed = retryDateJourneyResponse(stale, reply);
  assert.equal(renewed.lastFeedback.current, true);
  assert.equal(recordDateJourneyObservation(renewed, "positive").observation, "positive");
  assert.equal(reviewed.lastFeedback.current, true);
});

test("the view retains concrete current evidence and self-exit never invents a rejection", () => {
  const uncertain = recordDateJourneyObservation(answered(), "uncertain");
  const observation = getDateJourneyScene(uncertain).responses.find((item) => item.branch === "uncertain").observation;
  assert.equal(getDateJourneyScene(uncertain).currentEvidence, observation);
  assert.equal(getDateJourneySummary(uncertain).observations[0].observation, observation);
  assert.ok(buildDateJourneyHtml(uncertain).includes(observation));
  const selfExitScene = getDateJourneyScene(stopDateJourney(createDateJourney()));
  assert.match(selfExitScene.counterEvidence, /自己的退出决定/);
  assert.equal(selfExitScene.counterEvidence.includes("明确拒绝或无法协调的分歧已经阻止推进"), false);
});

test("retry compares positive expression features without upgrading decisions or giving scores", () => {
  const first = submitDateJourneyResponse(createDateJourney(), "你好。");
  const before = structuredClone(first);
  const improved = retryDateJourneyResponse(first, reply);
  assert.match(improved.lastFeedback.comparison, /新增了/);
  assert.match(improved.lastFeedback.comparison, /具体情境回应/);
  assert.match(improved.lastFeedback.comparison, /自我表达/);
  assert.match(improved.lastFeedback.comparison, /选择空间/);
  assert.equal(improved.decision, first.decision);
  assert.equal(improved.observation, null);
  assert.equal("score" in improved.lastFeedback, false);
  assert.deepEqual(first, before);
  const unchanged = retryDateJourneyResponse(improved, reply);
  assert.match(unchanged.lastFeedback.comparison, /没有检测到新增/);
});

test("renderer invalidates old review on editing and stale event handlers cannot unlock progression", () => {
  resetDateJourney();
  const panel = new EventPanel();
  renderDateJourney(panel);
  panel.write(reply);
  panel.click("critique");
  panel.choose("positive");
  const oldObserve = panel.actions.find((item) => item.dataset.journeyAction === "observe");
  const draftNode = panel.draftInput;
  panel.write("你必须答应见我，不回我就说明你在吊着我。");
  assert.equal(panel.draftInput, draftNode, "editing must preserve the input element and caret");
  assert.equal(oldObserve.disabled, true);
  assert.ok(panel.branches.every((item) => item.disabled && !item.checked));
  assert.match(panel.feedbackStatus.textContent, /反馈已失效/);
  // 即使旧回调被程序触发，也必须通过版本检查，不能沿用先前安全反馈。
  oldObserve.listeners.click();
  assert.equal(panel.actions.some((item) => item.dataset.journeyAction === "advance"), false);
  assert.equal(panel.branches.length, 0);
  assert.match(panel.innerHTML, /旧反馈不能确认推进/);
  panel.click("critique");
  panel.choose("positive");
  panel.click("observe");
  assert.equal(panel.actions.some((item) => item.dataset.journeyAction === "advance"), false);
  assert.match(panel.innerHTML, /风险措辞或读心定论/);
  panel.write(reply);
  panel.click("critique");
  panel.choose("positive");
  panel.click("observe");
  assert.equal(panel.actions.some((item) => item.dataset.journeyAction === "advance"), true);
});

test("scenario changes and the exported global-reset hook clear all temporary data", () => {
  resetDateJourney();
  const panel = new EventPanel();
  renderDateJourney(panel);
  panel.write(reply);
  panel.click("critique");
  panel.choose("positive");
  panel.click("observe");
  panel.click("advance");
  panel.write("临时练习草稿-do-not-retain");
  panel.selectScenario("sport");
  assert.match(panel.innerHTML, /1 \/ 6/);
  assert.match(panel.innerHTML, /公开的羽毛球兴趣活动/);
  assert.equal(panel.innerHTML.includes("do-not-retain"), false);
  assert.equal(panel.branches.length, 0);
  assert.equal(panel.innerHTML.includes("已保留"), false);
  panel.write("我也觉得练球很开心，你愿意周六一起参加球场活动吗？");
  panel.click("critique");
  panel.choose("positive");
  panel.click("observe");
  panel.click("advance");
  panel.write("再次加入临时草稿-reset-fixture");
  resetDateJourney();
  renderDateJourney(panel);
  assert.match(panel.innerHTML, /1 \/ 6/);
  assert.match(panel.innerHTML, /公开的城市速写活动/);
  assert.equal(panel.innerHTML.includes("reset-fixture"), false);
  assert.equal(panel.innerHTML.includes("已保留"), false);
  assert.equal(panel.branches.length, 0);
  panel.selectScenario("friends");
  assert.match(panel.innerHTML, /共同朋友的聚会/);
  assert.equal(panel.branches.length, 0);
});

test("risky or edited retries after a committed positive outcome also require review before advancement", () => {
  const observed = recordDateJourneyObservation(answered(), "positive");
  const invalidated = invalidateDateJourneyResponse(observed);
  assert.equal(getDateJourneySummary(invalidated).canAdvance, false);
  assert.equal(advanceDateJourney(invalidated).stageIndex, 0);
  const risky = retryDateJourneyResponse(observed, "你肯定喜欢我，你在考验我？");
  assert.equal(risky.observation, "positive", "editing cannot rewrite the recorded outcome");
  assert.equal(getDateJourneySummary(risky).canAdvance, false);
  assert.equal(advanceDateJourney(risky).stageIndex, 0);
  assert.deepEqual(risky.history, observed.history);
  const revised = retryDateJourneyResponse(risky, reply);
  assert.equal(advanceDateJourney(revised).stageIndex, 1);

  resetDateJourney();
  const panel = new EventPanel();
  renderDateJourney(panel);
  panel.write(reply);
  panel.click("critique");
  panel.choose("positive");
  panel.click("observe");
  const oldAdvance = panel.actions.find((item) => item.dataset.journeyAction === "advance");
  panel.write("你肯定喜欢我，你在考验我？");
  assert.equal(oldAdvance.disabled, true);
  oldAdvance.listeners.click();
  assert.match(panel.innerHTML, /1 \/ 6/);
  assert.ok(panel.innerHTML.includes("你肯定喜欢我"), "a blocked stale callback must retain the draft for retry");
  panel.click("critique");
  assert.equal(panel.actions.some((item) => item.dataset.journeyAction === "advance"), false);
  panel.write(reply);
  panel.click("critique");
  panel.click("advance");
  assert.match(panel.innerHTML, /2 \/ 6/);
});

test("clear protective boundaries are not mislabeled as the learner threatening or harassing", () => {
  const stopped = stopDateJourney(createDateJourney());
  for (const text of ["我不接受你的威胁。我决定到这里，停止联系。", "请别跟踪我，也别骚扰我。我不继续这段关系。", "不要公开我的聊天记录。我到这里，不再约你。"] ) {
    const feedback = retryDateJourneyResponse(stopped, text).lastFeedback;
    assert.equal(feedback.blocked, false, text);
    assert.ok(feedback.features.includes("closure"));
  }
});
