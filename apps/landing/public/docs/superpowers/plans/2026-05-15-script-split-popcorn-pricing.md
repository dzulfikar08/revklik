# Script Split + Popcorn Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split klikapa.js into a <1KB core bundle and a full bundle, and redesign pricing to 3 tiers with overage billing.

**Architecture:** Two static JS files served from `client/public/`. A server endpoint at `GET /klikapa.js` checks the requesting site's plan tier and returns the appropriate bundle. Landing page gets 3 pricing cards, updated calculator, and new i18n strings.

**Tech Stack:** Hono (Cloudflare Workers), vanilla JS, static HTML with i18n

---

## Task 1: Create Core klikapa.js Bundle

**Files:**
- Create: `klikapa/client/public/klikapa-core.js`

This is the <1KB gzipped bundle for Micro and Starter tiers.

- [ ] **Step 1: Write the core tracking script**

```js
((w,d)=>{const el=d.currentScript;if(!el)return;const SID=el.getAttribute("data-site-id");if(!SID)return;const EP=new URL(el.src).origin+"/api/track";let sid=sessionStorage.getItem("_kp_sid");if(!sid){sid=crypto.randomUUID();sessionStorage.setItem("_kp_sid",sid)}let vid=localStorage.getItem("_kp_vid");if(!vid){vid=crypto.randomUUID();localStorage.setItem("_kp_vid",vid)}const ua=navigator.userAgent;const dv=/Mobi|iPhone|Android.*Mobile/i.test(ua)?"mobile":/iPad/i.test(ua)?"tablet":"desktop";function utm(){const p=new URLSearchParams(w.location.search);return{us:p.get("utm_source"),um:p.get("utm_medium"),uc:p.get("utm_campaign"),ut:p.get("utm_term"),uco:p.get("utm_content")}}const q=[];let ft;function send(o){q.push({...o,s:SID,sid,vid,ts:Date.now(),dv});clearTimeout(ft);ft=setTimeout(flush,1e3);if(q.length>=10)flush()}function flush(){if(!q.length)return;const b=q.splice(0);fetch(EP,{method:"POST",body:JSON.stringify(b),keepalive:true,headers:{"Content-Type":"application/json"}}).catch(()=>{})}let lp="";function pv(){const p=w.location.pathname;if(p===lp)return;lp=p;send({t:"p",p,h:w.location.hostname,r:d.referrer||void 0,...utm()})}pv();const op=history.pushState,or=history.replaceState;history.pushState=function(){flush();op.apply(this,arguments);pv()};history.replaceState=function(){flush();or.apply(this,arguments);pv()};w.addEventListener("popstate",()=>{flush();pv()});w.addEventListener("beforeunload",()=>flush());w.klikapa={pageview:pv,track(n,pr,rv){send({t:"e",n,p:lp,pr,rv})},conversion(n,rv,pr){send({t:"c",n,p:lp,rv,pr})}}})(window,document);
```

- [ ] **Step 2: Verify the core bundle size**

Run:
```bash
cd /Users/macbookpro/Documents/JoyoDigitama/klikapa/klikapa
cat client/public/klikapa-core.js | wc -c
gzip -c client/public/klikapa-core.js | wc -c
```
Expected: raw ~900B, gzipped <900B (well under 1KB)

- [ ] **Step 3: Commit**

```bash
git add client/public/klikapa-core.js
git commit -m "feat: add core tracking script (<1KB gzipped)"
```

---

## Task 2: Rename Current Script to Full Bundle

**Files:**
- Copy: `klikapa/client/public/klikapa.js` → `klikapa/client/public/klikapa-full.js`

The current klikapa.js becomes the "full" bundle for Growth tier. Keep klikapa.js as-is for now (will be replaced by the serving endpoint in Task 3).

- [ ] **Step 1: Copy the current script**

```bash
cd /Users/macbookpro/Documents/JoyoDigitama/klikapa/klikapa
cp client/public/klikapa.js client/public/klikapa-full.js
```

- [ ] **Step 2: Verify full bundle size**

```bash
cat client/public/klikapa-full.js | wc -c
gzip -c client/public/klikapa-full.js | wc -c
```
Expected: raw ~6.2KB, gzipped ~2.2KB

- [ ] **Step 3: Commit**

```bash
git add client/public/klikapa-full.js
git commit -m "feat: add full tracking script bundle for Growth tier"
```

---

## Task 3: Add Dynamic Script Serving Endpoint

**Files:**
- Modify: `klikapa/server/src/index.ts` — add GET `/klikapa.js` route before the billing webhook handler (before line 221)

