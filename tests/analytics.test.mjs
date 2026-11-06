/**
 * GA4 + Clarity installation and event-guard unit tests (Node built-ins only).
 *
 * Run: node --test tests/analytics.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const PUBLIC = [
  'index.html',
  'car-detailing-western-sydney.html',
  'car-detailing-blue-mountains.html',
  'car-detailing-central-coast.html',
];
const EXCLUDED = ['404.html', 'googleb08830c1e73b6c39.html'];
const MEASUREMENT = 'G-CRXCQ78F53';
const CLARITY = 'z9d9xk3est';

const analyticsSrc = read('assets/analytics.js');

function loadAnalytics() {
  const window = {};
  const module = { exports: {} };
  vm.runInNewContext(analyticsSrc, { window, module }, { filename: 'assets/analytics.js' });
  assert.equal(window.DDAnalytics, module.exports);
  return { window, api: module.exports };
}

function count(hay, needle) {
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

test('public pages install one direct gtag snippet and one Clarity snippet', () => {
  assert.deepEqual(htmlFiles.filter((f) => PUBLIC.includes(f)).sort(), [...PUBLIC].sort());
  for (const file of PUBLIC) {
    const html = read(file);
    assert.equal(count(html, `googletagmanager.com/gtag/js?id=${MEASUREMENT}`), 1, file);
    assert.equal(count(html, MEASUREMENT), 2, file + ' id should appear in src and config only');
    assert.equal(count(html, `gtag('config', '${MEASUREMENT}')`), 1, file);
    assert.equal(html.includes(`gtag('config', '${MEASUREMENT}',`), false, file + ' must not override config');
    assert.equal(html.includes('send_page_view'), false, file);
    assert.equal(count(html, 'function gtag(){dataLayer.push(arguments);}'), 1, file);
    assert.equal(count(html, "gtag('js', new Date());"), 1, file);
    assert.equal(count(html, `clarity.ms/tag/"+i`), 1, file);
    assert.equal(count(html, CLARITY), 1, file);
    assert.equal(count(html, 'src="./assets/analytics.js"'), 1, file);
    assert.equal(html.includes('googletagmanager.com/gtm.js'), false, file);
    assert.equal(html.includes('GTM-'), false, file);
    assert.equal(/unmask|data-clarity-mask\s*=\s*"false"/i.test(html), false, file);
  }
});

test('404 and the verification file are not measured', () => {
  for (const file of EXCLUDED) {
    const html = read(file);
    assert.equal(html.includes(MEASUREMENT), false, file);
    assert.equal(html.includes(CLARITY), false, file);
    assert.equal(html.includes('analytics.js'), false, file);
    assert.equal(html.includes('googletagmanager.com'), false, file);
    assert.equal(html.includes('clarity.ms'), false, file);
    assert.equal(html.includes('GTM-'), false, file);
  }
  const extras = htmlFiles.filter((f) => !PUBLIC.includes(f) && !EXCLUDED.includes(f));
  assert.deepEqual(extras, [], 'unexpected html page: ' + extras.join(','));
});

test('analytics helper does not configure a container or unmask Clarity', () => {
  assert.equal(analyticsSrc.includes('GTM-'), false);
  assert.equal(analyticsSrc.includes('gtag/js'), false);
  assert.equal(analyticsSrc.includes("gtag('config'"), false);
  assert.equal(/unmask|clarity\(/i.test(analyticsSrc), false);
  assert.equal(analyticsSrc.includes('finally'), false);
});

test('booking SMS launch is guarded and still assigns the sms url', () => {
  const html = read('index.html');
  const start = html.indexOf("onPreparedSmsLaunch('booking_sms')");
  const slice = html.slice(Math.max(0, start - 250), start + 500);
  assert.match(slice, /try \{[\s\S]*onPreparedSmsLaunch\('booking_sms'\)[\s\S]*\} catch \(err\) \{[\s\S]*\}[\s\S]*window\.location\.href = smsUrl;/);
  assert.equal(count(html, 'window.location.href = smsUrl;'), 1);
  assert.equal(count(html, "onPreparedSmsLaunch('booking_sms')"), 1);
});

test('from-prices in analytics match the homepage PRICES table', () => {
  const { api } = loadAnalytics();
  const pricesSrc = (read('index.html').match(/const PRICES = (\{[\s\S]*?\});/) || [])[1];
  const prices = Function(`return (${pricesSrc})`)();
  assert.equal(JSON.stringify(api.PRICES), JSON.stringify(prices));
});

test('lead params distinguish confirmed packages from custom enquiries and drop PII', () => {
  const { api } = loadAnalytics();
  const confirmed = api.leadParams({
    packageLabel: 'Silver – Basic Detail',
    packageId: 'silver',
    vehicleSize: 'suv',
    addons: ['Engine Bay Rinse (from $60)'],
    quotes: [],
    name: 'LeadSentinelzz',
    phone: '0499888777',
    suburb: 'Sentinelvillezz',
    date: '2031-04-09',
    message: 'sentinel-message-do-not-send',
    email: 'secret@example.com',
  }, 'booking_sms');
  assert.equal(confirmed.lead_type, 'package');
  assert.equal(confirmed.enquiry_kind, 'confirmed_package');
  assert.equal(confirmed.package_id, 'silver');
  assert.equal(confirmed.vehicle_size, 'suv');
  assert.equal(confirmed.addon_count, 1);
  assert.equal(confirmed.addon_ids, 'engine_bay_rinse');
  assert.equal(confirmed.currency, 'AUD');
  assert.equal(confirmed.value, 149);
  assert.equal(confirmed.method, 'sms');
  assert.equal(confirmed.source, 'booking_sms');

  const withQuote = api.leadParams({
    packageLabel: 'Gold – Standard Detail',
    packageId: 'gold',
    vehicleSize: 'hatch',
    addons: [],
    quotes: ['Odour Removal'],
  }, 'booking_sms');
  assert.equal(withQuote.enquiry_kind, 'confirmed_package_with_custom_quote');
  assert.equal(withQuote.lead_type, 'package');
  assert.equal(withQuote.quote_ids, 'odour_removal');
  assert.equal(withQuote.value, 249);

  const custom = api.leadParams({
    packageLabel: 'General enquiry',
    packageId: 'general_enquiry',
    vehicleSize: '',
    addons: [],
    quotes: ['Paint Protection (Ceramic Coating)'],
    name: 'LeadSentinelzz',
    phone: '0499888777',
  }, 'booking_sms');
  assert.equal(custom.lead_type, 'custom_enquiry');
  assert.equal(custom.enquiry_kind, 'custom_enquiry');
  assert.equal(custom.package_id, 'general_enquiry');
  assert.equal(custom.vehicle_size, 'unspecified');
  assert.equal(custom.quote_ids, 'paint_protection');
  assert.equal('value' in custom, false);
  assert.equal('currency' in custom, false);

  const blob = JSON.stringify({ confirmed, withQuote, custom });
  for (const secret of ['LeadSentinelzz', '0499888777', 'Sentinelvillezz', '2031-04-09', 'sentinel-message-do-not-send', 'secret@example.com', 'from $60']) {
    assert.equal(blob.includes(secret), false, secret);
  }
});

test('scrubber removes PII keys and phone or email values', () => {
  const { api } = loadAnalytics();
  const clean = api.scrubParams({
    package_id: 'silver',
    name: 'A Person',
    phone: '0412345678',
    email: 'a@b.co',
    message: 'hello',
    address: '1 High St',
    suburb: 'Auburn',
    date: '2031-04-09',
    notes: 'pet hair',
    body: 'sms body',
    value: 129,
    addon_ids: '0412345678',
    quote_ids: 'odour_removal',
  });
  assert.equal(JSON.stringify(clean), JSON.stringify({ package_id: 'silver', value: 129, quote_ids: 'odour_removal' }));
});

test('generate_lead is once per inquiry marker, including repeated book taps', () => {
  const { window, api } = loadAnalytics();
  const seen = [];
  window.gtag = (kind, name, params) => {
    if (kind === 'event') seen.push({ name, params });
  };
  const snap = {
    packageLabel: 'Interior Detail',
    packageId: 'interior',
    vehicleSize: 'large',
    addons: ['Pet Hair Removal (from $40)'],
    quotes: [],
  };
  const first = api.trackLead(snap, 'booking_sms');
  const second = api.trackLead(snap, 'booking_sms');
  assert.equal(first.duplicate, false);
  assert.equal(first.sent, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.sent, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'generate_lead');
  assert.equal(seen[0].params.value, 239);
  assert.equal(seen[0].params.package_id, 'interior');

  const changed = { ...snap, packageId: 'diamond', packageLabel: 'Diamond – Ultimate Detail' };
  const third = api.trackLead(changed, 'booking_sms');
  assert.equal(third.duplicate, false);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].params.package_id, 'diamond');
  assert.equal(seen[1].params.value, 999);

  const nav1 = api.trackLead({
    packageLabel: 'General enquiry',
    packageId: 'general_enquiry',
    vehicleSize: '',
    addons: [],
    quotes: [],
  }, 'nav_sms');
  const nav2 = api.trackLead({
    packageLabel: 'General enquiry',
    packageId: 'general_enquiry',
    vehicleSize: 'hatch',
    addons: ['Child Seat Clean (from $50)'],
    quotes: ['Odour Removal'],
  }, 'nav_sms');
  assert.equal(nav1.duplicate, false);
  assert.equal(nav2.duplicate, true, 'nav SMS taps share one marker');
  assert.equal(nav1.params.source, 'nav_sms');
  assert.equal(nav1.params.lead_type, 'custom_enquiry');
  assert.equal('value' in nav1.params, false);
  assert.equal(seen.length, 3);
});

test('a throwing or missing gtag does not throw', () => {
  const { window, api } = loadAnalytics();
  api.resetForTests();
  window.gtag = () => { throw new Error('analytics blocked'); };
  const snap = { packageLabel: 'Silver – Basic Detail', packageId: 'silver', vehicleSize: 'hatch', addons: [], quotes: [] };
  assert.doesNotThrow(() => {
    const result = api.trackLead(snap, 'booking_sms');
    assert.equal(result.sent, false);
    assert.equal(result.duplicate, false);
  });
  window.gtag = undefined;
  api.resetForTests();
  assert.equal(api.safeGtag('generate_lead', { package_id: 'silver' }), false);
  assert.equal(api.trackLead(snap, 'booking_sms').sent, false);
});

test('selection debounce and booking start do not invent extra events', () => {
  const { api } = loadAnalytics();
  assert.equal(api.allowEvent('select_addon:engine_bay_rinse', 400, 1000), true);
  assert.equal(api.allowEvent('select_addon:engine_bay_rinse', 400, 1200), false);
  assert.equal(api.allowEvent('select_addon:engine_bay_rinse', 400, 1400), true);
  assert.equal(api.allowEvent('select_package:gold', 400, 1200), true);
  assert.equal(api.composedSmsHref('sms:0429654427'), false);
  assert.equal(api.composedSmsHref('sms:0429654427?body=Hi'), true);
  assert.equal(api.composedSmsHref('sms:0429654427?&body=Hi'), true);
  const marker = api.inquiryMarker({
    packageId: 'silver',
    packageLabel: 'Silver – Basic Detail',
    vehicleSize: 'hatch',
    addons: ['Pet Hair Removal (from $40)', 'Engine Bay Rinse (from $60)'],
    quotes: [],
    name: 'LeadSentinelzz',
    phone: '0499888777',
  }, 'booking_sms');
  assert.equal(marker.includes('LeadSentinelzz'), false);
  assert.equal(marker.includes('0499888777'), false);
  assert.equal(marker, 'booking|silver|hatch|engine_bay_rinse+pet_hair_removal|');
});

test('install binds click and change once', () => {
  const { api } = loadAnalytics();
  const listeners = [];
  const doc = {
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    getElementById() { return null; },
  };
  assert.equal(api.install(doc), true);
  assert.equal(api.install(doc), false);
  assert.deepEqual(listeners.map((l) => l.type), ['click', 'change']);
  assert.equal(listeners.every((l) => l.capture === true), true);
});
