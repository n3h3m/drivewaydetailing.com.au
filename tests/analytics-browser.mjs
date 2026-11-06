/**
 * Browser checks for GA4 + Clarity.
 *
 * Confirms each public page loads one measurement library pair, custom events
 * fire once for the real booking SMS handoff, and contact fields never leave
 * the page in a Google/Clarity request. SMS/tel/mailto navigations are aborted
 * so the tab stays put; measurement requests themselves are allowed through.
 *
 * Run: node tests/analytics-browser.mjs
 */
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startStaticServer } from './static-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });

const MEASUREMENT = 'G-CRXCQ78F53';
const CLARITY = 'z9d9xk3est';
const PUBLIC = [
  'index.html',
  'car-detailing-western-sydney.html',
  'car-detailing-blue-mountains.html',
  'car-detailing-central-coast.html',
];
const PII = [
  'LeadSentinelzz',
  '0499888777',
  'Sentinelvillezz',
  '2031-04-09',
  'sentinel-message-do-not-send',
];

const report = { ok: true, checks: [], network: {} };
function check(name, cond, detail = '') {
  report.checks.push({ name, pass: !!cond, detail: String(detail).slice(0, 500) });
  console.log(cond ? 'PASS' : 'FAIL', name, String(detail).slice(0, 220));
  if (!cond) report.ok = false;
}

function isMeasurementUrl(url) {
  return /google-analytics\.com|googletagmanager\.com|clarity\.ms|doubleclick\.net/.test(url);
}

async function instrument(page) {
  await page.evaluate(() => {
    window.__events = window.__events || [];
    const dl = window.dataLayer || (window.dataLayer = []);
    if (dl.__ddWrapped) return;
    const orig = dl.push;
    dl.push = function () {
      for (let i = 0; i < arguments.length; i += 1) {
        const item = arguments[i];
        if (item && item[0] === 'event') {
          let params = {};
          try { params = JSON.parse(JSON.stringify(item[2] || {})); } catch (e) { params = {}; }
          window.__events.push({ name: item[1], params });
        }
      }
      return orig.apply(this, arguments);
    };
    dl.__ddWrapped = true;
  });
}

async function events(page) {
  return page.evaluate(() => window.__events || []);
}

async function named(page, name) {
  return (await events(page)).filter((e) => e.name === name);
}

function attach(page, bag) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    const url = req.url();
    if (!isMeasurementUrl(url)) return;
    bag.requests.push({ url, method: req.method(), post: req.postData() || '' });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!isMeasurementUrl(url)) return;
    bag.responses.push({ url, status: res.status() });
  });
  page.on('requestfailed', (req) => {
    bag.failed.push({ url: req.url(), error: (req.failure() && req.failure().errorText) || '' });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith('http://127.0.0.1') && res.status() >= 400) {
      bag.localHttp.push({ url, status: res.status() });
    }
  });
  return { pageErrors, consoleErrors };
}

async function launch(browser, viewport) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width <= 430 ? 2 : 1,
    isMobile: viewport.width <= 430,
    hasTouch: viewport.width <= 430,
    reducedMotion: 'reduce',
  });
  await ctx.route('**/wa.me/**', (route) => route.abort());
  // Keep protocol links from leaving the tab. preventDefault does not stop
  // the analytics listener, which is registered later on the same click.
  await ctx.addInitScript(() => {
    document.addEventListener('click', (event) => {
      const node = event.target && event.target.closest && event.target.closest('a[href]');
      if (!node) return;
      const href = node.getAttribute('href') || '';
      if (/^(tel:|mailto:|sms:)/i.test(href)) event.preventDefault();
    }, true);
  });
  const bag = { requests: [], responses: [], failed: [], localHttp: [] };
  const page = await ctx.newPage();
  const logs = attach(page, bag);
  return { ctx, page, bag, logs };
}

async function holdProtocols(page) {
  await page.evaluate(() => {
    if (window.__holdProtocols) return;
    window.__holdProtocols = true;
    document.addEventListener('click', (event) => {
      const node = event.target && event.target.closest && event.target.closest('a[href]');
      const href = node ? node.getAttribute('href') || '' : '';
      if (/^(tel:|mailto:|sms:)/i.test(href)) event.preventDefault();
    }, true);
  });
}