This endpoint intercepts requests for `/klikapa.js`, checks the site's plan from the `Referer` header or `data-site-id`, and returns the appropriate bundle.

- [ ] **Step 1: Add the script serving endpoint**

In `server/src/index.ts`, add the following route **before** `app.post("/billing/webhook", ...)` (line 221). Also add the import for `readFileSync` or use static file content.

```typescript
// Serve tracking script based on site plan tier
app.get("/klikapa.js", async (c) => {
  const referer = c.req.header("Referer") || "";
  const siteId = new URL(referer || "http://localhost").searchParams.get("site_id")
    || c.req.query("site_id") || "";

  let isFull = false;
  if (siteId) {
    try {
      const d1 = c.env.DB;
      if (d1) {
        const db = createDb(d1);
        const site = await db.selectFrom("sites")
          .select(["id", "user_id"])
          .where("id", "=", siteId)
          .executeTakeFirst();
        if (site) {
          const sub = await db.selectFrom("subscriptions")
            .select(["plan"])
            .where("user_id", "=", site.user_id)
            .executeTakeFirst();
          if (sub && (sub.plan === "growth")) {
            isFull = true;
          }
        }
      }
    } catch { /* default to core */ }
  }

  const scriptUrl = isFull
    ? new URL("/klikapa-full.js", c.req.url).href
    : new URL("/klikapa-core.js", c.req.url).href;

  // Redirect to the appropriate static file
  return c.redirect(scriptUrl, 302);
});
```

**Note:** Since the scripts are in `client/public/` (served as static assets by Cloudflare), the simplest approach is a 302 redirect. Alternatively, you can inline the file content with proper `Content-Type: application/javascript` headers and `Cache-Control: public, max-age=3600`. If the redirect approach causes issues (double request), switch to inlining the content from the static assets.

Alternative inline approach (if redirect is not ideal):
```typescript
app.get("/klikapa.js", async (c) => {
  // ... same plan detection logic ...

  // For Cloudflare Workers, serve from R2 or env binding
  // Or cache the script content at deploy time
  const coreScript = CORE_SCRIPT; // defined as string constant
  const fullScript = FULL_SCRIPT; // defined as string constant

  return new Response(isFull ? fullScript : coreScript, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
```

For the inline approach, add these constants at the top of `index.ts`:
```typescript
import coreScript from "../client/public/klikapa-core.js?raw";
import fullScript from "../client/public/klikapa-full.js?raw";
```

If the bundler doesn't support `?raw` imports, read the files at build time via a build plugin, or embed the strings directly.

- [ ] **Step 2: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: serve core or full tracking script based on plan tier"
```

---

## Task 4: Update billing.ts PLANS Object

**Files:**
- Modify: `klikapa/server/src/routes/billing.ts` lines 14-18 (PLANS object) and lines 167-172 (getFeatures function)

- [ ] **Step 1: Update the PLANS object**

Replace lines 14-18:
```typescript
const PLANS = {
  micro: { name: "Micro", price: 1, events_per_month: 10000, sites: 1 },
  starter: { name: "Starter", price: 4, events_per_month: 100000, sites: 3 },
  growth: { name: "Growth", price: 12, events_per_month: 500000, sites: 10 },
} as const;
```

- [ ] **Step 2: Update the getFeatures function**

Replace lines 167-172:
```typescript
function getFeatures(tier: keyof typeof PLANS): string[] {
  const base = ["Privacy-first analytics", "Cookieless tracking", "Visitor profiles", "UTM tracking", "CSV export"];
  if (tier === "micro") return [...base, "1 site", "10K events/month", "<1KB script", "7-day retention"];
  if (tier === "starter") return [...base, "3 sites", "100K events/month", "<1KB script", "30-day retention", "Funnel conversion", "Revenue attribution", "Real-time dashboard"];
  return [...base, "10 sites", "500K events/month", "Full script", "90-day retention", "AI insights", "Heatmaps", "Session replays", "Integrations", "Priority support", "Team members"];
}
```

- [ ] **Step 3: Update the free plan fallback in GET /subscription**

In the `billingRoutes.get("/subscription", ...)` handler (around line 30), change the default plan from `"free"` to `"micro"`:
```typescript
plan: "micro" as const, status: "active" as const,
```

- [ ] **Step 4: Update the checkout route to handle all 3 plans**

In `billingRoutes.post("/checkout", ...)` (line 89), the existing logic already uses `PLANS[plan]` dynamically, so it should work. But verify the product ID lookup handles `micro`:
```typescript
const productId = (c.env as any)[`POLAR_${plan.toUpperCase()}_PRODUCT_ID`] || "";
```
This will look for `POLAR_MICRO_PRODUCT_ID`. Add this env variable in the Cloudflare dashboard when the Polar product is created.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/billing.ts
git commit -m "feat: add Micro tier and update PLANS with new limits"
```

