/* ============================================================
   首页交互：能力数据回填 + 进场动效
   只读 localStorage（heartflow-state），不写任何用户数据。
   ============================================================ */
import { clampScoreOrNull } from "/modules/core/number.js";

(function () {
  "use strict";

  var STATE_KEY = "heartflow-state";

  /* 低分维度的解释：说行为，不打标签 */
  var DIAGNOSIS = {
    appearance: "状态在线的时候你能撑住场，但作息一乱，整个人的劲儿先垮掉。",
    voice: "写下来能想清楚，一开口语速就往上跑，后半句常被自己吃掉。",
    communication: "你能接住对方的话，但很少主动抛新的——推进的责任常落在对方身上。",
    emotion: "被冷落的时候还能撑住，但会在心里反复回放，越想越沉。",
    dating: "想法不少，落到「定哪天、去哪」这一步就停住了。",
    boundaries: "你不太想让对方扫兴，该说的「不」经常被咽回去。",
    reliability: "答应得很快，兑现时被临时的事挤掉——对方记住的是后者。",
    knowledge: "读了不少，但判断「这段关系现在在哪个阶段」还缺参照。"
  };
  var STRENGTH_DIAGNOSIS = "八项都在中位以上。接下来不是补短板，而是挑一项做到稳定——稳定比全面更难。";
  var CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八"];

  /* ---------- 能力八项：用真实自评数据回填 ---------- */
  function readAbility() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return null;
      var state = JSON.parse(raw);
      var assessment = state && state.learning && state.learning.abilityAssessment;
      if (!assessment || !Array.isArray(assessment.dimensions)) return null;
      return assessment;
    } catch (error) {
      return null;
    }
  }

  /* 未测：一张起点卡，不留一排「你什么都没做」 */
  function paintEmpty(host) {
    host.setAttribute("data-mode", "empty");

    var label = document.getElementById("hfFocusLabel");
    var name = document.getElementById("hfFocusName");
    var meter = document.getElementById("hfFocusMeter");
    var diag = document.getElementById("hfFocusDiag");
    var cta = document.getElementById("hfFocusCta");
    var rest = document.getElementById("hfRest");

    if (label) label.textContent = "起点";
    if (name) name.textContent = "八项能力，先测一遍";
    if (meter) meter.hidden = true;
    if (diag) diag.textContent = "6 分钟，24 道情境题。测完这里不会给你一个总分，而是指出：哪一项已经稳，哪一项最该先动。";
    if (cta) {
      cta.setAttribute("href", "#abilities");
      cta.setAttribute("data-view", "abilities");
      cta.innerHTML = '开始自评 <span aria-hidden="true">→</span>';
    }
    if (rest) rest.hidden = true;
  }

  /* 已测：只把最低的那一项推到台前，其余收在下面 */
  function paintFocus(host, scored, total) {
    host.setAttribute("data-mode", "rated");

    var rest = document.getElementById("hfRest");
    var restTitle = document.getElementById("hfRestTitle");
    var status = document.getElementById("hfDimsStatus");
    var label = document.getElementById("hfFocusLabel");
    var name = document.getElementById("hfFocusName");
    var meter = document.getElementById("hfFocusMeter");
    var scoreEl = document.getElementById("hfFocusScore");
    var barEl = document.getElementById("hfFocusBar");
    var diag = document.getElementById("hfFocusDiag");
    var cta = document.getElementById("hfFocusCta");

    /* 从已回填的行里挑最低分；并列时按 DOM 顺序取靠前的 */
    var rows = host.querySelectorAll(".hf-dim");
    var focus = null;
    Array.prototype.forEach.call(rows, function (row) {
      if (row.getAttribute("data-state") !== "rated" || row.hidden) return;
      if (row.getAttribute("data-focus-hidden") === "1") return;
      var score = Number(row.querySelector(".hf-dim-val").textContent);
      if (isNaN(score)) return;
      if (!focus || score < focus.score) {
        focus = { row: row, score: score, id: row.getAttribute("data-dim") };
      }
    });
    if (!focus) {
      paintEmpty(host);
      return;
    }

    var dimName = focus.row.querySelector(".hf-dim-name").textContent.trim();
    var isStrength = focus.score >= 75;

    if (label) label.textContent = isStrength ? "值得加固的一项" : "最该先练的一项";
    if (name) name.textContent = dimName;
    if (scoreEl) scoreEl.textContent = focus.score;
    if (diag) diag.textContent = isStrength ? STRENGTH_DIAGNOSIS : (DIAGNOSIS[focus.id] || "");
    if (meter) meter.hidden = false;

    /* 焦点项从下方列表里移走，避免同一项出现两次 */
    focus.row.hidden = true;
    focus.row.setAttribute("data-focus-hidden", "1");

    if (rest) rest.hidden = false;
    if (restTitle) restTitle.textContent = scored >= total ? "其余" + CN_NUM[total - 1] + "项" : "其余项目";
    if (status) {
      status.textContent = scored >= total
        ? "已评估 " + scored + " / " + total + " 项"
        : "已评估 " + scored + " / " + total + " 项 · 补齐后画像更准";
    }

    if (cta) {
      cta.setAttribute("href", "#practice");
      cta.setAttribute("data-view", "practice");
      cta.innerHTML = '去练这一项 <span aria-hidden="true">→</span>';
    }

    /* 下一帧再长出条形，让过渡可见 */
    if (barEl) {
      barEl.style.width = "0%";
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          barEl.style.width = focus.score + "%";
        });
      });
    }
  }

  function paintDimensions() {
    var host = document.getElementById("hfDims");
    if (!host) return;
    var assessment = readAbility();
    var byId = {};
    if (assessment) {
      assessment.dimensions.forEach(function (item) {
        if (item && item.id) byId[item.id] = item;
      });
    }

    var rows = host.querySelectorAll(".hf-dim");
    var scored = 0;

    Array.prototype.forEach.call(rows, function (row) {
      row.hidden = false;
      row.removeAttribute("data-focus-hidden");
      row.removeAttribute("data-state");

      var id = row.getAttribute("data-dim");
      var item = byId[id];
      var bar = row.querySelector(".hf-dim-bar i");
      var value = row.querySelector(".hf-dim-val");
      var clamped = clampScoreOrNull(item ? item.score : null);

      if (clamped === null) {
        row.setAttribute("data-state", "unrated");
        if (bar) bar.style.width = "0%";
        if (value) value.textContent = "未测";
        return;
      }

      row.setAttribute("data-state", "rated");
      if (bar) bar.style.width = clamped + "%";
      if (value) value.textContent = clamped;
      scored += 1;
    });

    if (scored === 0) {
      paintEmpty(host);
      return;
    }
    paintFocus(host, scored, rows.length);
  }

  /* ---------- 进场动效 ---------- */
  function setupReveal() {
    var targets = document.querySelectorAll(".hf-rise");
    if (!targets.length) return;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver !== "function") {
      Array.prototype.forEach.call(targets, function (el) { el.classList.add("is-in"); });
      return;
    }

    // 先标记为待进场（CSS 才会隐藏），再观察；脚本异常时元素保持可见
    Array.prototype.forEach.call(targets, function (el) { el.classList.add("is-pending"); });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove("is-pending");
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

    Array.prototype.forEach.call(targets, function (el) { observer.observe(el); });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    paintDimensions();
    setupReveal();

    // 自评完成后回到首页时重新回填
    window.addEventListener("hashchange", function () {
      if (location.hash === "" || location.hash === "#home") {
        window.setTimeout(paintDimensions, 120);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