async function open(page, base, file) {
  const gtagLoaded = page.waitForResponse((r) => r.url().includes('gtag/js?id='), { timeout: 20000 }).catch(() => null);
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.DDAnalytics && typeof window.gtag === 'function');
  await gtagLoaded;
  await page.waitForTimeout(250);
  await holdProtocols(page);
  await instrument(page);
}

async function main() {
  const { server, base } = await startStaticServer(ROOT);
  console.log('Serving', base);
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });
  try {
    await checkInstallation(browser, base);
    await checkHomepageEvents(browser, base);
    await checkGuardedHandoff(browser, base);
    await checkNavSmsAndLocation(browser, base);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
  writeFileSync(path.join(OUT, 'analytics-network.json'), JSON.stringify(report, null, 2));
  console.log(`\n=== ANALYTICS BROWSER ${report.ok ? 'PASS' : 'FAIL'} ${report.checks.filter((c) => c.pass).length}/${report.checks.length} ===`);
  if (!report.ok) process.exit(1);
}

async function checkInstallation(browser, base) {
  const { ctx, page, bag, logs } = await launch(browser, { width: 1280, height: 900 });
  try {
    for (const file of PUBLIC) {
      bag.requests.length = 0;
      bag.responses.length = 0;
      const loaded = Promise.all([
        page.waitForResponse((r) => r.url().includes(`gtag/js?id=${MEASUREMENT}`), { timeout: 20000 }),
        page.waitForResponse((r) => r.url().includes(`/tag/${CLARITY}`), { timeout: 20000 }),
      ]);
      await open(page, base, file);
      await loaded;
      const tags = await page.evaluate((ids) => ({
        gtagSrc: document.querySelectorAll(`script[src*="gtag/js?id=${ids.mid}"]`).length,
        configs: Array.from(document.scripts).filter((s) => (s.textContent || '').includes(`gtag('config', '${ids.mid}')`)).length,
        claritySrc: document.querySelectorAll(`script[src*="clarity.ms/tag/${ids.cid}"]`).length,
        clarityInline: Array.from(document.scripts).filter((s) => (s.textContent || '').includes(ids.cid)).length,
        helper: document.querySelectorAll('script[src$="assets/analytics.js"]').length,
        gtm: Array.from(document.scripts).filter((s) => /gtm\.js|GTM-/.test((s.src || '') + (s.textContent || ''))).length,
      }), { mid: MEASUREMENT, cid: CLARITY });
      check(`${file}: one gtag src in dom`, tags.gtagSrc === 1, JSON.stringify(tags));
      check(`${file}: one config block`, tags.configs === 1, JSON.stringify(tags));
      check(`${file}: one clarity loader`, tags.clarityInline === 1, JSON.stringify(tags));
      check(`${file}: one helper`, tags.helper === 1, JSON.stringify(tags));
      check(`${file}: no tag manager`, tags.gtm === 0, JSON.stringify(tags));
      const gtagHit = bag.responses.find((r) => r.url.includes(`gtag/js?id=${MEASUREMENT}`));
      const clarityHit = bag.responses.find((r) => r.url.includes(`/tag/${CLARITY}`));
      check(`${file}: gtag.js response`, !!gtagHit && gtagHit.status === 200, JSON.stringify(gtagHit || bag.failed.slice(0, 3)));
      check(`${file}: clarity tag response`, !!clarityHit && clarityHit.status === 200, JSON.stringify(clarityHit || bag.failed.slice(0, 3)));
      check(`${file}: no gtm.js request`, !bag.requests.some((r) => r.url.includes('gtm.js')), '');
      report.network[file] = {
        gtag: gtagHit || null,
        clarity: clarityHit || null,
      };
    }
    await page.goto(base + '/404.html', { waitUntil: 'domcontentloaded' });
    const absent = await page.evaluate(() => ({
      gtag: typeof window.gtag,
      clarity: typeof window.clarity,
      helper: typeof window.DDAnalytics,
    }));
    check('404 has no measurement runtime', absent.gtag === 'undefined' && absent.clarity === 'undefined' && absent.helper === 'undefined', JSON.stringify(absent));
    const local = logs.pageErrors.filter(Boolean);
    check('installation pages have no runtime exceptions', local.length === 0, JSON.stringify(local.slice(0, 4)));
    check('installation pages have no local http errors', bag.localHttp.length === 0, JSON.stringify(bag.localHttp.slice(0, 4)));
  } finally {
    await ctx.close();
  }
}