---

## Task 5: Update Landing Page Pricing Section

**Files:**
- Modify: `klikapa-landing/index.html` lines 722-763

- [ ] **Step 1: Replace the pricing cards section**

Replace the entire `<section class="pricing">...</section>` (lines 722-763) with:

```html
<section class="pricing" id="pricing" data-section="pricing">
  <div class="container">
    <div class="pricing-head fade-up">
      <div class="section-eyebrow" style="justify-content:center" data-i18n="price_eyebrow">Harga</div>
      <h2 data-i18n="price_title">Sederhana, transparan, <em>murah.</em></h2>
      <p data-i18n="price_desc">Tanpa biaya tersembunyi. Tanpa kejutan penggunaan. Batalkan kapan saja.</p>
    </div>
    <div class="pricing-cards">
      <div class="pcard fade-up d1">
        <div class="pcard-name">Micro</div>
        <div class="pcard-price"><span class="cur">$</span><span class="amt">1</span><span class="per">/bulan</span></div>
        <div class="pcard-desc" data-i18n="p0_desc">Hingga 10.000 event per bulan</div>
        <ul class="pcard-list">
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p0_f1">User journey</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p0_f2">Dashboard dasar</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p0_f3">UTM tracking</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p0_f4">Script &lt;1KB</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p0_f5">1 situs</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p0_f6">$1 per 5K event tambahan</span></li>
        </ul>
        <a href="https://app.revklik.com/register" class="btn-outline" data-i18n="p0_cta">Mulai dari $1</a>
      </div>
      <div class="pcard pop fade-up d2">
        <div class="pcard-name">Starter</div>
        <div class="pcard-price"><span class="cur">$</span><span class="amt">4</span><span class="per">/bulan</span></div>
        <div class="pcard-desc" data-i18n="p1_desc">Hingga 100.000 event per bulan</div>
        <ul class="pcard-list">
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f1">Semua fitur Micro</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f2">Funnel konversi</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f3">Atribusi revenue</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f4">Dashboard real-time</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f5">Cookieless attribution</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f6">3 situs</span></li>
          <li><span class="check g"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p1_f7">$2 per 50K event tambahan</span></li>
        </ul>
        <a href="https://app.revklik.com/register" class="btn-accent" data-i18n="p1_cta">Mulai Sekarang</a>
      </div>
      <div class="pcard fade-up d3">
        <div class="pcard-name">Growth</div>
        <div class="pcard-price"><span class="cur">$</span><span class="amt">12</span><span class="per">/bulan</span></div>
        <div class="pcard-desc" data-i18n="p2_desc">Hingga 500.000 event per bulan</div>
        <ul class="pcard-list">
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f1">Semua fitur Starter</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f2">10 situs</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f3">AI insights + session replay</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f4">Integrasi email &amp; ads</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f5">Team management &amp; mobile app</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f6">Prioritas dukungan</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f7">Akses API &amp; webhook</span></li>
          <li><span class="check r"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span> <span data-i18n="p2_f8">$2 per 100K event tambahan</span></li>
        </ul>
        <a href="https://app.revklik.com/register" class="btn-outline" data-i18n="p2_cta">Mulai Trial Gratis</a>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Update CSS for 3-column pricing**

In the `<style>` block, update the `.pricing-cards` rule. Find:
```css
.pricing-cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:880px;margin:0 auto}
```
Replace with:
```css
.pricing-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1100px;margin:0 auto}
```

In the `@media(max-width:960px)` block, add:
```css
.pricing-cards{grid-template-columns:1fr 1fr;max-width:660px}
```

In the `@media(max-width:520px)` block, add:
```css
.pricing-cards{grid-template-columns:1fr;max-width:460px}
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: 3-tier pricing cards with popcorn overage"
```

---

## Task 6: Update Calculator Section

**Files:**
- Modify: `klikapa-landing/index.html` — the calculator slider logic in the `<script>` block

- [ ] **Step 1: Update the calculator updateCalc function**

Replace the `updateCalc` function inside the IIFE (the function that starts with `function updateCalc()`) with:

```javascript
function updateCalc() {
  var events = parseInt(slider.value);
  valueEl.textContent = events.toLocaleString();

  var plan, price, limit, overage;
  if (events <= 10000) {
    plan = 'Micro'; price = '$1'; limit = '10,000'; overage = '';
  } else if (events <= 100000) {
    plan = 'Starter'; price = '$4'; limit = '100,000';
    var extra = Math.max(0, events - 10000);
    overage = extra > 0 ? ' + $' + Math.ceil(extra / 5000) + ' overage' : '';
  } else if (events <= 500000) {
    plan = 'Growth'; price = '$12'; limit = '500,000';
    var extra = Math.max(0, events - 100000);
    overage = extra > 0 ? ' + $' + (Math.ceil(extra / 50000) * 2) + ' overage' : '';
  } else {
    plan = 'Enterprise'; price = 'Custom'; limit = ''; overage = '';
  }

  badgeEl.textContent = plan;
  priceEl.textContent = price;
  var perSpan = document.createElement('span');
  perSpan.className = 'calc-per';
  perSpan.textContent = '/bln';
  priceEl.appendChild(perSpan);

  limitEl.textContent = plan === 'Enterprise' ? 'Hubungi kami' : 'Hingga ' + limit + ' events';

  if (plan === 'Micro') {
    badgeEl.style.background = 'rgba(52,211,153,.1)';
    badgeEl.style.color = '#34d399';
    badgeEl.style.borderColor = 'rgba(52,211,153,.2)';
  } else if (plan === 'Enterprise') {
    badgeEl.style.background = 'rgba(96,165,250,.1)';
    badgeEl.style.color = '#60a5fa';
    badgeEl.style.borderColor = 'rgba(96,165,250,.2)';
  } else {
    badgeEl.style.background = '';
    badgeEl.style.color = '';
    badgeEl.style.borderColor = '';
  }

  var datafastPrice = events <= 10000 ? '$9' : events <= 100000 ? '$19' : '$49+';
  compareEl.textContent = '';
  var before = document.createTextNode('DataFast: ');
  var highlight = document.createElement('span');
  highlight.className = 'highlight';
  highlight.textContent = datafastPrice + '/bln';
  var after = document.createTextNode(' untuk fitur lebih sedikit');
  compareEl.appendChild(before);
  compareEl.appendChild(highlight);
  compareEl.appendChild(after);
}
```

- [ ] **Step 2: Update slider ticks**

In the calculator HTML (around the `<div class="calc-slider-ticks">`), update to reflect the new range:

```html
<div class="calc-slider-ticks">
  <span>1K</span>
  <span>10K</span>
  <span>100K</span>
  <span>250K</span>
  <span>500K</span>
