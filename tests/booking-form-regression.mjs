/**
 * Booking form regression suite (Playwright + system Chrome).
 *
 * Covers: general/custom enquiry (no vehicle), known package+vehicle,
 * price summary, addon order/visibility/prices, compact invalid errors +
 * scroll, valid in-progress Book preserving state, success SMS/WA hrefs,
 * footer links, mobile overflow / console.
 *
 * Run from repo root:
 *   node tests/booking-form-regression.mjs
 * or (if package.json scripts installed):
 *   npm test
 *
 * Requires: Node 18+, playwright-core (workspace dep), /usr/bin/google-chrome
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/workspace/node_modules/playwright-core');
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Page under test. Default: serve the repo root over a local http server
// (pages use self-hosted fonts, which browsers refuse over file://).
//   --base=http://127.0.0.1:8765   test an already-running server / URL
//   --file                         legacy file:// mode
import { startStaticServer } from './static-server.mjs';
const ARG_BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').slice(7) || process.env.BASE_URL || '';
let PAGE = 'file://' + path.join(ROOT, 'index.html');
let staticServer = null;
async function resolvePage() {
  if (process.argv.includes('--file')) return;
  if (ARG_BASE) {
    PAGE = ARG_BASE.replace(/\/+$/, '') + '/index.html';
    return;
  }
  const { server, base } = await startStaticServer(ROOT);
  staticServer = server;
  PAGE = base + '/index.html';
}
const OUT = path.join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });

const ADDON_ORDER = [
  'Engine Bay Rinse (from $60)',
  'Headlight Restoration x2 (from $100)',
  'Plastic Trim Dye (from $50)',
  'Carpet & Floor Mat Shampoo (from $50)',
  'Pet Hair Removal (from $40)',
  'Ozone Treatment (30 min) (from $50)',
  'Child Seat Clean (from $50)',
];

const report = { ok: true, checks: [], started: new Date().toISOString() };
function check(name, cond, detail = '') {
  report.checks.push({ name, pass: !!cond, detail: String(detail).slice(0, 400) });
  console.log(cond ? 'PASS' : 'FAIL', name, String(detail).slice(0, 180));
  if (!cond) report.ok = false;
}

async function launch(vp = { width: 390, height: 844 }, userAgent = undefined) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  });
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: vp.width <= 430 ? 2 : 1,
    isMobile: vp.width <= 430,
    hasTouch: vp.width <= 430,
    reducedMotion: 'reduce',
    ...(userAgent ? { userAgent } : {}),
  });
  await ctx.route('**/sms:**', (r) => r.abort());
  await ctx.route('**/wa.me/**', (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((e) => {
      e.classList.add('is-visible');
      e.style.opacity = '1';
      e.style.transform = 'none';
    });
  });
  return { browser, page, errors, ctx };
}

async function fillContact(page, name = 'Regression Tester') {
  await page.fill('#f-name', name);
  await page.fill('#f-phone', '0412345678');
  await page.fill('#f-suburb', 'Auburn');
}

async function clearPackagesQuotes(page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('#booking-form input[name="package"]')
      .forEach((c) => {
        c.checked = false;
      });
    document
      .querySelectorAll('#booking-form input[name="quoteservices"]')
      .forEach((c) => {
        c.checked = false;
      });
    document
      .querySelectorAll('#booking-form input[name="addons"]')
      .forEach((c) => {
        c.checked = false;
      });
  });
}