async function checkHomepageEvents(browser, base) {
  const { ctx, page, bag, logs } = await launch(browser, { width: 1280, height: 900 });
  const smsNavs = [];
  page.on('request', (req) => {
    if (/^sms:/i.test(req.url())) smsNavs.push(req.url());
  });
  try {
    await open(page, base, 'index.html');

    await page.locator('header a[href="tel:0429654427"]:visible').click({ noWaitAfter: true });
    await page.locator('footer a[href="tel:0429654427"]:visible').click({ noWaitAfter: true });
    let phones = await named(page, 'click_phone');
    check('header and footer call taps', phones.length === 2 && phones.every((e) => e.params.link_type === 'tel') && phones.map((e) => e.params.placement).join(',') === 'header,footer', JSON.stringify(phones));
    await page.evaluate(() => {
      document.querySelector('header a[href^="tel:"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    phones = await named(page, 'click_phone');
    check('repeat call tap on the same control is debounced', phones.length === 2, JSON.stringify(phones));

    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'mailto:bookings@example.com';
      a.id = 'analytics-mailto-probe';
      a.textContent = 'Email';
      document.body.appendChild(a);
    });
    // Chrome does not deliver a trusted click on a mailto link in this
    // headless session. HTMLElement.click() still runs the same listener.
    await page.locator('#analytics-mailto-probe').evaluate((el) => el.click());
    const emails = await named(page, 'click_email');
    phones = await named(page, 'click_phone');
    check('email tap is click_email only', emails.length === 1 && emails[0].params.link_type === 'mailto' && phones.length === 2 && (await named(page, 'generate_lead')).length === 0, JSON.stringify(emails));

    await page.fill('#f-name', 'LeadSentinelzz');
    await page.fill('#f-phone', '0499888777');
    await page.fill('#f-suburb', 'Sentinelvillezz');
    await page.locator('#booking-more').evaluate((el) => { el.open = true; });
    await page.fill('#f-message', 'sentinel-message-do-not-send');
    await page.fill('#booking-form input[name="date"]', '2031-04-09');
    await page.locator('#booking-form button[type="submit"]').evaluate((el) => el.click());
    const invalid = await page.evaluate(() => ({
      hidden: document.getElementById('form-success').classList.contains('hidden'),
      leads: (window.__events || []).filter((e) => e.name === 'generate_lead').length,
      packageError: document.querySelector('[data-err="package"]') && !document.querySelector('[data-err="package"]').classList.contains('hidden'),
    }));
    check('incomplete booking is not a lead and does not open the handoff', invalid.hidden && invalid.leads === 0 && invalid.packageError, JSON.stringify(invalid));

    await page.evaluate(() => document.getElementById('form-success').classList.remove('hidden'));
    check('showing the success panel is not a conversion', (await named(page, 'generate_lead')).length === 0, '');
    await page.evaluate(() => document.getElementById('form-success').classList.add('hidden'));

    const silverCta = page.locator('a.pkg-cta').first();
    await silverCta.evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
      el.click();
    });
    const selected = await named(page, 'select_package');
    const starts = await named(page, 'booking_start');
    const picked = await page.evaluate(() => document.querySelector('input[name="package"]:checked')?.getAttribute('data-pkg') || '');
    check('package card selects silver once and starts booking', picked === 'silver' && selected.length === 1 && selected[0].params.package_id === 'silver' && selected[0].params.lead_type === 'package' && selected[0].params.source === 'package_card' && starts.length === 1 && starts[0].params.entry === 'package_card', JSON.stringify({ picked, selected, starts }));
    await silverCta.evaluate((el) => el.click());
    check('tapping the same package again does not invent another selection', (await named(page, 'select_package')).length === 1 && (await named(page, 'booking_start')).length === 1, '');

    await page.locator('#booking-addons summary').evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
      el.click();
    });
    await page.waitForFunction(() => document.getElementById('booking-addons')?.open === true);
    await page.locator('input[name="addons"][value="Engine Bay Rinse (from $60)"]').evaluate((el) => el.click());
    const addons = await named(page, 'select_addon');
    check('add-on selection is one select_addon', addons.length === 1 && addons[0].params.addon_id === 'engine_bay_rinse', JSON.stringify(addons));

    await instrument(page);
    const beforeLaunch = await page.locator('#booking-form button[type="submit"]').evaluate((el) => {
      el.click();
      return {
        hidden: document.getElementById('form-success').classList.contains('hidden'),
        leads: (window.__events || []).filter((e) => e.name === 'generate_lead').length,
      };
    });
    check('success panel opens before the SMS launch is counted', beforeLaunch.hidden === false && beforeLaunch.leads === 0, JSON.stringify(beforeLaunch));
    await page.waitForFunction(() => (window.__events || []).some((e) => e.name === 'generate_lead'));
    const leads = await named(page, 'generate_lead');
    check('prepared SMS launch sends one package lead', leads.length === 1 && leads[0].params.lead_type === 'package' && leads[0].params.enquiry_kind === 'confirmed_package' && leads[0].params.package_id === 'silver' && leads[0].params.vehicle_size === 'hatch' && leads[0].params.currency === 'AUD' && leads[0].params.value === 129 && leads[0].params.addon_ids === 'engine_bay_rinse' && leads[0].params.method === 'sms' && leads[0].params.source === 'booking_sms', JSON.stringify(leads));

    await page.locator('#open-sms').evaluate((el) => el.click());
    await page.locator('#booking-form button[type="submit"]').evaluate((el) => el.click());
    await page.waitForTimeout(80);
    check('another send and another SMS tap do not duplicate the lead', (await named(page, 'generate_lead')).length === 1, JSON.stringify(await named(page, 'generate_lead')));

    const href = await page.locator('#open-sms').getAttribute('href');
    check('SMS draft still contains the enquiry text', href && href.includes('LeadSentinelzz') && href.includes('0499888777') && href.includes('sentinel-message-do-not-send'), href && href.slice(0, 80));

    await page.locator('input[name="package"][data-pkg="gold"]').evaluate((el) => el.click());
    await page.locator('input[name="vehicletype"][data-size="suv"]').evaluate((el) => el.click());
    await page.locator('#quote-services summary').evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
      el.click();
    });
    await page.locator('input[name="quoteservices"][value="Odour Removal"]').evaluate((el) => el.click());
    await instrument(page);
    await page.locator('#booking-form button[type="submit"]').evaluate((el) => el.click());
    await page.waitForFunction(() => (window.__events || []).filter((e) => e.name === 'generate_lead').length >= 2);
    const leads2 = await named(page, 'generate_lead');
    const second = leads2[1] && leads2[1].params;
    check('changed package is a second lead and keeps the custom quote distinct', leads2.length === 2 && second && second.package_id === 'gold' && second.enquiry_kind === 'confirmed_package_with_custom_quote' && second.lead_type === 'package' && second.vehicle_size === 'suv' && second.value === 289 && second.quote_ids === 'odour_removal', JSON.stringify(leads2.map((e) => e.params)));

    await page.evaluate(() => {
      document.querySelectorAll('#booking-form input[name="package"], #booking-form input[name="vehicletype"], #booking-form input[name="addons"], #booking-form input[name="quoteservices"]').forEach((el) => { el.checked = false; });
      const q = document.querySelector('input[name="quoteservices"][value="Paint Protection (Ceramic Coating)"]');
      q.checked = true;
      q.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await instrument(page);
    await page.locator('#booking-form button[type="submit"]').evaluate((el) => el.click());
    await page.waitForFunction(() => (window.__events || []).filter((e) => e.name === 'generate_lead').length >= 3);
    const leads3 = await named(page, 'generate_lead');
    const custom = leads3[2] && leads3[2].params;
    check('custom enquiry lead has no price and is not a confirmed package', leads3.length === 3 && custom && custom.lead_type === 'custom_enquiry' && custom.enquiry_kind === 'custom_enquiry' && custom.package_id === 'general_enquiry' && custom.vehicle_size === 'unspecified' && custom.quote_ids === 'paint_protection' && custom.value === undefined && custom.currency === undefined, JSON.stringify(custom));

    const evts = await events(page);
    // GA batches custom events and sends them on page hide. This does not change
    // the page; it only flushes the queued measurement hits so the test can see them.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(700);
    const googleBlob = JSON.stringify({
      requests: bag.requests.filter((r) => /google-analytics|googletagmanager|doubleclick/.test(r.url)),
      events: evts,
    });
    const leaked = PII.filter((secret) => googleBlob.includes(secret));
    check('Google hits and custom events contain no contact fields', leaked.length === 0, leaked.join(','));
    const collect = bag.requests.filter((r) => /\/g\/collect|\/collect\?/.test(r.url));
    const ens = collect.flatMap((r) => [...(r.url + '&' + (r.post || '')).matchAll(/(?:^|[?&])en=([^&]+)/g)].map((m) => decodeURIComponent(m[1])));
    const leadHit = collect.find((r) => /generate_lead/.test(r.url + '\n' + r.post));
    check('browser issued a generate_lead collect for this property', !!leadHit && (leadHit.url + leadHit.post).includes(MEASUREMENT) && ens.includes('click_phone') && ens.includes('click_email'), ens.join(','));
    check('collect payload has no contact fields', !leadHit || PII.every((secret) => !(leadHit.url + leadHit.post).includes(secret)), '');
    check('homepage events threw no runtime exceptions', logs.pageErrors.length === 0, JSON.stringify(logs.pageErrors.slice(0, 3)));
    const localConsole = logs.consoleErrors.filter((line) => /127\.0\.0\.1|\/assets\//.test(line));
    check('homepage has no local network console errors', bag.localHttp.length === 0 && localConsole.length === 0, JSON.stringify({ local: bag.localHttp, console: localConsole }));
    report.network.homepageEvents = {
      collect: collect.map((r) => ({ url: r.url.slice(0, 180), hasLead: (r.url + r.post).includes('generate_lead') })),
      leadCount: (await named(page, 'generate_lead')).length,
      smsNavs: smsNavs.length,
      thirdPartyFailed: bag.failed.filter((f) => isMeasurementUrl(f.url)).slice(0, 8),
      consoleErrors: logs.consoleErrors.slice(0, 8),
    };
  } finally {
    await ctx.close();
  }
}

async function checkGuardedHandoff(browser, base) {
  const { ctx, page, logs } = await launch(browser, { width: 1280, height: 900 });
  const smsNavs = [];
  page.on('request', (req) => {
    if (/^sms:/i.test(req.url())) smsNavs.push(req.url());
  });
  try {
    await open(page, base, 'index.html');
    await page.evaluate(() => {
      window.gtag = function () { throw new Error('analytics blocked'); };
    });
    await page.fill('#f-name', 'LeadSentinelzz');
    await page.fill('#f-phone', '0499888777');
    await page.fill('#f-suburb', 'Sentinelvillezz');
    await page.locator('input[name="package"][data-pkg="platinum"]').evaluate((el) => el.click());
    await page.locator('#booking-form button[type="submit"]').evaluate((el) => el.click());
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => {
      const href = document.getElementById('open-sms').getAttribute('href') || '';
      const success = document.getElementById('form-success');
      return {
        visible: success && !success.classList.contains('hidden'),
        hasBody: /[?&]body=/.test(href),
        hasName: href.includes('LeadSentinelzz'),
      };
    });
    check('analytics failure still opens the SMS draft', state.visible && state.hasBody && state.hasName, JSON.stringify(state));
    check('analytics failure still requests the sms handoff', smsNavs.length >= 1, String(smsNavs.length));
    check('throwing gtag is not an uncaught exception', logs.pageErrors.length === 0, JSON.stringify(logs.pageErrors.slice(0, 3)));

    await page.evaluate(() => {
      window.DDAnalytics.onPreparedSmsLaunch = function () { throw new Error('launch blew up'); };
    });
    await page.locator('#booking-form button[type="submit"]').evaluate((el) => el.click());
    await page.waitForTimeout(200);
    check('a throwing lead hook still requests the sms handoff', smsNavs.length >= 2, String(smsNavs.length));
    check('a throwing lead hook is not an uncaught exception', logs.pageErrors.length === 0, JSON.stringify(logs.pageErrors.slice(0, 3)));
  } finally {
    await ctx.close();
  }
}

