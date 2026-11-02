(function () {
  'use strict';

  var HIDE_KEY = 'heartflow.pet.hidden';
  var POS_KEY = 'heartflow.pet.pos';
  if (sessionStorage.getItem(HIDE_KEY) === '1') return;

  var FRAMES = {
    idle: '/pet/idle.png',
    blink: '/pet/blink.png',
    wag: '/pet/wag.png',
    sleep: '/pet/sleep.png'
  };

  var LINES = [
    '先听完对方这句话，再想怎么回应。',
    '今天练一个小动作就够了。',
    '被拒绝不等于被否定。',
    '把事实和你的解释分开写。',
    '可以说“我需要想一想”。',
    '你也有权利说“不”。',
    '关系里也需要留一点自己的空间。',
    '慢一点，不代表落后。',
    '先照顾好自己的作息。',
    '一次没做好，下次再调整。'
  ];

  var root = document.createElement('div');
  root.className = 'pet';
  root.id = 'heartflowPet';
  root.innerHTML =
    '<div class="pet-bubble" role="status" aria-live="polite"></div>' +
    '<div class="pet-stage">' +
      '<button class="pet-figure" type="button" aria-label="小满，桌面小狐狸，点一下它会说句话">' +
        '<img class="pet-img" src="' + FRAMES.idle + '" alt="" draggable="false">' +
      '</button>' +
    '</div>' +
    '<button class="pet-close" type="button" aria-label="收起桌宠">×</button>';

  var mounted = false;
  function mount() {
    if (mounted || !document.body) return;
    mounted = true;
    document.body.appendChild(root);
    preload();
    restorePos();
    bindDrag();
    startLoops();
  }

  var fig = root.querySelector('.pet-figure');
  var img = root.querySelector('.pet-img');
  var bubble = root.querySelector('.pet-bubble');
  var closeBtn = root.querySelector('.pet-close');

  var lastLine = -1;
  var bubbleTimer = 0;
  var sleepTimer = 0;
  var resetTimer = 0;
  var busyUntil = 0;
  var asleep = false;

  function preload() {
    Object.keys(FRAMES).forEach(function (k) {
      var im = new Image();
      im.src = FRAMES[k];
    });
  }

  function setFrame(name) {
    if (img.getAttribute('src') !== FRAMES[name]) img.setAttribute('src', FRAMES[name]);
  }

  function wake() {
    if (asleep) {
      asleep = false;
      setFrame('idle');
    }
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(fallAsleep, 45000);
  }

  function fallAsleep() {
    asleep = true;
    setFrame('sleep');
  }

  function say(text) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      bubble.classList.remove('show');
    }, 5200);
  }

  function react() {
    if (asleep) {
      wake();
      return;
    }
    var i = Math.floor(Math.random() * LINES.length);
    if (i === lastLine) i = (i + 1) % LINES.length;
    lastLine = i;
    setFrame('wag');
    say(LINES[i]);
    busyUntil = Date.now() + 1300;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      if (!asleep) setFrame('idle');
    }, 1300);
    wake();
  }

  function startLoops() {
    (function blinkLoop() {
      var wait = 3200 + Math.random() * 3600;
      var t = setTimeout(function () {
        if (!asleep && !dragging && Date.now() > busyUntil) {
          setFrame('blink');
          setTimeout(function () {
            if (!asleep) setFrame('idle');
          }, 170);
        }
        blinkLoop();
      }, wait);
      void t;
    })();
    wake();
  }

  /* ---------- 拖拽 ---------- */
  var dragging = null;
  var justDragged = false;

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function bindDrag() {
    fig.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var r = root.getBoundingClientRect();
      dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      root.style.left = r.left + 'px';
      root.style.top = r.top + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      try { fig.setPointerCapture(e.pointerId); } catch (err) {}
    });

    fig.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== dragging.id) return;
      var dx = e.clientX - dragging.x;
      var dy = e.clientY - dragging.y;
      if (!dragging.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragging.moved = true;
        root.classList.add('dragging');
        wake();
      }
      if (!dragging.moved) return;
      root.style.left = clamp(dragging.left + dx, 4, window.innerWidth - root.offsetWidth - 4) + 'px';
      root.style.top = clamp(dragging.top + dy, 4, window.innerHeight - root.offsetHeight - 4) + 'px';
    });

    function endDrag(e) {
      if (!dragging || e.pointerId !== dragging.id) return;
      var moved = dragging.moved;
      try { fig.releasePointerCapture(dragging.id); } catch (err) {}
      dragging = null;
      root.classList.remove('dragging');
      if (moved) {
        justDragged = true;
        savePos();
      }
    }
    fig.addEventListener('pointerup', endDrag);
    fig.addEventListener('pointercancel', endDrag);

    fig.addEventListener('click', function () {
      if (justDragged) {
        justDragged = false;
        return;
      }
      react();
    });

    closeBtn.addEventListener('click', function () {
      sessionStorage.setItem(HIDE_KEY, '1');
      root.remove();
    });

    window.addEventListener('resize', function () {
      if (!root.style.left) return;
      root.style.left = clamp(parseFloat(root.style.left), 4, window.innerWidth - root.offsetWidth - 4) + 'px';
      root.style.top = clamp(parseFloat(root.style.top), 4, window.innerHeight - root.offsetHeight - 4) + 'px';
    });
  }

  /* ---------- 位置记忆 ---------- */
  function savePos() {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        x: parseFloat(root.style.left),
        y: parseFloat(root.style.top)
      }));
    } catch (err) {}
  }

  function restorePos() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (err) {}
    if (!raw || typeof raw.x !== 'number') return;
    root.style.left = clamp(raw.x, 4, window.innerWidth - root.offsetWidth - 4) + 'px';
    root.style.top = clamp(raw.y, 4, window.innerHeight - root.offsetHeight - 4) + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
