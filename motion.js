/* Maison Esthétique — motion 2.0.0. Defer after app.js; no dependency or hidden-content class. */
(function () {
  'use strict';
  if (window.MaisonMotion) return;

  var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  var controls = 'a,button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable],[tabindex]';
  var reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };
  var desktop = window.matchMedia ? window.matchMedia('(min-width: 769px) and (pointer: fine)') : { matches: false };
  var animations = new Set(), styles = new Map(), listeners = [], groups = [];
  var seen = new WeakSet(), assigned = new Set(), bases = new Map();
  var observer = null, frame = 0, ready = false, destroyed = false, failed = false;
  var playedGroups = 0, playedEffects = 0, hero, photo, orbit, rooms, progress;

  function list(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function clamp(n) { return Math.max(0, Math.min(1, n)); }
  function safeTarget(el) { return el && !el.matches(controls) && !el.querySelector(controls); }
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight * 0.94;
  }
  function guarded(fn) {
    return function () {
      if (destroyed) return;
      try { return fn.apply(null, arguments); }
      catch (_) { failed = true; destroy(); }
    };
  }
  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    listeners.push(function () { target.removeEventListener(event, handler, options); });
  }
  function watch(query, handler) {
    if (query.addEventListener) listen(query, 'change', handler);
    else if (query.addListener) {
      query.addListener(handler);
      listeners.push(function () { query.removeListener(handler); });
    }
  }
  function write(el, property, value) {
    if (!el) return;
    if (!styles.has(el)) styles.set(el, new Map());
    var record = styles.get(el);
    if (!record.has(property)) record.set(property, [el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]);
    if (el.style.getPropertyValue(property) !== value) el.style.setProperty(property, value);
  }
  function restore(el, property) {
    var record = styles.get(el);
    if (!record || !record.has(property)) return;
    var previous = record.get(property);
    if (previous[0]) el.style.setProperty(property, previous[0], previous[1]);
    else el.style.removeProperty(property);
    record.delete(property);
    if (!record.size) styles.delete(el);
  }
  function base(el) {
    if (!bases.has(el)) {
      var value = getComputedStyle(el).transform;
      bases.set(el, value === 'none' ? '' : value + ' ');
    }
    return bases.get(el);
  }
  function cancelEffects(allWAAPI) {
    // Include the existing app's service-photo swap on a live accessibility toggle.
    if (allWAAPI && document.getAnimations) document.getAnimations().forEach(function (a) {
      if (!a.animationName && !a.transitionProperty) a.cancel();
    });
    animations.forEach(function (a) { a.cancel(); });
    animations.clear();
  }
  function clearMotion(allWAAPI) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    cancelEffects(allWAAPI);
    styles.forEach(function (record, el) {
      Array.from(record.keys()).forEach(function (property) { restore(el, property); });
    });
    bases.clear();
  }
  function play(el, kind, duration, delay) {
    if (!safeTarget(el) || !el.animate || reduced.matches || document.hidden || !inView(el)) return;
    var distance = window.innerWidth <= 760 ? 16 : 24;
    // Individual transform properties compose with existing image hover/parallax transforms.
    var keyframes = kind === 'media' ? [
      { opacity: 0.5, scale: '1.045', translate: '0 8px' },
      { opacity: 1, scale: '1', translate: '0 0' }
    ] : kind === 'ornament' ? [
      { opacity: 0.5, rotate: '-7deg', scale: '0.96' },
      { opacity: 1, rotate: '0deg', scale: '1' }
    ] : [
      { opacity: 0.22, translate: '0 ' + distance + 'px' },
      { opacity: 1, translate: '0 0' }
    ];
    try {
      var a = el.animate(keyframes, { duration: duration, delay: delay || 0, easing: EASE, fill: 'backwards' });
      animations.add(a);
      playedEffects++;
      a.onfinish = a.oncancel = function () { animations.delete(a); };
    } catch (_) { /* Unsupported WAAPI leaves the natural CSS state visible. */ }
  }
  function addGroup(root, targets, kind, duration, introDelay) {
    if (!root) return;
    targets = targets.filter(function (el) {
      if (!safeTarget(el) || assigned.has(el)) return false;
      // Never animate both a parent and its child.
      if (Array.from(assigned).some(function (other) { return other.contains(el) || el.contains(other); })) return false;
      assigned.add(el);
      return true;
    });
    if (targets.length) groups.push({ root: root, targets: targets, kind: kind || 'text', duration: duration || 480, introDelay: introDelay });
  }
  function collect() {
    hero = document.querySelector('.hero-visual');
    photo = hero && hero.querySelector('img');
    orbit = document.querySelector('.hero-orbit');
    rooms = list('.maison-visual img');
    progress = document.querySelector('.scroll-progress');
    groups = []; assigned.clear();
    // Intro: brand → headline → photograph → small supporting details. CTAs stay in place.
    list('.hero-brand .brand-line').forEach(function (el) { addGroup(el, [el], 'text', 800, 0); });
    list('.brand-subtitle').forEach(function (el) { addGroup(el, [el], 'text', 480, 80); });
    list('.hero-copy > .eyebrow').forEach(function (el) { addGroup(el, [el], 'text', 480, 100); });
    list('.hero-copy h1').forEach(function (el) { addGroup(el, [el], 'text', 680, 150); });
    list('.hero-description').forEach(function (el) { addGroup(el, [el], 'text', 560, 230); });
    addGroup(hero, photo ? [photo] : [], 'media', 900, 160);
    if (orbit) addGroup(orbit, [orbit], 'ornament', 800, 210);
    list('.hero-stamp').forEach(function (el) { addGroup(el, [el], 'ornament', 600, 280); });
    list('.hero-offer .offer-mark, .hero-offer p').forEach(function (el) { addGroup(el, [el], 'text', 480, 300); });

    list('[data-reveal]').forEach(function (el) {
      if (el.closest('.hero')) return;
      if (el.matches('figure')) addGroup(el, list('img,figcaption', el), 'media', 720);
      else if (safeTarget(el)) addGroup(el, [el]);
      else Array.from(el.children).filter(safeTarget).forEach(function (child) { addGroup(child, [child]); });
    });
    list('.section-heading .eyebrow, .intro > .eyebrow, .intro-star, .maison-copy > p, .maison-facts, .maison-word, .faq-copy > p, .contact-top .eyebrow, .footer-brand').forEach(function (el) {
      addGroup(el, [el], el.matches('.intro-star') ? 'ornament' : 'text', el.matches('.footer-brand,.maison-word') ? 680 : 480);
    });
    list('.heading-note').forEach(function (el) { addGroup(el, safeTarget(el) ? [el] : Array.from(el.children).filter(safeTarget)); });
    list('.service-visual').forEach(function (el) { addGroup(el, list('img,figcaption', el), 'media', 720); });
    list('.direction-item').forEach(function (el) { addGroup(el, list('.direction-no,.direction-name', el), 'text', 420); });
    list('.team-member').forEach(function (el) {
      Array.from(el.children).filter(safeTarget).forEach(function (child) { addGroup(child, [child], 'text', 520); });
    });
    list('.instagram-grid figure').forEach(function (el) { addGroup(el, list('img,figcaption', el), 'media', 720); });
    list('.review-track figure').forEach(function (el) { addGroup(el, list('img', el), 'text', 520); });
    list('.contact-grid > div').forEach(function (el) {
      Array.from(el.children).filter(safeTarget).forEach(function (child) { addGroup(child, [child]); });
    });
  }
  function reveal(group, delay) {
    if (seen.has(group.root)) return;
    seen.add(group.root);
    playedGroups++;
    group.targets.forEach(function (el, index) {
      var kind = el.matches('figcaption') ? 'text' : group.kind;
      play(el, kind, kind === 'text' && group.kind === 'media' ? 480 : group.duration,
        Math.min(320, (delay || 0) + index * 45));
    });
  }
  function setupReveals(playVisible) {
    if (observer) observer.disconnect();
    observer = null;
    if (!window.IntersectionObserver) {
      groups.forEach(function (g) { seen.add(g.root); });
      return;
    }
    if (reduced.matches) {
      // Keep unseen sections eligible if motion is enabled later; never replay current content.
      groups.forEach(function (g) { if (inView(g.root) || g.root.getBoundingClientRect().bottom <= 0) seen.add(g.root); });
      return;
    }
    observer = new IntersectionObserver(guarded(function (entries) {
      var index = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || document.hidden) return;
        observer.unobserve(entry.target);
        var group = groups.find(function (g) { return g.root === entry.target; });
        if (group) reveal(group, Math.min(index++ * 55, 165));
      });
    }), { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    groups.forEach(function (group) {
      if (seen.has(group.root)) return;
      var r = group.root.getBoundingClientRect();
      if (r.bottom <= 0 || (!playVisible && inView(group.root))) seen.add(group.root);
      else if (playVisible && inView(group.root)) reveal(group, window.scrollY < 80 ? group.introDelay || 0 : 0);
      else observer.observe(group.root);
    });
  }
  function render() {
    frame = 0;
    if (destroyed || reduced.matches || document.hidden) return;
    var height = window.innerHeight, y = Math.max(0, window.scrollY);
    var travel = desktop.matches ? (window.innerWidth >= 1024 ? 20 : 10) : 0;
    // Read geometry first. The scroll path writes only composited transforms.
    var box = hero && hero.getBoundingClientRect(), photoHeight = photo && photo.offsetHeight;
    var measurements = rooms.map(function (el) {
      return { el: el, r: el.closest('.maison-visual').getBoundingClientRect(), height: el.offsetHeight };
    });
    var total = Math.max(1, document.documentElement.scrollHeight - height);
    if (progress) write(progress, 'transform', 'scaleX(' + clamp(y / total).toFixed(5) + ')');
    if (photo && box && photoHeight && travel && box.bottom > 0 && box.top < height) {
      var p = clamp(-box.top / Math.max(1, box.height));
      var scale = 1 + (travel * 2 + 2) / photoHeight;
      write(photo, 'transform', base(photo) + 'translate3d(0,' + (-travel * p).toFixed(3) + 'px,0) scale(' + scale.toFixed(5) + ')');
    } else if (photo) restore(photo, 'transform');
    measurements.forEach(function (entry) {
      if (travel && entry.r.bottom > 0 && entry.r.top < height) {
        var p = clamp((height - entry.r.top) / (height + entry.r.height));
        var roomTravel = travel / 2;
        write(entry.el, 'transform', base(entry.el) + 'translate3d(0,' + (roomTravel * (1 - 2 * p)).toFixed(3) + 'px,0) scale(' + (1 + (roomTravel * 2 + 2) / Math.max(1, entry.height)).toFixed(5) + ')');
      } else restore(entry.el, 'transform');
    });
  }
  var renderSafe = guarded(render);
  function requestRender() {
    if (!frame && ready && !destroyed && !reduced.matches && !document.hidden) frame = requestAnimationFrame(renderSafe);
  }
  var preferenceChanged = guarded(function () {
    clearMotion(reduced.matches);
    setupReveals(false);
    requestRender();
  });
  var stopForControl = guarded(function (event) {
    var control = event.target.closest && event.target.closest(controls);
    if (!control) return;
    animations.forEach(function (a) {
      if (a.effect && control.contains(a.effect.target)) a.cancel();
    });
  });
  var refresh = guarded(function () {
    if (!ready) return;
    clearMotion(); collect(); setupReveals(false); requestRender();
  });
  var replay = guarded(function () {
    if (!ready || reduced.matches || document.hidden) return false;
    clearMotion(); seen = new WeakSet(); setupReveals(true); requestRender();
    return true;
  });
  function destroy() {
    destroyed = true; clearMotion();
    if (observer) observer.disconnect();
    observer = null;
    listeners.splice(0).forEach(function (remove) { remove(); });
  }
  var init = guarded(function () {
    collect(); ready = true;
    listen(window, 'scroll', requestRender, { passive: true });
    listen(window, 'resize', requestRender, { passive: true });
    listen(document, 'focusin', stopForControl);
    listen(document, 'pointerdown', stopForControl, { passive: true });
    listen(document, 'visibilitychange', guarded(function () {
      if (document.hidden) clearMotion();
      else { setupReveals(false); requestRender(); }
    }));
    watch(reduced, preferenceChanged);
    watch(desktop, guarded(function () { clearMotion(); requestRender(); }));
    list('.hero-visual img,.maison-visual img').forEach(function (el) { listen(el, 'load', requestRender); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!destroyed) requestRender(); });
    setupReveals(true); requestRender();
  });
  window.MaisonMotion = Object.freeze({
    version: '2.0.0', replay: replay, refresh: refresh, destroy: destroy,
    status: function () {
      return { ready: ready, destroyed: destroyed, failed: failed, reducedMotion: reduced.matches,
        parallaxEnabled: !destroyed && !reduced.matches && desktop.matches,
        activeAnimations: animations.size, framePending: !!frame, hidden: document.hidden,
        revealGroups: groups.length, playedGroups: playedGroups, playedEffects: playedEffects };
    }
  });
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', init, { once: true });
  else init();
}());
