// RevKlik landing page JS.
// The site is Indonesian-only; Pakasir payment links get a fresh order_id per click.
(function () {
  'use strict';

  function k() { return window.klikapa; }

  // Nav scroll state
  var nav = document.getElementById('nav');
  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 50);
  });

  // Close mobile menu on link click
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () {
      document.querySelector('.nav-links').classList.remove('open');
    });
  });

  // Scroll reveal
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('vis'); });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
  document.querySelectorAll('.fade-up').forEach(function (el) { obs.observe(el); });

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var h = a.getAttribute('href');
      if (h === '#') return;
      e.preventDefault();
      var target = document.querySelector(h);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // CTA click tracking
  document.querySelectorAll('.nav-cta, .btn-accent, .btn-outline[href]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var section = btn.closest('[data-section]');
      if (k()) k().track('cta_click', {
        label: btn.textContent.trim().replace(/\s+/g, ' '),
        section: section ? section.dataset.section : 'unknown',
        href: btn.href || '#'
      });
    });
  });

  // Mobile menu
  var burger = document.querySelector('.burger');
  if (burger) burger.addEventListener('click', function () {
    if (k()) k().track('mobile_menu', { action: 'open' });
  });
  var navClose = document.querySelector('.nav-close');
  if (navClose) navClose.addEventListener('click', function () {
    if (k()) k().track('mobile_menu', { action: 'close' });
  });

  // Nav link clicks
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (k()) k().track('nav_click', { label: a.textContent.trim(), href: a.getAttribute('href') });
    });
  });

  // Footer link clicks
  document.querySelectorAll('.footer-links a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (k()) k().track('footer_click', { label: a.textContent.trim(), href: a.href });
    });
  });

  // Snippet copy
  document.querySelectorAll('[data-copy-snippet]').forEach(function (btn) {
    var orig = btn.textContent;
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(btn.dataset.copySnippet);
      btn.textContent = btn.dataset.copied || 'Copied!';
      if (k()) k().track('snippet_copy', { section: 'how-it-works' });
      setTimeout(function () { btn.textContent = orig; }, 2000);
    });
  });
})();
