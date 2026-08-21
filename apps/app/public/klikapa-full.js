((w, d) => {
  const el = d.currentScript;
  if (!el) return;
  const SITE_ID = el.getAttribute("data-site-id");
  if (!SITE_ID) return;
  const ENDPOINT = new URL(el.src).origin + "/api/track";

  // Session & visitor
  const sid = sessionStorage.getItem("_kp_sid") || (sessionStorage.setItem("_kp_sid", crypto.randomUUID()), sessionStorage.getItem("_kp_sid"));
  let vid = localStorage.getItem("_kp_vid") || (localStorage.setItem("_kp_vid", crypto.randomUUID()), localStorage.getItem("_kp_vid"));

  // Device detection
  const ua = navigator.userAgent;
  function detectBrowser() {
    // In-app browsers must be detected before their host browsers
    if (ua.includes("Instagram")) return "Instagram";
    if (ua.includes("Threads") || ua.includes("Barcelona")) return "Threads";
    if (ua.includes("FBAN") || ua.includes("FBAV") || ua.includes("Facebook")) return "Facebook";
    if (ua.includes("LinkedInApp")) return "LinkedIn";
    if (ua.includes("Twitter") || ua.includes("X/") || /FB_IAB\/FB4A/.test(ua)) return "X (Twitter)";
    // Standard browsers
    if (ua.includes("Firefox/")) return "Firefox";
    if (ua.includes("Edg/")) return "Edge";
    if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
    if (ua.includes("Chrome/")) return "Chrome";
    if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
    return "Other";
  }
  function detectOS() {
    if (ua.includes("Windows")) return "Windows";
    if (ua.includes("Mac OS")) return "macOS";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
    if (ua.includes("Linux")) return "Linux";
    return "Other";
  }
  function detectDevice() {
    if (/iPad/i.test(ua)) return "tablet";
    if (ua.includes("Mac OS") || ua.includes("Windows") || ua.includes("Linux")) return "desktop";
    if (/Mobi|iPhone|Android.*Mobile/i.test(ua)) return "mobile";
    if (/tablet/i.test(ua)) return "tablet";
    return "desktop";
  }
  const device = { dv: detectDevice(), br: detectBrowser(), os: detectOS(), sr: `${screen.width}x${screen.height}`, ln: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "" };

  // UTM
  function parseUTM() {
    const p = new URLSearchParams(w.location.search);
    return { us: p.get("utm_source"), um: p.get("utm_medium"), uc: p.get("utm_campaign"), ut: p.get("utm_term"), uco: p.get("utm_content") };
  }

  // Queue for batching
  const queue = [];
  let flushTimer;

  function send(payload) {
    queue.push({ ...payload, s: SITE_ID, sid, vid, ts: Date.now(), ...device });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1000);
    if (queue.length >= 10) flush();
  }

  function flush() {
    if (!queue.length) return;
    var batch = queue.splice(0);
    var payload = JSON.stringify(batch);
    fetch(ENDPOINT, { method: "POST", body: payload, keepalive: true, headers: { "Content-Type": "application/json" } }).then((r) => {
      if (r.ok) r.json().then((d) => { if (d.vid && d.vid !== vid) { vid = d.vid; localStorage.setItem("_kp_vid", vid); } });
    }).catch(() => {});
  }

  // Page view
  let lastPath = "";
  function pageview() {
    const p = w.location.pathname;
    if (p === lastPath) return;
    lastPath = p;
    send({ t: "p", p, h: w.location.hostname, r: d.referrer || undefined, ...parseUTM() });
  }

  // Scroll tracking
  const scrollMilestones = {};
  function trackScroll() {
    const scrollY = w.scrollY;
    const viewH = w.innerHeight;
    const docH = d.documentElement.scrollHeight;
    const depth = Math.round(((scrollY + viewH) / docH) * 100);

    // Depth milestones: 25%, 50%, 75%, 90%
    [25, 50, 75, 90].forEach((m) => {
      if (depth >= m && !scrollMilestones[m]) {
        scrollMilestones[m] = true;
        send({ t: "e", n: "scroll", p: lastPath, pr: { depth: m } });
      }
    });

    // Named sections
    d.querySelectorAll("[data-section]").forEach((el) => {
      const name = el.getAttribute("data-section");
      if (el.getBoundingClientRect().top < viewH * 0.75 && !scrollMilestones[name]) {
        scrollMilestones[name] = true;
        send({ t: "e", n: "scroll_section", p: lastPath, pr: { section: name, depth } });
      }
    });
  }

  // data-revklik-scroll attribute tracking via IntersectionObserver
  var saEl = d.querySelector("[data-revklik-scroll]");
  if (saEl) {
    var saTh = parseFloat(saEl.getAttribute("data-revklik-scroll"));
    if (saTh > 0 && saTh <= 1) {
      var saDone = false;
      var sentinel = d.createElement("div");
      sentinel.style.cssText = "position:absolute;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden;";
      sentinel.style.top = Math.round(d.documentElement.scrollHeight * saTh) + "px";
      d.body.appendChild(sentinel);
      var saObs = new IntersectionObserver((entries) => {
        if (!saDone && entries[0] && entries[0].isIntersecting) {
          saDone = true;
          send({ t: "e", n: "scroll_depth", p: lastPath, pr: { depth: Math.round(saTh * 100) } });
          saObs.disconnect();
          sentinel.remove();
        }
      }, { threshold: 0 });
      saObs.observe(sentinel);
    }
  }

  // Click tracking
  function trackClick(e) {
    // Goal tracking via data-revklik-goal attribute
    var gEl = e.target.closest("[data-revklik-goal]");
    if (gEl) {
      var gName = gEl.getAttribute("data-revklik-goal");
      if (gName) {
        var gP = {}, gR = null;
        for (var i = 0, a = gEl.attributes; i < a.length; i++) {
          if (a[i].name.indexOf("data-revklik-goal-") === 0) {
            var k = a[i].name.slice(18);
            if (k === "value") gR = parseFloat(a[i].value) || null;
            else gP[k] = a[i].value;
          }
        }
        send({ t: "c", n: gName, p: lastPath, pr: Object.keys(gP).length ? gP : undefined, rv: gR });
      }
    }
    // General click tracking
    var target = e.target.closest("a, button, [data-track]");
    if (!target) return;
    var label = (target.textContent || "").trim().slice(0, 80) || target.getAttribute("data-track") || "";
    var href = target.href || "";
    var tag = target.tagName.toLowerCase();
    send({ t: "e", n: "click", p: lastPath, pr: { label, href: href.slice(0, 200), tag } });
  }

  // Visibility (time on page)
  let visibleSince = Date.now();
  d.addEventListener("visibilitychange", () => {
    if (d.hidden) {
      const elapsed = Math.round((Date.now() - visibleSince) / 1000);
      if (elapsed > 5) send({ t: "e", n: "heartbeat", p: lastPath, pr: { seconds: elapsed } });
    } else {
      visibleSince = Date.now();
    }
  });

  // Init
  pageview();

  // Lazy-load heatmap module if enabled
  if (el.getAttribute("data-heatmap") === "true") {
    var hm = d.createElement("script");
    hm.src = el.src.replace("klikapa.js", "klikapa-heatmap.js");
    hm.setAttribute("data-site-id", SITE_ID);
    d.head.appendChild(hm);
  }

  // SPA support
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () { flush(); origPush.apply(this, arguments); pageview(); };
  history.replaceState = function () { flush(); origReplace.apply(this, arguments); pageview(); };
  w.addEventListener("popstate", () => { flush(); pageview(); });

  // Scroll listener (throttled)
  let scrollTimer;
  w.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(trackScroll, 600); }, { passive: true });

  // Click listener
  d.addEventListener("click", trackClick);

  // Flush on unload
  w.addEventListener("beforeunload", () => {
    const elapsed = Math.round((Date.now() - visibleSince) / 1000);
    if (elapsed > 5) send({ t: "e", n: "heartbeat", p: lastPath, pr: { seconds: elapsed } });
    flush();
  });

  // Public API
  w.klikapa = {
    pageview,
    track(name, props, revenue) { send({ t: "e", n: name, p: lastPath, pr: props, rv: revenue }); },
    conversion(name, revenue, props) { send({ t: "c", n: name, p: lastPath, rv: revenue, pr: props }); },
    getSessionId() { return sid; },
    getUtmSource() { return parseUTM().us || ""; },
    getUtmMedium() { return parseUTM().um || ""; },
    getUtmCampaign() { return parseUTM().uc || ""; },
    identify(data) {
      flush();
      fetch(ENDPOINT.replace("/track", "/identify"), {
        method: "POST",
        body: JSON.stringify({ s: SITE_ID, vid, ...data }),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    },
  };
})(window, document);