async function checkNavSmsAndLocation(browser, base) {
  const mobile = await launch(browser, { width: 390, height: 844 });
  try {
    await open(mobile.page, base, 'index.html');
    await mobile.page.locator('a[href^="sms:"]:visible').click({ noWaitAfter: true });
    await mobile.page.locator('a[href^="sms:"]:visible').click({ noWaitAfter: true });
    await mobile.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await mobile.page.waitForTimeout(700);
    const leads = await named(mobile.page, 'generate_lead');
    check('nav message link is one custom enquiry lead', leads.length === 1 && leads[0].params.source === 'nav_sms' && leads[0].params.lead_type === 'custom_enquiry' && leads[0].params.value === undefined, JSON.stringify(leads));
    const phones = await named(mobile.page, 'click_phone');
    check('nav message tap is not a phone click', phones.length === 0, JSON.stringify(phones));
    const navCollect = mobile.bag.requests.filter((r) => /google-analytics\.com\/g\/collect/.test(r.url));
    const navLead = navCollect.find((r) => (r.url + (r.post || '')).includes('generate_lead') && (r.url + r.post).includes(MEASUREMENT));
    check('nav SMS handoff is sent to GA4', !!navLead, navCollect.map((r) => [...r.url.matchAll(/(?:^|[?&])en=([^&]+)/g)].map((m) => m[1]).join('+')).join(','));
    check('mobile homepage has no runtime exceptions', mobile.logs.pageErrors.length === 0, JSON.stringify(mobile.logs.pageErrors.slice(0, 3)));
  } finally {
    await mobile.ctx.close();
  }

  const loc = await launch(browser, { width: 1280, height: 900 });
  try {
    await open(loc.page, base, 'car-detailing-western-sydney.html');
    await loc.page.locator('header a[href="tel:0429654427"]').first().evaluate((el) => el.click());
    await loc.page.locator('a[href="sms:0429654427"]').first().evaluate((el) => el.click());
    const book = loc.page.locator('a[href="/#booking-form"]').first();
    const pingBook = () => book.evaluate((el) => {
      el.addEventListener('click', (event) => event.preventDefault(), { once: true });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await pingBook();
    await pingBook();
    const leads = await named(loc.page, 'generate_lead');
    const phones = await named(loc.page, 'click_phone');
    const starts = await named(loc.page, 'booking_start');
    check('bare text-us link is not a lead', leads.length === 0, JSON.stringify(leads));
    check('location phone tap is click_phone', phones.length === 1 && phones[0].params.placement === 'header' && phones[0].params.link_type === 'tel', JSON.stringify(phones));
    check('booking link starts once', starts.length === 1 && starts[0].params.entry === 'booking_cta', JSON.stringify(starts));
    check('location page has no runtime exceptions', loc.logs.pageErrors.length === 0, JSON.stringify(loc.logs.pageErrors.slice(0, 3)));
    const localConsole = loc.logs.consoleErrors.filter((line) => /127\.0\.0\.1|\/assets\//.test(line));
    check('location page has no local network console errors', loc.bag.localHttp.length === 0 && localConsole.length === 0, JSON.stringify(loc.bag.localHttp));
  } finally {
    await loc.ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
