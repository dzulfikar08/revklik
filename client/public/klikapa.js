((w) => {
  const SITE_ID = w.klikapa_site_id;
  const ENDPOINT = w.klikapa_endpoint || "/api/track";

  let sid = sessionStorage.getItem("_kp_sid");
  let vid = localStorage.getItem("_kp_vid");

  if (!sid) { sid = crypto.randomUUID(); sessionStorage.setItem("_kp_sid", sid); }
  if (!vid) { vid = crypto.randomUUID(); localStorage.setItem("_kp_vid", vid); }

  function parseUtm() {
    const p = new URLSearchParams(w.location.search);
    return { us: p.get("utm_source"), um: p.get("utm_medium"), uc: p.get("utm_campaign"), ut: p.get("utm_term"), uco: p.get("utm_content") };
  }

  function send(payload) {
    if (navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, JSON.stringify(payload)); }
    else { fetch(ENDPOINT, { method: "POST", body: JSON.stringify(payload), keepalive: true }); }
  }

  function pageview() {
    send({ s: SITE_ID, sid, vid, t: "p", p: w.location.pathname, h: w.location.hostname, r: document.referrer || undefined, ...parseUtm() });
  }

  pageview();

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () { origPush.apply(this, arguments); pageview(); };
  history.replaceState = function () { origReplace.apply(this, arguments); pageview(); };
  w.addEventListener("popstate", pageview);

  w.klikapa = {
    pageview,
    track(name, props, revenue) { send({ s: SITE_ID, sid, vid, t: "e", n: name, p: w.location.pathname, pr: props, rv: revenue }); },
    conversion(name, revenue, props) { send({ s: SITE_ID, sid, vid, t: "c", n: name, p: w.location.pathname, rv: revenue, pr: props }); },
    identify(data) {
      fetch((ENDPOINT.replace("/track", "/identify")), {
        method: "POST", body: JSON.stringify({ s: SITE_ID, vid, ...data }),
        headers: { "Content-Type": "application/json" }, keepalive: true,
      });
    },
  };
})(window);
