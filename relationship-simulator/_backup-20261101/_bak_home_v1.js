/* ============================================================
   首页交互：能力数据回填 + 进场动效
   只读 localStorage（heartflow-state），不写任何用户数据。
   ============================================================ */
import { clampScoreOrNull } from "/modules/core/number.js";

(function () {
  "use strict";

  var STATE_KEY = "heartflow-state";

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

    var scored = 0;
    var sum = 0;
    var rows = host.querySelectorAll(".hf-dim");

    Array.prototype.forEach.call(rows, function (row) {
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
      sum += clamped;
    });

    var status = document.getElementById("hfDimsStatus");
    if (!status) return;
    if (scored === 0) {
      status.textContent = "还没有自评记录";
    } else if (scored < rows.length) {
      status.textContent = "已评估 " + scored + " / 8 项";
    } else {
      status.textContent = "八项已完成 · 综合 " + Math.round(sum / rows.length);
    }
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