</div>
```

Update the slider `max` attribute to `500000`:
```html
<input type="range" id="calc-slider" min="1000" max="500000" step="1000" value="10000" class="calc-slider">
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: update calculator for 3-tier popcorn pricing"
```

---

## Task 7: Update Hero Strip and Comparison Table

**Files:**
- Modify: `klikapa-landing/index.html` — hero strip metrics (lines 398-403) and comparison table (lines 765-830)

- [ ] **Step 1: Update hero strip metrics**

Replace lines 398-403 (the `.hero-strip` div contents) with:

```html
<div class="hero-strip fade-up d4">
  <div class="metric"><div class="metric-val red">$1</div><div class="metric-lbl" data-i18n="metric_1">Mulai dari $1/bulan</div></div>
  <div class="metric"><div class="metric-val">&lt;1KB</div><div class="metric-lbl" data-i18n="metric_2">Ukuran script</div></div>
  <div class="metric"><div class="metric-val">&lt;5ms</div><div class="metric-lbl" data-i18n="metric_3">Ingestion di edge</div></div>
  <div class="metric"><div class="metric-val">300+</div><div class="metric-lbl" data-i18n="metric_4">Lokasi edge</div></div>
</div>
```

- [ ] **Step 2: Update comparison table starting price**

In the comparison table (line 780-781), find:
```html
<div class="cmp-cell win">$4/bln</div>
<div class="cmp-cell">$9/bln</div>
```
Replace with:
```html
<div class="cmp-cell win">$1/bln</div>
<div class="cmp-cell">$9/bln</div>
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: update hero metrics and comparison table pricing"
```

---

## Task 8: Update i18n Translations

**Files:**
- Modify: `klikapa-landing/index.html` — the `T` object in the `<script>` block (id: ~lines 898-955, en: ~lines 956-1013)

- [ ] **Step 1: Add Micro tier keys to the `id` object**

Add these keys to the `id` translation object (inside `id:{ ... }`):

```javascript
p0_desc:"Hingga 10.000 event per bulan",p0_f1:"User journey",p0_f2:"Dashboard dasar",p0_f3:"UTM tracking",p0_f4:"Script <1KB",p0_f5:"1 situs",p0_f6:"$1 per 5K event tambahan",p0_cta:"Mulai dari $1",
p1_f1:"Semua fitur Micro",p1_f2:"Funnel konversi",p1_f3:"Atribusi revenue",p1_f4:"Dashboard real-time",p1_f5:"Cookieless attribution",p1_f6:"3 situs",p1_f7:"$2 per 50K event tambahan",
p2_f1:"Semua fitur Starter",p2_f2:"10 situs",p2_f3:"AI insights + session replay",p2_f4:"Integrasi email & ads",p2_f5:"Team management & mobile app",p2_f6:"Prioritas dukungan",p2_f7:"Akses API & webhook",p2_f8:"$2 per 100K event tambahan",
metric_1:"Mulai dari $1/bulan",
```

Remove old keys that are no longer used: `p1_f1:"User journey lengkap"`, `p1_f2:"Funnel konversi"`, `p1_f3:"Atribusi revenue"`, `p1_f4:"Dashboard real-time"`, `p1_f5a:"Heatmap & cookieless attribution"`, `p1_f5:"1 situs"`, `p2_f4a`, `p2_f4b`, `p2_f4c`.

- [ ] **Step 2: Add Micro tier keys to the `en` object**

Add these keys to the `en` translation object:

```javascript
p0_desc:"Up to 10,000 events per month",p0_f1:"User journeys",p0_f2:"Basic dashboard",p0_f3:"UTM tracking",p0_f4:"Script <1KB",p0_f5:"1 site",p0_f6:"$1 per 5K extra events",p0_cta:"Start at $1",
p1_f1:"All Micro features",p1_f2:"Conversion funnels",p1_f3:"Revenue attribution",p1_f4:"Real-time dashboard",p1_f5:"Cookieless attribution",p1_f6:"3 sites",p1_f7:"$2 per 50K extra events",
p2_f1:"All Starter features",p2_f2:"10 sites",p2_f3:"AI insights + session replay",p2_f4:"Email & ads integrations",p2_f5:"Team management & mobile app",p2_f6:"Priority support",p2_f7:"API access & webhooks",p2_f8:"$2 per 100K extra events",
metric_1:"Starting at $1/month",
```

- [ ] **Step 3: Update JSON-LD structured data prices**

In the `<head>` section (around line 43), update the `offers` array in the JSON-LD:

```json
"offers": [
  { "@type": "Offer", "name": "Micro", "price": "1", "priceCurrency": "USD", "description": "Up to 10,000 events/month" },
  { "@type": "Offer", "name": "Starter", "price": "4", "priceCurrency": "USD", "description": "Up to 100,000 events/month" },
  { "@type": "Offer", "name": "Growth", "price": "12", "priceCurrency": "USD", "description": "Up to 500,000 events/month" }
]
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add i18n strings for 3-tier pricing"
```

---

## Task 9: Build, Verify, and Deploy

**Files:** None — verification only

- [ ] **Step 1: Verify the landing page renders correctly**

Open `index.html` in a browser and check:
- 3 pricing cards display correctly (Micro $1, Starter $4, Growth $12)
- Starter card has "Terpopuler" badge
- Calculator slider works with new tiers
- Hero strip shows "$1" metric
- Comparison table shows "$1/bln" for RevKlik
- Both ID and EN translations work
- Mobile responsive (3 cols → 2 → 1)

- [ ] **Step 2: Verify core script size**

```bash
cd /Users/macbookpro/Documents/JoyoDigitama/klikapa/klikapa
echo "Raw bytes:"; cat client/public/klikapa-core.js | wc -c
echo "Gzipped bytes:"; gzip -c client/public/klikapa-core.js | wc -c
```
Expected: gzipped < 1024 bytes (1KB)

- [ ] **Step 3: Build and deploy the server**

```bash
cd /Users/macbookpro/Documents/JoyoDigitama/klikapa/klikapa
bun run deploy
```

- [ ] **Step 4: Create Polar Micro product**

In the Polar.sh dashboard:
1. Create a new product "RevKlik Micro" with $1/month recurring price
2. Copy the product ID
3. Add `POLAR_MICRO_PRODUCT_ID` as a Cloudflare Workers secret:
   ```bash
   npx wrangler secret put POLAR_MICRO_PRODUCT_ID
   ```

- [ ] **Step 5: Verify webhook works**

Trigger a test checkout from the landing page and confirm:
- Webhook returns 200 (not 500)
- Subscription is created with correct plan

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete script split + popcorn pricing"
```
