// RevKlik landing page JS.
// Mobile menu, snippet copy, live-frame status, and click tracking.
// Scroll reveals and the smooth-scroll handler were removed with the redesign:
// anchors scroll via CSS (scroll-behavior, honoring prefers-reduced-motion).
(function () {
  'use strict';

  function k() { return window.klikapa; }
  function track(name, props) { if (k()) k().track(name, props); }

  // Mobile menu: toggle, close on Escape / link click / resize to desktop.
  var btn = document.querySelector('.menu-btn');
  var menu = document.getElementById('site-menu');
  function setMenu(open) {
    if (!btn || !menu) return;
    menu.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  if (btn && menu) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      setMenu(open);
      track('mobile_menu', { action: open ? 'open' : 'close' });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        btn.focus();
        track('mobile_menu', { action: 'close' });
      }
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    window.matchMedia('(min-width: 900px)').addEventListener('change', function (e) {
      if (e.matches) setMenu(false);
    });
  }

  // Nav link clicks
  document.querySelectorAll('.nav-menu a.nav-link').forEach(function (a) {
    a.addEventListener('click', function () {
      track('nav_click', { label: a.textContent.trim(), href: a.getAttribute('href') });
    });
  });

  // CTA click tracking
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    el.addEventListener('click', function () {
      var section = el.closest('[data-section]');
      track('cta_click', {
        label: el.textContent.trim().replace(/\s+/g, ' '),
        section: section ? section.dataset.section : 'nav',
        href: el.href || '#'
      });
    });
  });

  // Footer link clicks
  document.querySelectorAll('.footer-links a').forEach(function (a) {
    a.addEventListener('click', function () {
      track('footer_click', { label: a.textContent.trim(), href: a.href });
    });
  });

  // Snippet copy: success relabels the button, failure shows a visible message.
  document.querySelectorAll('[data-copy-snippet]').forEach(function (copyBtn) {
    var orig = copyBtn.textContent;
    var status = copyBtn.closest('.snippet').querySelector('[data-copy-status]');
    var timer;
    function done(ok) {
      clearTimeout(timer);
      var msg = ok ? copyBtn.dataset.copied : copyBtn.dataset.failed;
      if (ok) copyBtn.textContent = msg;
      status.textContent = msg;
      status.classList.toggle('is-error', !ok);
      timer = setTimeout(function () {
        copyBtn.textContent = orig;
        status.textContent = '';
        status.classList.remove('is-error');
      }, 2500);
      if (ok) track('snippet_copy', { section: 'how-it-works' });
    }
    copyBtn.addEventListener('click', function () {
      if (!navigator.clipboard) { done(false); return; }
      navigator.clipboard.writeText(copyBtn.dataset.copySnippet).then(
        function () { done(true); },
        function () { done(false); }
      );
    });
  });

  // Live dashboard: hide the "loading" text once the iframe has loaded.
  document.querySelectorAll('.frame-body').forEach(function (body) {
    var frame = body.querySelector('iframe');
    var status = body.querySelector('[data-frame-status]');
    if (frame && status) frame.addEventListener('load', function () { status.hidden = true; });
  });
})();
