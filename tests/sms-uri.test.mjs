/**
 * Unit tests for assets/enquiry-utils.js (SMS deep links), Node built-ins only.
 *   node --test tests/sms-uri.test.mjs
 *
 * The helper is a classic browser script (UMD), so it is evaluated with `vm`
 * exactly as the browser would see it (a `window` global), and once more in a
 * CommonJS-style sandbox (`module.exports`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'assets/enquiry-utils.js'), 'utf8');

function loadAsBrowser() {
  const window = {};
  vm.runInNewContext(SRC, { window }, { filename: 'enquiry-utils.js' });
  return window.DDEnquiry;
}
function loadAsCommonJs() {
  const module = { exports: {} };
  vm.runInNewContext(SRC, { module, exports: module.exports }, { filename: 'enquiry-utils.js' });
  return module.exports;
}

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};
const PHONE = '0429654427';
// A realistic message as built by the booking form (newlines, apostrophes, $, en dash, unicode).
const MSG = [
  "Hi Driveway Detailing team, I'd like to book the Gold – Standard Detail for my Small SUV / Wagon.",
  '',
  "Name: Siobhán O'Neill",
  'Phone: 0412 345 678',
  'Suburb: Umina Beach',
  'Add-ons: Pet Hair Removal (from $40), Carpet & Floor Mat Shampoo (from $50)',
  'Notes: dog hair 🐶 + 50% stains?',
  '',
  'Thanks',
  'Siobhán',
].join('\n');

const api = loadAsBrowser();

test('loads as a browser global and as CommonJS, same API', () => {
  assert.equal(typeof api.buildSmsUri, 'function');
  const cjs = loadAsCommonJs();
  assert.equal(typeof cjs.buildSmsUri, 'function');
  assert.equal(cjs.buildSmsUri(PHONE, 'x', UA.androidChrome), api.buildSmsUri(PHONE, 'x', UA.androidChrome));
});

test('Android Chrome gets the standard ?body= form (no ?&body=)', () => {
  const uri = api.buildSmsUri(PHONE, MSG, UA.androidChrome);
  assert.equal(uri, 'sms:0429654427?body=' + encodeURIComponent(MSG));
  assert.ok(!uri.includes('?&body='), 'Android URI must not contain ?&body=');
  assert.ok(uri.startsWith('sms:0429654427?body=Hi%20Driveway'));
});

test('Samsung Internet (Android) also gets ?body=', () => {
  assert.equal(api.buildSmsUri(PHONE, 'Hi', UA.samsung), 'sms:0429654427?body=Hi');
});

test('the old Android URI is reproduced and rejected', () => {
  const oldAndroid = `sms:${PHONE}?&body=${encodeURIComponent(MSG)}`; // what the site used to send
  assert.notEqual(api.buildSmsUri(PHONE, MSG, UA.androidChrome), oldAndroid);
});

test('iPhone Safari keeps the existing, working ?&body= form exactly', () => {
  const uri = api.buildSmsUri(PHONE, MSG, UA.iphoneSafari);
  assert.equal(uri, `sms:${PHONE}?&body=${encodeURIComponent(MSG)}`);
  assert.equal(api.buildSmsUri(PHONE, 'Hi', UA.ipad), 'sms:0429654427?&body=Hi');
});

test('desktop and unknown/undefined user agents fall back to ?body=', () => {
  assert.equal(api.buildSmsUri(PHONE, 'Hi there', UA.desktopChrome), 'sms:0429654427?body=Hi%20there');
  assert.equal(api.buildSmsUri(PHONE, 'Hi there', undefined), 'sms:0429654427?body=Hi%20there');
  assert.equal(api.buildSmsUri(PHONE, 'Hi there'), 'sms:0429654427?body=Hi%20there');
  assert.equal(api.smsPlatform(undefined), 'other');
  assert.equal(api.smsPlatform(UA.androidChrome), 'android');
  assert.equal(api.smsPlatform(UA.iphoneSafari), 'ios');
});

test('body round-trips exactly: newlines, apostrophes, $, en dash, accents, emoji', () => {
  for (const ua of [UA.androidChrome, UA.iphoneSafari, undefined]) {
    const uri = api.buildSmsUri(PHONE, MSG, ua);
    const body = decodeURIComponent(uri.split('body=')[1]);
    assert.equal(body, MSG);
    assert.ok(body.includes('\n\nName: Siobhán'));
    assert.ok(!/[\n ]/.test(uri), 'raw newlines/spaces must be percent-encoded');
    assert.ok(uri.includes('%0A') && uri.includes('%24') && uri.includes("I'd"));
  }
});

test('phone number is used as given (same digits, no country code added)', () => {
  assert.ok(api.buildSmsUri(PHONE, 'x', UA.androidChrome).startsWith('sms:0429654427?'));
  assert.ok(api.buildSmsUri('0429 654 427', 'x', UA.androidChrome).startsWith('sms:0429654427?'));
  assert.ok(!api.buildSmsUri(PHONE, 'x', UA.androidChrome).includes('+61'));
});

test('empty body gives a plain sms: link to the default app', () => {
  assert.equal(api.buildSmsUri(PHONE, '', UA.androidChrome), 'sms:0429654427');
  assert.equal(api.buildSmsUri(PHONE, null, UA.iphoneSafari), 'sms:0429654427');
});

test('normalizeSmsHref re-targets the static iPhone-form nav link', () => {
  const nav = "sms:0429654427?&body=Hi%20Driveway%20Detailing%20team%2C%20I'd%20like%20to%20enquire%20about%20getting%20my%20car%20detailed.%20";
  const text = "Hi Driveway Detailing team, I'd like to enquire about getting my car detailed. ";
  assert.equal(api.normalizeSmsHref(nav, UA.androidChrome), 'sms:0429654427?body=' + encodeURIComponent(text));
  assert.equal(api.normalizeSmsHref(nav, UA.iphoneSafari), nav);
  assert.equal(api.normalizeSmsHref('sms:0429654427', UA.androidChrome), 'sms:0429654427');
  assert.equal(api.normalizeSmsHref('tel:0429654427', UA.androidChrome), 'tel:0429654427');
  assert.equal(api.normalizeSmsHref('sms:0429654427?&body=%E0%A4%A', UA.androidChrome), 'sms:0429654427?&body=%E0%A4%A', 'bad encoding left untouched');
});

test('homepage wires every SMS path through the helper', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scriptTag = '<script src="./assets/enquiry-utils.js"></script>';
  assert.equal(html.split(scriptTag).length - 1, 1, 'helper loaded exactly once');
  const mainScript = html.indexOf('// ---------- Mobile menu ----------');
  assert.ok(html.indexOf(scriptTag) < mainScript, 'helper loads before the main script');
  assert.ok(!/`sms:\$\{PHONE_LOCAL\}\?&body=/.test(html), 'no hard-coded ?&body= template left');
  assert.ok((html.match(/smsHref\(body\)/g) || []).length >= 2, 'submit + live preview use smsHref');
  assert.ok(html.includes('window.DDEnquiry.buildSmsUri(PHONE_LOCAL, body, navigator.userAgent)'));
  assert.ok(html.includes('window.DDEnquiry.normalizeSmsHref('));
  // WhatsApp link format untouched
  assert.ok(html.includes('const waUrl = `https://wa.me/${PHONE_INTL}?text=${encoded}`;'));
});
