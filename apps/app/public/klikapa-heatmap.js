((w, d) => {
  var consent = w.revklik_consent || w.klikapa_consent || {};
  if (!consent.heatmap && !consent.recording) return;

  var el = d.currentScript;
  if (!el) return;
  var SITE_ID = el.getAttribute("data-site-id");
  if (!SITE_ID) return;
  var ORIGIN = new URL(el.src).origin;
  var HM_EP = ORIGIN + "/api/track/heatmap";
  var REC_EP = ORIGIN + "/api/track/recording";
  var sid = sessionStorage.getItem("_kp_sid") || crypto.randomUUID();
  var vid = localStorage.getItem("_kp_vid") || crypto.randomUUID();

  function send(url, payload) {
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      fetch(url, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } });
    }
  }

  // ---- Click heatmap ----
  if (consent.heatmap) {
    d.addEventListener("click", (e) => {
      var sw = d.documentElement.scrollWidth || 1;
      var sh = d.documentElement.scrollHeight || 1;
      var x = Math.round((e.clientX + w.scrollX) / sw * 100);
      var y = Math.round((e.clientY + w.scrollY) / sh * 100);
      if (x < 0) x = 0; if (x > 100) x = 100;
      if (y < 0) y = 0; if (y > 100) y = 100;
      var tgt = e.target;
      var tag = tgt.tagName ? tgt.tagName.toLowerCase() : "";
      var cls = tgt.className && typeof tgt.className === "string" ? tgt.className.split(" ").filter(Boolean).slice(0, 2).join(".") : "";
      var sel = tag + (cls ? "." + cls : "");
      var txt = (tgt.textContent || "").trim().slice(0, 80);
      var vw = w.innerWidth;
      send(HM_EP, { s: SITE_ID, sid: sid, vid: vid, p: w.location.pathname, t: "click", x: x, y: y, sel: sel, txt: txt, vw: vw });
    }, true);
  }

  // ---- Scroll heatmap ----
  if (consent.heatmap) {
    var maxScroll = 0;
    var scrollSent = false;
    function trackScrollDepth() {
      var sy = w.scrollY;
      var vh = w.innerHeight;
      var dh = d.documentElement.scrollHeight;
      var depth = Math.round((sy + vh) / dh * 100);
      if (depth > maxScroll) maxScroll = depth;
    }
    var scrollT;
    w.addEventListener("scroll", () => {
      clearTimeout(scrollT);
      scrollT = setTimeout(trackScrollDepth, 400);
    }, { passive: true });

    function sendScrollDepth() {
      if (maxScroll > 0 && !scrollSent) {
        scrollSent = true;
        var vh = w.innerHeight;
        var dh = d.documentElement.scrollHeight;
        send(HM_EP, { s: SITE_ID, sid: sid, vid: vid, p: w.location.pathname, t: "scroll", ms: maxScroll, vh: vh, dh: dh });
      }
    }
    d.addEventListener("visibilitychange", () => { if (d.hidden) sendScrollDepth(); });
    w.addEventListener("beforeunload", sendScrollDepth);
  }

  // ---- Session recording ----
  if (consent.recording) {
    var events = [];
    var startTime = Date.now();
    var totalSize = 0;
    var seq = 0;
    var MAX_SIZE = 51200;

    function addEvent(type, data) {
      var ev = { t: Date.now() - startTime, type: type, d: data };
      events.push(ev);
      totalSize += JSON.stringify(ev).length;
      if (events.length >= 100 || totalSize >= MAX_SIZE) flushRecording();
    }

    function flushRecording() {
      if (!events.length) return;
      var chunk = events.splice(0);
      seq++;
      send(REC_EP, { s: SITE_ID, sid: sid, vid: vid, p: w.location.pathname, chunk: chunk, seq: seq, vw: w.innerWidth, vh: w.innerHeight });
    }

    // Click events
    d.addEventListener("click", (e) => {
      addEvent("c", { x: e.clientX, y: e.clientY, tg: e.target.tagName ? e.target.tagName.toLowerCase() : "" });
    }, true);

    // Scroll events
    var recScrollT;
    w.addEventListener("scroll", () => {
      clearTimeout(recScrollT);
      recScrollT = setTimeout(() => {
        addEvent("s", { y: w.scrollY, x: w.scrollX });
      }, 300);
    }, { passive: true });

    // Resize events
    var recResizeT;
    w.addEventListener("resize", () => {
      clearTimeout(recResizeT);
      recResizeT = setTimeout(() => {
        addEvent("r", { w: w.innerWidth, h: w.innerHeight });
      }, 300);
    });

    // DOM mutations
    var observer = new MutationObserver((mutations) => {
      var changes = [];
      for (var i = 0; i < mutations.length && changes.length < 5; i++) {
        var m = mutations[i];
        if (m.type === "childList" && m.addedNodes.length > 0) {
          var node = m.addedNodes[0];
          if (node.nodeType === 1) {
            var tn = node.tagName ? node.tagName.toLowerCase() : "";
            if (tn !== "script" && tn !== "style") {
              changes.push({ tp: "add", tn: tn, px: m.target.nodeName ? m.target.nodeName.toLowerCase() : "" });
            }
          }
        } else if (m.type === "attributes") {
          var attrName = m.attributeName || "";
          if (attrName !== "style" && attrName.indexOf("data-") !== 0) {
            changes.push({ tp: "attr", tn: m.target.tagName ? m.target.tagName.toLowerCase() : "", an: attrName });
          }
        }
      }
      if (changes.length > 0) addEvent("m", { changes: changes });
    });
    observer.observe(d.body || d.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "src", "href"] });

    // Flush every 5 seconds
    setInterval(flushRecording, 5000);

    // Flush on unload
    w.addEventListener("beforeunload", flushRecording);
    d.addEventListener("visibilitychange", () => { if (d.hidden) flushRecording(); });
  }
})(window, document);
