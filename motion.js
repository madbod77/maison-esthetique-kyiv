/* Maison Esthétique — calm, progressive-enhancement motion. Load defer after app.js. */
(function () {
  'use strict';
  if (window.MaisonMotion) return;

  var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  var controls = 'a, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable="true"], [tabindex]';
  var reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };
  var desktop = window.matchMedia ? window.matchMedia('(min-width: 769px) and (pointer: fine)') : { matches: false };
  var animations = new Set();
  var styles = new Map();
  var bases = new Map();
  var seen = new WeakSet();
  var listeners = [];
  var observer = null;
  var frame = 0;
  var ready = false;
  var destroyed = false;
  var failed = false;
  var hero, photo, orbit, roomPhotos, header, progress;
  var headerHadClass = false;
  var imagePending = false;

  function clamp(value) { return Math.max(0, Math.min(1, value)); }
  function smooth(value) { return value * value * (3 - 2 * value); }
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
  function watchMedia(query, handler) {
    if (query.addEventListener) listen(query, 'change', handler);
    else if (query.addListener) {
      query.addListener(handler);
      listeners.push(function () { query.removeListener(handler); });
    }
  }
  function write(element, property, value) {
    if (!element) return;
    if (!styles.has(element)) styles.set(element, new Map());
    var record = styles.get(element);
    if (!record.has(property)) record.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  }
  function restoreProperty(element, property) {
    var record = styles.get(element);
    if (!record || !record.has(property)) return;
    var original = record.get(property);
    if (original[0]) element.style.setProperty(property, original[0], original[1]);
    else element.style.removeProperty(property);
    record.delete(property);
    if (!record.size) styles.delete(element);
  }
  function restoreAll() {
    styles.forEach(function (record, element) {
      Array.from(record.keys()).forEach(function (property) { restoreProperty(element, property); });
    });
  }
  function base(element) {
    if (!bases.has(element)) {
      var transform = getComputedStyle(element).transform;
      bases.set(element, transform === 'none' ? '' : transform + ' ');
    }
    return bases.get(element);
  }
  function cancelAnimations() {
    animations.forEach(function (animation) { animation.cancel(); });
    animations.clear();
  }
  function safeTarget(element) {
    return element && !element.matches(controls) && !element.querySelector(controls);
  }
  function inView(element) {
    var box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight * 0.95;
  }
  function animate(element, keyframes, duration, delay) {
    if (!element || reduced.matches || document.hidden || !element.animate || !inView(element)) return;
    // No hidden class, persistent fill or committed opacity: failure leaves natural CSS visible.
    try {
      var animation = element.animate(keyframes, { duration: duration, delay: delay || 0, easing: EASE, fill: 'backwards' });
      animations.add(animation);
      animation.onfinish = function () { animations.delete(animation); };
      animation.oncancel = function () { animations.delete(animation); };
    } catch (_) { /* Unsupported effect: retain visible natural state. */ }
  }
  function reveal(element, delay) {
    if (seen.has(element)) return;
    seen.add(element);
    if (!safeTarget(element)) return;
    var original = getComputedStyle(element).transform;
    var prefix = original === 'none' ? '' : original + ' ';
    if (roomPhotos && roomPhotos.indexOf(element) !== -1) {
      animate(element, [{ opacity: 0.18, translate: '0 18px' }, { opacity: 1, translate: '0 0' }], 560, delay);
      return;
    }
    animate(element, [
      { opacity: 0.18, transform: prefix + 'translate3d(0, 18px, 0)' },
      { opacity: 1, transform: original }
    ], 560, delay);
  }
  function setupReveals(playVisible) {
    if (observer) observer.disconnect();
    observer = null;
    var elements = Array.from(document.querySelectorAll('[data-reveal]'));
    if (reduced.matches || !window.IntersectionObserver) {
      elements.forEach(function (element) { seen.add(element); });
      return;
    }
    observer = new IntersectionObserver(guarded(function (entries) {
      var index = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        if (document.hidden) return;
        observer.unobserve(entry.target);
        reveal(entry.target, Math.min(index++ * 65, 195));
      });
    }), { rootMargin: '0px 0px -5% 0px', threshold: 0 });
    elements.forEach(function (element) {
      if (seen.has(element)) return;
      // Intro owns hero; never double-animate a nested or enclosing reveal target.
      if ((hero && (hero.contains(element) || element.contains(hero))) ||
          element.closest('.hero-brand, .hero-copy, .hero-orbit, .header')) {
        seen.add(element);
        return;
      }
      var box = element.getBoundingClientRect();
      if (box.bottom <= 0 || (!playVisible && box.top < window.innerHeight)) seen.add(element);
      else if (box.top < window.innerHeight * 0.95) reveal(element, 0);
      else observer.observe(element);
    });
  }
  function photoEntrance() {
    if (!hero || !photo || reduced.matches || document.hidden || !inView(hero)) return;
    if (!photo.complete || !photo.naturalWidth) { imagePending = true; return; }
    imagePending = false;
    if (safeTarget(hero)) animate(hero, [
      { clipPath: 'inset(0 0 100% 0)' },
      { clipPath: 'inset(0 0 0% 0)' }
    ], 900, 110);
    // Individual scale composes with the independent scroll transform.
    animate(photo, [{ scale: '1.055' }, { scale: '1' }], 900, 110);
  }
  function intro() {
    if (reduced.matches || document.hidden || window.scrollY > 80) return;
    Array.from(document.querySelectorAll('.hero-brand .brand-line')).forEach(function (line, index) {
      if (!safeTarget(line)) return;
      var distance = Math.min(48, window.innerHeight / 12);
      var original = getComputedStyle(line).transform;
      var prefix = original === 'none' ? '' : original + ' ';
      animate(line, [
        { transform: prefix + 'translate3d(0, ' + distance + 'px, 0)', clipPath: 'inset(0 0 100% 0)' },
        { transform: original, clipPath: 'inset(0 0 0% 0)' }
      ], 700, Math.min(index * 70, 140));
    });
    photoEntrance();
    var copy = document.querySelector('.hero-copy');
    var copyTargets = safeTarget(copy) ? [copy] : (copy ? Array.from(copy.children).filter(safeTarget) : []);
    copyTargets.forEach(function (element, index) { reveal(element, 160 + Math.min(index * 45, 90)); });
  }
  function render() {
    frame = 0;
    if (destroyed || document.hidden || reduced.matches) return;
    var y = Math.max(0, window.scrollY);
    var height = window.innerHeight;
    var travel = desktop.matches ? (window.innerWidth >= 1024 ? 24 : 12) : 0;
    // All geometry reads precede style writes; no self-running RAF loop.
    var heroBox = hero ? hero.getBoundingClientRect() : null;
    var photoHeight = photo ? photo.offsetHeight : 0;
    var rooms = (roomPhotos || []).map(function (image) {
      var container = image.closest('.maison-visual');
      return { image: image, box: (container || image).getBoundingClientRect(), imageHeight: image.offsetHeight };
    });
    var total = Math.max(0, document.documentElement.scrollHeight - height);
    var fraction = total ? clamp(y / total) : 0;
    var heroFraction = heroBox ? smooth(clamp(-heroBox.top / Math.max(1, heroBox.height))) : 0;
    if (progress) {
      write(progress, 'transform-origin', 'left center');
      write(progress, 'transform', 'scaleX(' + fraction.toFixed(5) + ')');
    }
    if (header) header.classList.toggle('motion-scrolled', headerHadClass || y > 12);
    if (photo && heroBox && photoHeight) {
      if (travel && heroBox.bottom > 0 && heroBox.top < height) {
        // Static overscan protects the crop even at maximum displacement; no layout changes.
        var scale = 1 + (travel * 2 + 2) / photoHeight;
        write(photo, 'transform', base(photo) + 'translate3d(0, ' + (-travel * heroFraction).toFixed(3) + 'px, 0) scale(' + scale.toFixed(5) + ')');
      } else restoreProperty(photo, 'transform');
    }
    if (orbit) {
      if (travel && heroBox && heroBox.bottom > 0 && heroBox.top < height) {
        write(orbit, 'transform-origin', 'center');
        write(orbit, 'transform', base(orbit) + 'rotate(' + (8 * heroFraction).toFixed(3) + 'deg)');
      } else { restoreProperty(orbit, 'transform'); restoreProperty(orbit, 'transform-origin'); }
    }
    rooms.forEach(function (entry) {
      if (travel && entry.box.bottom > 0 && entry.box.top < height) {
        var roomTravel = travel / 2;
        var p = smooth(clamp((height - entry.box.top) / (height + entry.box.height)));
        var offset = roomTravel * (1 - 2 * p);
        var scale = 1 + (roomTravel * 2 + 2) / Math.max(1, entry.imageHeight);
        write(entry.image, 'transform', base(entry.image) + 'translate3d(0, ' + offset.toFixed(3) + 'px, 0) scale(' + scale.toFixed(5) + ')');
      } else restoreProperty(entry.image, 'transform');
    });
  }
  var renderSafe = guarded(render);
  function requestRender() {
    if (!frame && ready && !destroyed && !reduced.matches && !document.hidden) frame = requestAnimationFrame(renderSafe);
  }
  function stopFrame() { if (frame) cancelAnimationFrame(frame); frame = 0; }
  function clearMotion() {
    stopFrame();
    cancelAnimations();
    restoreAll();
    bases.clear();
    imagePending = false;
    if (header && !headerHadClass) header.classList.remove('motion-scrolled');
  }
  var preferenceChanged = guarded(function () {
    clearMotion();
    // Existing content never replays merely because an accessibility preference changed.
    setupReveals(false);
    requestRender();
  });
  var visibilityChanged = guarded(function () {
    if (document.hidden) {
      stopFrame();
      animations.forEach(function (animation) { if (animation.playState === 'running') animation.pause(); });
    } else if (!reduced.matches) {
      animations.forEach(function (animation) { if (animation.playState === 'paused') animation.play(); });
      if (imagePending) photoEntrance();
      setupReveals(false);
      requestRender();
    }
  });
  function collect() {
    hero = document.querySelector('.hero-visual');
    photo = document.querySelector('.hero-visual img');
    orbit = document.querySelector('.hero-orbit');
    roomPhotos = Array.from(document.querySelectorAll('.maison-visual img'));
    header = document.querySelector('.header');
    progress = document.querySelector('.scroll-progress');
    headerHadClass = !!(header && header.classList.contains('motion-scrolled'));
    [photo, orbit].concat(roomPhotos).forEach(function (element) { if (element) base(element); });
  }
  var refresh = guarded(function () {
    if (!ready) return;
    clearMotion();
    collect();
    setupReveals(false);
    requestRender();
  });
  var replay = guarded(function () {
    if (!ready || reduced.matches || document.hidden) return false;
    clearMotion();
    seen = new WeakSet();
    setupReveals(true);
    intro();
    requestRender();
    return true;
  });
  function destroy() {
    destroyed = true;
    clearMotion();
    if (observer) observer.disconnect();
    observer = null;
    listeners.splice(0).forEach(function (remove) { remove(); });
  }
  var init = guarded(function () {
    collect();
    ready = true;
    listen(window, 'scroll', requestRender, { passive: true });
    listen(window, 'resize', requestRender, { passive: true });
    listen(document, 'visibilitychange', visibilityChanged);
    watchMedia(reduced, preferenceChanged);
    watchMedia(desktop, guarded(function () { bases.clear(); requestRender(); }));
    if (photo) listen(photo, 'load', guarded(function () { if (imagePending) photoEntrance(); requestRender(); }));
    (roomPhotos || []).forEach(function (image) { listen(image, 'load', requestRender); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!destroyed) requestRender(); });
    setupReveals(true);
    intro();
    requestRender();
  });

  window.MaisonMotion = Object.freeze({
    version: '1.0.0',
    replay: replay,
    refresh: refresh,
    destroy: destroy,
    status: function () {
      return { ready: ready, destroyed: destroyed, failed: failed, reducedMotion: reduced.matches,
        parallaxEnabled: !reduced.matches && desktop.matches, activeAnimations: animations.size,
        framePending: !!frame, hidden: document.hidden };
    }
  });
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', init, { once: true });
  else init();
}());