async function selectRadio(page, name, attr, value) {
  await page.evaluate(
    ({ name, attr, value }) => {
      const el = document.querySelector(
        `#booking-form input[name="${name}"][${attr}="${value}"]`,
      );
      if (!el) throw new Error('radio not found: ' + name + ' ' + value);
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { name, attr, value },
  );
}

async function selectCheckbox(page, name, value) {
  await page.evaluate(
    ({ name, value }) => {
      const el = document.querySelector(
        `#booking-form input[name="${name}"][value="${value}"]`,
      );
      if (!el) throw new Error('checkbox not found: ' + name + ' ' + value);
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { name, value },
  );
}


async function main() {
  await resolvePage();
  console.log('Testing', PAGE);
  // ========== 1) General enquiry via quoteservice (no vehicle needed) ==========
  let { browser, page, errors } = await launch();
  await page.locator('#booking-form').scrollIntoViewIfNeeded();
  await fillContact(page);
  await clearPackagesQuotes(page);
  await page.evaluate(() => {
    document
      .querySelectorAll('#booking-form input[name="vehicletype"]')
      .forEach((c) => {
        c.checked = false;
      });
  });
  await selectCheckbox(page, 'quoteservices', 'Odour Removal');
  await page.waitForTimeout(120);
  const ge1 = await page.evaluate(() => ({
    ge: document.querySelector(
      'input[name="package"][value="General enquiry"]',
    )?.checked,
    pkg: document.querySelector('input[name="package"]:checked')?.value || null,
    quotes: [
      ...document.querySelectorAll(
        '#booking-form input[name="quoteservices"]:checked',
      ),
    ].map((c) => c.value),
  }));
  check(
    'ge-auto-select-on-quote',
    ge1.ge === true &&
      ge1.pkg === 'General enquiry' &&
      ge1.quotes.includes('Odour Removal'),
    JSON.stringify(ge1),
  );
  await page.click('#booking-form button[type="submit"]');
  await page
    .waitForSelector('#form-success:not(.hidden)', { timeout: 8000 })
    .catch(() => {});
  const s1 = await page.evaluate(() => {
    const success = document.getElementById('form-success');
    return {
      visible: success && !success.classList.contains('hidden'),
      preview: document.getElementById('sms-preview')?.textContent || '',
      sms: document.getElementById('open-sms')?.getAttribute('href') || '',
      wa: document.getElementById('open-wa')?.getAttribute('href') || '',
      pkgErr:
        document.querySelector('[data-err="package"]') &&
        !document
          .querySelector('[data-err="package"]')
          .classList.contains('hidden'),
    };
  });
  check('ge-submit-ok', s1.visible && !s1.pkgErr, JSON.stringify(s1));
  check(
    'ge-preview-custom-quote',
    /custom quote/i.test(s1.preview) && /Odour Removal/.test(s1.preview),
    s1.preview.slice(0, 220),
  );
  check(
    'ge-sms-href',
    /^sms:0429654427/.test(s1.sms) &&
      /Odour/.test(decodeURIComponent(s1.sms)),
    s1.sms.slice(0, 120),
  );
  check(
    'ge-wa-href',
    /wa\.me\/61429654427/.test(s1.wa) && /text=/.test(s1.wa),
    s1.wa.slice(0, 100),
  );
  check('ge-no-console', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
  await browser.close();

  // ========== 2) Custom quote CTA (Get a quote) ==========
  ({ browser, page, errors } = await launch({ width: 1280, height: 900 }));
  await clearPackagesQuotes(page);
  await page.evaluate(() => {
    document
      .querySelectorAll('#booking-form input[name="vehicletype"]')
      .forEach((c) => {
        c.checked = false;
      });
  });
  await page.click('#quote-cta');
  await page.waitForTimeout(200);
  const cta = await page.evaluate(() => ({
    ge: document.querySelector(
      'input[name="package"][value="General enquiry"]',
    )?.checked,
    pkg: document.querySelector('input[name="package"]:checked')?.value || null,
  }));
  check(
    'quote-cta-selects-ge',
    cta.ge === true && cta.pkg === 'General enquiry',
    JSON.stringify(cta),
  );
  await fillContact(page, 'CTA Lead');
  await page.click('.quote-pill[data-quote-value="Signage Removal"]');
  await page.waitForTimeout(80);
  await page.click('#booking-form button[type="submit"]');
  await page.waitForSelector('#form-success:not(.hidden)', { timeout: 8000 });
  const ctaPrev = await page.evaluate(
    () => document.getElementById('sms-preview')?.textContent || '',
  );
  check(
    'quote-cta-submit',
    /Signage Removal/.test(ctaPrev) && /custom quote/i.test(ctaPrev),
    ctaPrev.slice(0, 200),
  );
  await browser.close();

  // ========== 3) Known package + vehicle retained; price summary ==========
  ({ browser, page, errors } = await launch());
  await page.locator('#booking-form').scrollIntoViewIfNeeded();
  await clearPackagesQuotes(page);
  await selectRadio(page, 'vehicletype', 'data-size', 'suv');
  await selectRadio(page, 'package', 'data-pkg', 'silver');
  await page.waitForTimeout(100);
  // Also tick a quote — Silver must stay
  await selectCheckbox(page, 'quoteservices', 'Odour Removal');
  await page.waitForTimeout(100);
  const retained = await page.evaluate(() => ({
    pkg: document.querySelector('input[name="package"]:checked')?.value || null,
    ge: document.querySelector(
      'input[name="package"][value="General enquiry"]',
    )?.checked,
    veh: document.querySelector('input[name="vehicletype"]:checked')?.value || null,
    priceText: document.getElementById('price-summary-text')?.textContent || '',
    priceAmt: document.getElementById('price-summary-amount')?.textContent || '',
  }));
  check(
    'package-retained-with-quote',
    retained.pkg?.startsWith('Silver') && retained.ge !== true,
    JSON.stringify(retained),
  );
  check(
    'price-summary-shows-package',
    /Silver/i.test(retained.priceText) && /\$\d+/.test(retained.priceAmt),
    JSON.stringify({ t: retained.priceText, a: retained.priceAmt }),
  );
  await fillContact(page, 'Silver Booker');
  await page.click('#booking-form button[type="submit"]');
  await page.waitForSelector('#form-success:not(.hidden)', { timeout: 8000 });
  const silverPrev = await page.evaluate(
    () => document.getElementById('sms-preview')?.textContent || '',
  );
  check(
    'silver-submit-preview',
    /Silver/.test(silverPrev) &&
      /SUV|4WD|People Mover/i.test(silverPrev) &&
      /Odour Removal/.test(silverPrev),
    silverPrev.slice(0, 240),
  );
  await browser.close();

  // ========== 4) Addons: after package, collapsed until opened, prices inside ==========
  ({ browser, page, errors } = await launch());
  const addonInfo = await page.evaluate(() => {
    const box = document.getElementById('booking-addons');
    const summary = box?.querySelector('summary');
    const pkg = document.querySelector('[data-err="package"]')?.closest('fieldset');
    const style = summary ? getComputedStyle(summary) : null;
    const inputs = [
      ...document.querySelectorAll('#booking-addons input[name="addons"]'),
    ];
    const grid = box?.querySelector('.grid');
    const gridBox = grid?.getBoundingClientRect();
    return {
      summaryVisible: !!(
        summary &&
        style &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      ),
      collapsed: box?.tagName === 'DETAILS' && box.open === false,
      expanded: summary?.getAttribute('aria-expanded') || '',
      summaryText: (summary?.textContent || '').replace(/\s+/g, ' ').trim(),
      afterPackage: !!(
        pkg &&
        box &&
        pkg.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      optionsHidden: !gridBox || gridBox.height === 0,
      values: inputs.map((i) => i.value),
    };
  });
  check(
    'addons-summary-visible',
    addonInfo.summaryVisible && /Add-on Services/.test(addonInfo.summaryText),
    JSON.stringify(addonInfo),
  );
  check(
    'addons-collapsed-by-default',
    addonInfo.collapsed &&
      addonInfo.expanded === 'false' &&
      addonInfo.optionsHidden,
    JSON.stringify(addonInfo),
  );
  check(
    'addons-after-package',
    addonInfo.afterPackage === true,
    JSON.stringify(addonInfo),
  );
  check(
    'addons-order',
    JSON.stringify(addonInfo.values) === JSON.stringify(ADDON_ORDER),
    JSON.stringify(addonInfo.values),
  );
  await page.locator('#booking-addons summary').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#booking-addons summary')?.getAttribute('aria-expanded') ===
      'true',
  );
  const opened = await page.evaluate(() => {
    const box = document.getElementById('booking-addons');
    const summary = box.querySelector('summary');
    const inputs = [
      ...document.querySelectorAll('#booking-addons input[name="addons"]'),
    ];
    return {
      open: box.open === true,
      expanded: summary.getAttribute('aria-expanded'),
      labels: inputs.map((i) => {
        const lab = i.closest('label');
        return {
          value: i.value,
          text: (lab?.innerText || '').replace(/\s+/g, ' ').trim(),
        };
      }),
    };
  });
  const pricesOk = ADDON_ORDER.every((v) => {
    const m = v.match(/\$(\d+)/);
    const row = opened.labels.find((l) => l.value === v);
    return row && m && row.text.includes('$' + m[1]);
  });
  check(
    'addons-open-accessible',
    opened.open && opened.expanded === 'true',
    JSON.stringify({ open: opened.open, expanded: opened.expanded }),
  );
  check('addons-prices-shown', pricesOk, JSON.stringify(opened.labels.slice(0, 3)));
  // Select two addons + package, confirm summary mentions add-ons
  await clearPackagesQuotes(page);
  await selectRadio(page, 'vehicletype', 'data-size', 'hatch');
  await selectRadio(page, 'package', 'data-pkg', 'gold');
  await selectCheckbox(page, 'addons', 'Engine Bay Rinse (from $60)');
  await selectCheckbox(page, 'addons', 'Pet Hair Removal (from $40)');
  await page.waitForTimeout(100);
  const sum = await page.evaluate(() => ({
    text: document.getElementById('price-summary-text')?.textContent || '',
    amt: document.getElementById('price-summary-amount')?.textContent || '',
  }));
  check(
    'price-summary-addons',
    /Gold/i.test(sum.text) &&
      /add-on/i.test(sum.text) &&
      /\$100|from \$100/i.test(sum.amt),
    JSON.stringify(sum),
  );
  await page.locator('#booking-addons summary').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#booking-addons summary')?.getAttribute('aria-expanded') ===
      'false',
  );
  const closed = await page.evaluate(() => {
    const box = document.getElementById('booking-addons');
    const checked = [
      ...document.querySelectorAll('#booking-form input[name="addons"]:checked'),
    ].map((c) => c.value);
    return {
      open: box.open,
      expanded: box.querySelector('summary')?.getAttribute('aria-expanded'),
      checked,
      price: document.getElementById('price-summary-text')?.textContent || '',
    };
  });
  check(
    'addons-close-keeps-selection',
    closed.open === false &&
      closed.expanded === 'false' &&
      closed.checked.includes('Engine Bay Rinse (from $60)') &&
      closed.checked.includes('Pet Hair Removal (from $40)') &&
      /Gold/i.test(closed.price) &&
      /2 add-ons/.test(closed.price),
    JSON.stringify(closed),
  );
  await page.locator('#booking-addons summary').click();
  await selectRadio(page, 'package', 'data-pkg', 'platinum');
  await page.waitForTimeout(80);
  const switched = await page.evaluate(() => ({
    pkg: document.querySelector('input[name="package"]:checked')?.value || '',
    checked: [
      ...document.querySelectorAll('#booking-form input[name="addons"]:checked'),
    ].map((c) => c.value),
    price: document.getElementById('price-summary-text')?.textContent || '',
    amt: document.getElementById('price-summary-amount')?.textContent || '',
    open: document.getElementById('booking-addons')?.open,
  }));
  check(
    'addons-survive-package-switch',
    /Platinum/i.test(switched.pkg) &&
      switched.checked.includes('Engine Bay Rinse (from $60)') &&
      switched.checked.includes('Pet Hair Removal (from $40)') &&
      /Platinum/i.test(switched.price) &&
      /2 add-ons/.test(switched.price) &&
      /\$100|from \$100/i.test(switched.amt) &&
      switched.open === true,
    JSON.stringify(switched),
  );
  const hours = await page.locator('#business-hours').innerText();
  check(
    'hours-seven-days',
    hours.trim() === '7 days a week' && !/9:00|5:00|Mon|Sunday/.test(hours),
    hours,
  );
  check('addons-no-console', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
  await browser.close();

  ({ browser, page, errors } = await launch({ width: 1280, height: 900 }));
  const desk = await page.evaluate(() => {
    const box = document.getElementById('booking-addons');
    const summary = box?.querySelector('summary');
    return {
      collapsed: box?.open === false,
      expanded: summary?.getAttribute('aria-expanded') || '',
      hours: document.getElementById('business-hours')?.textContent?.trim() || '',
    };
  });
  await page.locator('#booking-addons summary').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('#booking-addons summary')?.getAttribute('aria-expanded') ===
      'true',
  );
  const deskOpen = await page.evaluate(() => {
    const box = document.getElementById('booking-addons');
    const label = box.querySelector('input[name="addons"]')?.closest('label');
    return {
      open: box.open === true,
      expanded: box.querySelector('summary')?.getAttribute('aria-expanded'),
      price: (label?.innerText || '').replace(/\s+/g, ' '),
    };
  });
  check(
    'addons-desktop-keyboard',
    desk.collapsed &&
      desk.expanded === 'false' &&
      desk.hours === '7 days a week' &&
      deskOpen.open &&
      deskOpen.expanded === 'true' &&
      /\$60/.test(deskOpen.price) &&
      errors.length === 0,
    JSON.stringify({ desk, deskOpen, errors }),
  );
  await browser.close();

  // ========== 4b) Two independent add-on boxes: collapsed, expand, stay open ==========
  ({ browser, page, errors } = await launch({ width: 390, height: 844 }));
  const boxes = () =>
    page.evaluate(() => {
      const addons = document.getElementById('booking-addons');
      const quotes = document.getElementById('quote-services');
      const hidden = (el) => {
        const grid = el?.querySelector('.grid');
        if (!grid) return true;
        const r = grid.getBoundingClientRect();
        return r.height === 0;
      };
      return {
        addonsTag: addons?.tagName || '',
        quotesTag: quotes?.tagName || '',
        addonsOpen: addons?.open === true,
        quotesOpen: quotes?.open === true,
        addonsHidden: hidden(addons),
        quotesHidden: hidden(quotes),
        addonChecked: [
          ...document.querySelectorAll('#booking-form input[name="addons"]:checked'),
        ].map((c) => c.value),
        quoteChecked: [
          ...document.querySelectorAll(
            '#booking-form input[name="quoteservices"]:checked',
          ),
        ].map((c) => c.value),
        moreOpen: document.getElementById('booking-more')?.open === true,
        quoteCopy: (quotes?.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
  const initialBoxes = await boxes();
  check(
    'both-addon-boxes-collapsed',
    initialBoxes.addonsTag === 'DETAILS' &&
      initialBoxes.quotesTag === 'DETAILS' &&
      initialBoxes.addonsOpen === false &&
      initialBoxes.quotesOpen === false &&
      initialBoxes.addonsHidden &&
      initialBoxes.quotesHidden &&
      initialBoxes.moreOpen === false &&
      /Want a quote on other services\?/.test(initialBoxes.quoteCopy) &&
      /don.?t have a set price yet/.test(initialBoxes.quoteCopy) &&
      /Paint Protection \(Ceramic Coating\)/.test(initialBoxes.quoteCopy),
    JSON.stringify(initialBoxes),
  );
  await page.locator('#quote-services summary').click();
  await page.waitForFunction(() => document.getElementById('quote-services')?.open === true);
  let boxState = await boxes();
  check(
    'manual-expand-quotes-only',
    boxState.quotesOpen === true &&
      boxState.quotesHidden === false &&
      boxState.addonsOpen === false &&
      boxState.moreOpen === false,
    JSON.stringify(boxState),
  );
  await page.locator('#quote-services summary').click();
  await page.waitForFunction(() => document.getElementById('quote-services')?.open === false);
  await page.locator('#booking-addons summary').click();
  await page.waitForFunction(() => document.getElementById('booking-addons')?.open === true);
  boxState = await boxes();
  check(
    'manual-expand-addons-only',
    boxState.addonsOpen === true &&
      boxState.addonsHidden === false &&
      boxState.quotesOpen === false &&
      boxState.moreOpen === false,
    JSON.stringify(boxState),
  );
  await page.locator('#booking-addons summary').click();
  await page.waitForFunction(() => document.getElementById('booking-addons')?.open === false);
  await page.locator('.addon-toggle[data-addon-value="Engine Bay Rinse (from $60)"]').click();
  await page.waitForFunction(() => document.getElementById('booking-addons')?.open === true);
  boxState = await boxes();
  check(
    'select-addon-opens-only-addons',
    boxState.addonsOpen === true &&
      boxState.quotesOpen === false &&
      boxState.moreOpen === false &&
      boxState.addonChecked.length === 1 &&
      /Engine Bay Rinse/.test(boxState.addonChecked[0]) &&
      boxState.quoteChecked.length === 0,
    JSON.stringify(boxState),
  );
  await page.locator('.addon-toggle[data-addon-value="Engine Bay Rinse (from $60)"]').click();
  await page.waitForTimeout(80);
  boxState = await boxes();
  check(
    'untick-last-addon-stays-open',
    boxState.addonsOpen === true &&
      boxState.addonsHidden === false &&
      boxState.quotesOpen === false &&
      boxState.addonChecked.length === 0,
    JSON.stringify(boxState),
  );
  await page.locator('#booking-addons summary').click();
  await page.waitForFunction(() => document.getElementById('booking-addons')?.open === false);
  await page.locator('.quote-pill[data-quote-value="Odour Removal"]').click();
  await page.waitForFunction(() => document.getElementById('quote-services')?.open === true);
  boxState = await boxes();
  check(
    'select-quote-opens-only-quotes',
    boxState.quotesOpen === true &&
      boxState.quotesHidden === false &&
      boxState.addonsOpen === false &&
      boxState.moreOpen === false &&
      boxState.quoteChecked.includes('Odour Removal') &&
      boxState.addonChecked.length === 0,
    JSON.stringify(boxState),
  );
  await page.locator('.quote-pill[data-quote-value="Odour Removal"]').click();
  await page.waitForTimeout(80);
  boxState = await boxes();
  check(
    'untick-last-quote-stays-open',
    boxState.quotesOpen === true &&
      boxState.addonsOpen === false &&
      boxState.quoteChecked.length === 0 &&
      boxState.addonChecked.length === 0,
    JSON.stringify(boxState),
  );
  // A tick made inside the closed form box also opens only that box, then stays open.
  await page.locator('#quote-services summary').click();
  await page.waitForFunction(() => document.getElementById('quote-services')?.open === false);
  await selectCheckbox(page, 'addons', 'Pet Hair Removal (from $40)');
  await page.waitForFunction(() => document.getElementById('booking-addons')?.open === true);
  await page.evaluate(() => {
    const el = document.querySelector(
      '#booking-form input[name="addons"][value="Pet Hair Removal (from $40)"]',
    );
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  boxState = await boxes();
  check(
    'form-untick-last-addon-stays-open',
    boxState.addonsOpen === true &&
      boxState.quotesOpen === false &&
      boxState.addonChecked.length === 0,
    JSON.stringify(boxState),
  );
  check(
    'addon-boxes-no-console',
    errors.length === 0,
    JSON.stringify(errors.slice(0, 4)),
  );
  await browser.close();

  ({ browser, page, errors } = await launch({ width: 1280, height: 900 }));
  const deskBoxes = await page.evaluate(() => ({
    addonsOpen: document.getElementById('booking-addons')?.open === true,
    quotesOpen: document.getElementById('quote-services')?.open === true,
  }));
  check(
    'addon-boxes-collapsed-desktop',
    deskBoxes.addonsOpen === false && deskBoxes.quotesOpen === false && errors.length === 0,
    JSON.stringify({ deskBoxes, errors }),
  );
  await browser.close();

  // ========== 5) Incomplete submit → compact inline errors + scroll ==========
  ({ browser, page, errors } = await launch({ width: 390, height: 844 }));
  await page.locator('#booking-form').scrollIntoViewIfNeeded();
  await clearPackagesQuotes(page);
  // Leave name empty, fill phone/suburb; vehicle auto hatch from setPageSize
  await page.fill('#f-name', '');
  await page.fill('#f-phone', '0412345678');
  await page.fill('#f-suburb', 'Auburn');
  // Uncheck package explicitly (vehicle stays)
  await page.evaluate(() => {
    document
      .querySelectorAll('#booking-form input[name="package"]')
      .forEach((c) => {
        c.checked = false;
      });
  });
  await page.click('#booking-form button[type="submit"]');
  await page.waitForTimeout(400);
  const errState = await page.evaluate(() => {
    const vis = (name) => {
      const el = document.querySelector(`[data-err="${name}"]`);
      return !!(el && !el.classList.contains('hidden'));
    };
    const pkgFs = document
      .querySelector('[data-err="package"]')
      ?.closest('fieldset');
    const chips = pkgFs
      ? [...pkgFs.querySelectorAll('.form-chip .chip-face')].map((el) => {
          const r = el.getBoundingClientRect();
          return { h: Math.round(r.height), w: Math.round(r.width) };
        })
      : [];
    const errEl = document.querySelector('[data-err="name"]:not(.hidden)') ||
      document.querySelector('[data-err="package"]:not(.hidden)');
    const errRect = errEl?.getBoundingClientRect();
    const heroCards = document.querySelectorAll('#packages .pkg-card, #packages article, #packages .rounded-2xl');
    const heroesInView = [...heroCards].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0 && r.height > 180;
    }).length;
    return {
      nameErr: vis('name'),
      phoneErr: vis('phone'),
      suburbErr: vis('suburb'),
      vehicleErr: vis('vehicletype'),
      packageErr: vis('package'),
      pkgInvalid: pkgFs?.classList.contains('is-invalid') || false,
      chipHeights: chips.map((c) => c.h),
      maxChipH: chips.reduce((m, c) => Math.max(m, c.h), 0),
      errInView: errRect
        ? errRect.top >= -20 && errRect.top < window.innerHeight * 0.85
        : false,
      heroesInView,
      successHidden: document
        .getElementById('form-success')
        ?.classList.contains('hidden'),
      scrollY: Math.round(window.scrollY),
    };
  });
  check(
    'invalid-name-and-package-errors',
    errState.nameErr && errState.packageErr && !errState.phoneErr,
    JSON.stringify(errState),
  );
  check(
    'invalid-compact-chips',
    errState.maxChipH > 0 && errState.maxChipH < 120,
    `maxChipH=${errState.maxChipH} chips=${JSON.stringify(errState.chipHeights)}`,
  );
  check(
    'invalid-fieldset-mark',
    errState.pkgInvalid === true,
    JSON.stringify({ pkgInvalid: errState.pkgInvalid }),
  );
  check(
    'invalid-no-giant-heroes',
    errState.heroesInView === 0,
    `heroesInView=${errState.heroesInView}`,
  );
  check(
    'invalid-first-error-scrolled',
    errState.errInView === true && errState.successHidden === true,
    JSON.stringify({
      errInView: errState.errInView,
      scrollY: errState.scrollY,
    }),
  );
  await page.screenshot({
    path: path.join(OUT, 'mobile-invalid-compact.png'),
    fullPage: false,
  });

  // ========== 6) Book CTA while invalid: preserve state, scroll to error ==========
  // Fill name so only package missing; select a quote + leave package empty intentionally
  await page.fill('#f-name', 'In Progress');
  await page.evaluate(() => {
    // clear errors visually by re-showing only package after next submit
    document
      .querySelectorAll('#booking-form input[name="package"]')
      .forEach((c) => {
        c.checked = false;
      });
  });
  await selectCheckbox(page, 'quoteservices', 'Odour Removal');
  // Wait — GE auto-selects on quote. For "missing package" path we need no GE.
  // Uncheck GE again to simulate incomplete package after user cleared it.
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const ge = document.querySelector(
      'input[name="package"][value="General enquiry"]',
    );
    if (ge) ge.checked = false;
    document
      .querySelectorAll('#booking-form input[name="package"]')
      .forEach((c) => {
        c.checked = false;
      });
  });
  await page.click('#booking-form button[type="submit"]');
  await page.waitForTimeout(350);
  // Capture pre-Book state
  const beforeBook = await page.evaluate(() => ({
    name: document.getElementById('f-name')?.value,
    phone: document.getElementById('f-phone')?.value,
    suburb: document.getElementById('f-suburb')?.value,
    quotes: [
      ...document.querySelectorAll(
        '#booking-form input[name="quoteservices"]:checked',
      ),
    ].map((c) => c.value),
    packageErr: !document
      .querySelector('[data-err="package"]')
      ?.classList.contains('hidden'),
  }));
  // Leave form, show sticky bar, then click its Book link
  await page.locator('#packages').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document
      .querySelector('#mobile-sticky-bar a[href="#booking-form"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  const afterBook = await page.evaluate(() => {
    const err = document.querySelector('[data-err="package"]');
    const r = err?.getBoundingClientRect();
    return {
      name: document.getElementById('f-name')?.value,
      phone: document.getElementById('f-phone')?.value,
      suburb: document.getElementById('f-suburb')?.value,
      quotes: [
        ...document.querySelectorAll(
          '#booking-form input[name="quoteservices"]:checked',
        ),
      ].map((c) => c.value),
      packageErr: err && !err.classList.contains('hidden'),
      errInView: r ? r.bottom > 60 && r.top < window.innerHeight - 40 : false,
      errTop: r ? Math.round(r.top) : null,
      hash: location.hash,
    };
  });
  check(
    'book-preserves-fields',
    afterBook.name === beforeBook.name &&
      afterBook.phone === beforeBook.phone &&
      afterBook.suburb === beforeBook.suburb &&
      JSON.stringify(afterBook.quotes) === JSON.stringify(beforeBook.quotes),
    JSON.stringify({ beforeBook, afterBook }),
  );
  check(
    'book-scrolls-to-error-when-invalid',
    afterBook.packageErr === true && afterBook.errInView === true,
    JSON.stringify(afterBook),
  );
  await browser.close();

  // ========== 7) Valid in-progress Book: preserve choices, no error flash ==========
  ({ browser, page, errors } = await launch());
  await page.locator('#booking-form').scrollIntoViewIfNeeded();
  await clearPackagesQuotes(page);
  await fillContact(page, 'Valid Progress');
  await selectRadio(page, 'vehicletype', 'data-size', 'hatch');
  await selectRadio(page, 'package', 'data-pkg', 'platinum');
  await selectCheckbox(page, 'addons', 'Child Seat Clean (from $50)');
  await page.waitForTimeout(80);
  await page.locator('#packages').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document
      .querySelector('#mobile-sticky-bar a[href="#booking-form"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  const validBook = await page.evaluate(() => ({
    name: document.getElementById('f-name')?.value,
    pkg: document.querySelector('input[name="package"]:checked')?.value || null,
    addon: [
      ...document.querySelectorAll(
        '#booking-form input[name="addons"]:checked',
      ),
    ].map((c) => c.value),
    anyErr: !![
      ...document.querySelectorAll('#booking-form [data-err]'),
    ].find((el) => !el.classList.contains('hidden')),
    formNearTop: (() => {
      const f = document.getElementById('booking-form');
      const r = f.getBoundingClientRect();
      return r.top < window.innerHeight * 0.75 && r.bottom > 80;
    })(),
    formTop: (() => {
      const f = document.getElementById('booking-form');
      return Math.round(f.getBoundingClientRect().top);
    })(),
  }));
  check(
    'valid-book-preserves-state',
    validBook.name === 'Valid Progress' &&
      /Platinum/i.test(validBook.pkg || '') &&
      validBook.addon.includes('Child Seat Clean (from $50)') &&
      validBook.anyErr === false,
    JSON.stringify(validBook),
  );
  check(
    'valid-book-scrolls-to-form',
    validBook.formNearTop === true,
    JSON.stringify(validBook),
  );
  // Submit success CTAs
  await page.click('#booking-form button[type="submit"]');
  await page.waitForSelector('#form-success:not(.hidden)', { timeout: 8000 });
  const okHref = await page.evaluate(() => ({
    sms: document.getElementById('open-sms')?.getAttribute('href') || '',
    wa: document.getElementById('open-wa')?.getAttribute('href') || '',
    preview: document.getElementById('sms-preview')?.textContent || '',
  }));
  check(
    'valid-sms-wa-hrefs',
    /^sms:0429654427\?body=/.test(okHref.sms) && // desktop UA: standard form (iPhone form tested in 9)
      !okHref.sms.includes('?&body=') &&
      /^https:\/\/wa\.me\/61429654427\?text=/.test(okHref.wa) &&
      /Platinum/.test(okHref.preview) &&
      /Child Seat Clean/.test(okHref.preview),
    JSON.stringify({
      sms: okHref.sms.slice(0, 80),
      wa: okHref.wa.slice(0, 80),
      preview: okHref.preview.slice(0, 160),
    }),
  );
  await browser.close();

  // Map card keeps the 640×420 artwork. Desktop must not letterbox it
  // inside a column stretched to the suburb list.
  const MAP_WIDTHS = [360, 375, 390, 768, 1280, 1440];
  for (const width of MAP_WIDTHS) {
    ({ browser, page, errors } = await launch({
      width,
      height: width >= 1024 ? 1100 : 844,
    }));
    const map = await page.evaluate(() => {
      const svg = document.querySelector('#map-scroll svg');
      const fig = svg.closest('figure');
      const cap = fig.querySelector('figcaption');
      const r = svg.getBoundingClientRect();
      const fr = fig.getBoundingClientRect();
      const cr = cap.getBoundingClientRect();
      const labelInArt = (name) => {
        const el = [...svg.querySelectorAll('text')].find((t) =>
          (t.textContent || '').includes(name),
        );
        if (!el) return false;
        const b = el.getBoundingClientRect();
        return (
          b.width > 2 &&
          b.left >= r.left - 1 &&
          b.right <= r.right + 1 &&
          b.top >= r.top - 1 &&
          b.bottom <= r.bottom + 1
        );
      };
      return {
        aspect: r.width / r.height,
        gap: cr.top - r.bottom,
        padTop: r.top - fr.top,
        padBot: fr.bottom - cr.bottom,
        katoomba: labelInArt('Katoomba'),
        blackwall: labelInArt('Blackwall'),
        legend: (cap.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
    const natural = 640 / 420;
    check(
      `map-aspect-${width}`,
      Math.abs(map.aspect - natural) < 0.04 &&
        map.gap > 0 &&
        map.gap < 20 &&
        map.padTop < 28 &&
        map.padBot < 28 &&
        map.katoomba &&
        map.blackwall &&
        /Suburb we service/.test(map.legend) &&
        /Confirmed recent job/.test(map.legend) &&
        /illustrative, not to scale/.test(map.legend) &&
        errors.length === 0,
      JSON.stringify({
        aspect: +map.aspect.toFixed(3),
        natural: +natural.toFixed(3),
        gap: Math.round(map.gap),
        padTop: Math.round(map.padTop),
        padBot: Math.round(map.padBot),
        katoomba: map.katoomba,
        blackwall: map.blackwall,
        errors,
      }),
    );
    await browser.close();
  }

  // Area-page "Also servicing" links must stay readable on the navy band,
  // and every area link on the homepage and area pages must clear contrast.
  const ALSO = [
    [
      'car-detailing-western-sydney.html',
      [
        ['the Blue Mountains', 'car-detailing-blue-mountains.html'],
        ['the Central Coast', 'car-detailing-central-coast.html'],
        ['Sydney', '/#areas'],
      ],
    ],
    [
      'car-detailing-blue-mountains.html',
      [
        ['Western Sydney', 'car-detailing-western-sydney.html'],
        ['the Central Coast', 'car-detailing-central-coast.html'],
        ['Sydney', '/#areas'],
      ],
    ],
    [
      'car-detailing-central-coast.html',
      [
        ['Western Sydney', 'car-detailing-western-sydney.html'],
        ['the Blue Mountains', 'car-detailing-blue-mountains.html'],
        ['Sydney', '/#areas'],
      ],
    ],
  ];
  for (const width of [1440, 390]) {
    for (const [file, expected] of ALSO) {
      ({ browser, page, errors } = await launch({
        width,
        height: width >= 1024 ? 1000 : 844,
      }));
      const url = new URL(page.url());
      await page.goto(url.origin + '/' + file, { waitUntil: 'networkidle' });
      const row = await page.evaluate(() => {
        const lum = (rgb) => {
          const nums = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
          const ch = nums.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        };
        const contrast = (fg, bg) => {
          const a = lum(fg);
          const b = lum(bg);
          const [hi, lo] = a > b ? [a, b] : [b, a];
          return (hi + 0.05) / (lo + 0.05);
        };
        const bgOf = (el) => {
          let n = el;
          while (n) {
            const bg = getComputedStyle(n).backgroundColor;
            const parts = bg.match(/[\d.]+/g);
            if (parts && (parts.length < 4 || parseFloat(parts[3]) > 0.4)) return bg;
            n = n.parentElement;
          }
          return 'rgb(255, 255, 255)';
        };
        const p = [...document.querySelectorAll('p')].find((el) =>
          (el.textContent || '').trim().startsWith('Also servicing'),
        );
        if (!p) return { missing: true };
        const links = [...p.querySelectorAll('a')].map((a) => {
          const cs = getComputedStyle(a);
          const fg = cs.color;
          const bg = bgOf(a);
          const r = a.getBoundingClientRect();
          return {
            text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
            href: a.getAttribute('href'),
            fg,
            bg,
            contrast: contrast(fg, bg),
            underline: cs.textDecorationLine,
            w: r.width,
            h: r.height,
          };
        });
        return { text: (p.textContent || '').replace(/\s+/g, ' ').trim(), links };
      });
      const ok =
        row &&
        !row.missing &&
        row.links.length === expected.length &&
        expected.every(([text, href], i) => {
          const link = row.links[i];
          return (
            link.text === text &&
            link.href === href &&
            link.contrast >= 4.5 &&
            link.underline.includes('underline') &&
            link.w > 8 &&
            link.h > 8
          );
        }) &&
        errors.length === 0;
      check(
        `also-servicing-${file.replace('car-detailing-', '').replace('.html', '')}-${width}`,
        ok,
        JSON.stringify(row),
      );
      await browser.close();
    }
    ({ browser, page, errors } = await launch({
      width,
      height: width >= 1024 ? 1100 : 900,
    }));
    const sweepPages = [
      '',
      'car-detailing-western-sydney.html',
      'car-detailing-blue-mountains.html',
      'car-detailing-central-coast.html',
    ];
    const bad = [];
    for (const file of sweepPages) {
      const origin = new URL(page.url()).origin;
      await page.goto(origin + '/' + file, { waitUntil: 'networkidle' });
      const found = await page.evaluate(() => {
        const lum = (rgb) => {
          const nums = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          if (nums.length < 3) return 1;
          const ch = nums.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        };
        const contrast = (fg, bg) => {
          const a = lum(fg);
          const b = lum(bg);
          const [hi, lo] = a > b ? [a, b] : [b, a];
          return (hi + 0.05) / (lo + 0.05);
        };
        const bgOf = (el) => {
          let n = el;
          while (n) {
            const bg = getComputedStyle(n).backgroundColor;
            const parts = bg.match(/[\d.]+/g);
            if (parts && (parts.length < 4 || parseFloat(parts[3]) > 0.4)) return bg;
            n = n.parentElement;
          }
          return 'rgb(255, 255, 255)';
        };
        return [...document.querySelectorAll('a')]
          .filter((a) => /car-detailing-|#areas/.test(a.getAttribute('href') || ''))
          .filter((a) => {
            const cs = getComputedStyle(a);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && a.getClientRects().length > 0;
          })
          .map((a) => {
            const fg = getComputedStyle(a).color;
            const bg = bgOf(a);
            return {
              text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
              href: a.getAttribute('href'),
              contrast: Math.round(contrast(fg, bg) * 100) / 100,
              w: a.getBoundingClientRect().width,
            };
          });
      });
      for (const link of found) {
        if (!link.text || link.contrast < 4.5 || link.w < 4) bad.push({ file, ...link });
      }
    }
    check(
      `area-link-contrast-${width}`,
      bad.length === 0 && errors.length === 0,
      JSON.stringify(bad.slice(0, 4)),
    );
    await browser.close();
  }

  // ========== 7b) Service-area suburbs: exactly 3 per row, no overflow ==========
  const SUBURB_WIDTHS = [320, 360, 375, 390, 414, 430, 640, 768, 1024, 1280, 1440];
  for (const width of SUBURB_WIDTHS) {
    ({ browser, page, errors } = await launch({
      width,
      height: width >= 1024 ? 1100 : 900,
    }));
    const suburb = await page.evaluate(() => {
      const lists = [...document.querySelectorAll('#areas .suburb-list')];
      const problems = [];
      if (lists.length !== 7) problems.push('lists ' + lists.length);
      lists.forEach((ul, i) => {
        const items = [...ul.querySelectorAll(':scope > li')];
        if (items.length !== 6) problems.push(`list${i} count ${items.length}`);
        const rows = [];
        items.forEach((li) => {
          const chip = li.querySelector('.suburb-chip');
          const top = Math.round(li.getBoundingClientRect().top);
          let row = rows.find((r) => Math.abs(r.top - top) < 3);
          if (!row) {
            row = { top, n: 0 };
            rows.push(row);
          }
          row.n += 1;
          const text = (chip?.innerText || '').replace(/\s+/g, ' ').trim();
          if (!chip) {
            problems.push('no chip');
            return;
          }
          if (chip.scrollWidth > chip.clientWidth + 1) {
            problems.push(`overflow ${text} ${chip.scrollWidth}>${chip.clientWidth}`);
          }
          const br = chip.getBoundingClientRect();
          const ur = ul.getBoundingClientRect();
          if (br.left < ur.left - 1 || br.right > ur.right + 1) problems.push('clip ' + text);
          if (br.height < 24 || br.width < 36) problems.push('tiny ' + text);
          if (!text) problems.push('empty chip');
        });
        const sig = rows.map((r) => r.n).join('+');
        if (sig !== '3+3') problems.push(`list${i} rows ${sig}`);
      });
      const doc = document.documentElement;
      return {
        problems,
        pageOverflow: doc.scrollWidth - doc.clientWidth,
      };
    });
    check(
      `suburbs-3-per-row-${width}`,
      suburb.problems.length === 0 && suburb.pageOverflow <= 1 && errors.length === 0,
      JSON.stringify({
        problems: suburb.problems,
        pageOverflow: suburb.pageOverflow,
        errors: errors.slice(0, 3),
      }),
    );
    await browser.close();
  }

  // ========== 8) Footer / links + mobile overflow ==========
  ({ browser, page, errors } = await launch({ width: 390, height: 844 }));
  const foot = await page.evaluate(() => {
    const abn = document.querySelector(
      'a[href*="abr.business.gov.au/ABN/View/91191146339"]',
    );
    const credit = document.querySelector('a[href*="skytech"]');
    const ov = {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    };
    return {
      abnText: abn?.textContent?.trim() || null,
      abnHref: abn?.getAttribute('href') || null,
      creditText: credit?.textContent?.trim() || null,
      creditHref: credit?.getAttribute('href') || null,
      overflow: ov.sw - ov.cw,
    };
  });
  check(
    'footer-abn',
    /ABN 91 191 146 339/.test(foot.abnText || '') &&
      /91191146339/.test(foot.abnHref || ''),
    JSON.stringify(foot),
  );
  check(
    'footer-credit',
    /Skytech Labs/i.test(foot.creditText || '') && !!foot.creditHref,
    JSON.stringify({ t: foot.creditText, h: foot.creditHref }),
  );
  check(
    'mobile-no-h-overflow',
    foot.overflow <= 1,
    `overflow=${foot.overflow}`,
  );
  check(
    'mobile-footer-console',
    errors.length === 0,
    JSON.stringify(errors.slice(0, 5)),
  );
  await browser.close();

  // ========== 9) SMS link per device: Android ?body=, iPhone ?&body= ==========
  const UAS = {
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    iphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  };
  for (const [dev, ua] of Object.entries(UAS)) {
    ({ browser, page, errors } = await launch({ width: 390, height: 844 }, ua));
    const sep = dev === 'android' ? '?body=' : '?&body=';
    const navSms = await page.evaluate(
      () => document.querySelector('#nav a[href^="sms:"]')?.getAttribute('href') || '',
    );
    check(
      `${dev}-nav-sms-href`,
      navSms.startsWith('sms:0429654427' + sep + 'Hi%20Driveway') &&
        (dev !== 'android' || !navSms.includes('?&body=')),
      navSms.slice(0, 90),
    );
    await page.locator('#booking-form').scrollIntoViewIfNeeded();
    await fillContact(page, "Siobhán O'Neill");
    await clearPackagesQuotes(page);
    await selectRadio(page, 'vehicletype', 'data-size', 'suv');
    await selectRadio(page, 'package', 'data-pkg', 'gold');
    await selectCheckbox(page, 'addons', 'Pet Hair Removal (from $40)');
    await page.click('#booking-form button[type="submit"]');
    await page.waitForSelector('#form-success:not(.hidden)', { timeout: 8000 }).catch(() => {});
    const dv = await page.evaluate(() => ({
      preview: document.getElementById('sms-preview')?.textContent || '',
      sms: document.getElementById('open-sms')?.getAttribute('href') || '',
      wa: document.getElementById('open-wa')?.getAttribute('href') || '',
    }));
    check(
      `${dev}-submit-sms-href-exact`,
      dv.preview.length > 50 &&
        dv.sms === 'sms:0429654427' + sep + encodeURIComponent(dv.preview) &&
        (dev !== 'android' || !dv.sms.includes('?&body=')),
      dv.sms.slice(0, 100),
    );
    check(
      `${dev}-sms-body-roundtrip`,
      decodeURIComponent(dv.sms.split('body=')[1] || '') === dv.preview &&
        /Gold – Standard Detail/.test(dv.preview) &&
        /Siobhán O'Neill/.test(dv.preview) &&
        /Pet Hair Removal \(from \$40\)/.test(dv.preview),
      dv.preview.slice(0, 120),
    );
    check(
      `${dev}-wa-href-unchanged`,
      dv.wa === 'https://wa.me/61429654427?text=' + encodeURIComponent(dv.preview),
      dv.wa.slice(0, 90),
    );
    // live preview refresh keeps the device format
    await page.fill('#f-suburb', 'Umina Beach');
    await page.waitForTimeout(150);
    const live = await page.evaluate(() => ({
      preview: document.getElementById('sms-preview')?.textContent || '',
      sms: document.getElementById('open-sms')?.getAttribute('href') || '',
    }));
    check(
      `${dev}-live-preview-sms-href`,
      /Umina Beach/.test(live.preview) &&
        live.sms === 'sms:0429654427' + sep + encodeURIComponent(live.preview),
      live.sms.slice(0, 100),
    );
    check(`${dev}-no-console-errors`, errors.length === 0, JSON.stringify(errors.slice(0, 3)));
    await browser.close();
  }

  // Write report
  report.finished = new Date().toISOString();
  report.passed = report.checks.filter((c) => c.pass).length;
  report.failed = report.checks.filter((c) => !c.pass).length;
  writeFileSync(
    path.join(OUT, 'regression-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    '\n=== RESULT',
    report.ok ? 'PASS' : 'FAIL',
    `${report.passed}/${report.checks.length} ===`,
  );
  if (staticServer) staticServer.close();
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
