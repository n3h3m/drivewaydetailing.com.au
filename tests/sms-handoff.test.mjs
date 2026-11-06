/**
 * Booking success SMS handoff.
 *
 * Loads buildMessage and bookingSmsHref from index.html and checks the
 * Android (?body=) and iPhone (?&body=) links for the recorded enquiry.
 * Destination is the business mobile 0429654427. This does not open
 * Google Messages or any other native SMS app.
 *
 * Run: node --test tests/sms-handoff.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extract(start, end) {
  const s = html.indexOf(start);
  const e = html.indexOf(end, s + start.length);
  assert.notEqual(s, -1, 'missing ' + start);
  assert.notEqual(e, -1, 'missing ' + end);
  return html.slice(s + start.length, e);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  `${extract('/* booking-message-body */', '/* /booking-message-body */')}
${extract('/* booking-sms-href */', '/* /booking-sms-href */')}
globalThis.buildMessage = buildMessage;
globalThis.bookingSmsHref = bookingSmsHref;`,
  sandbox,
);

const { buildMessage, bookingSmsHref } = sandbox;

const PHONE = '0429654427';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Mobile Safari/537.36';
const ANDROID_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const enquiry = {
  name: 'Nehemiah Jacob',
  phone: '+61430063080',
  suburb: 'Berala',
  vehicletype: 'Small SUV / Wagon',
  package: 'Interior Detail',
  date: '',
  addons: ['Engine Bay Rinse (from $60)'],
  quoteservices: [],
  message: '',
};

const EXPECTED_BODY = [
  "Hi Driveway Detailing team, I'd like to book the Interior Detail for my Small SUV / Wagon.",
  '',
  'Name: Nehemiah Jacob',
  'Phone: +61430063080',
  'Suburb: Berala',
  'Add-ons: Engine Bay Rinse (from $60)',
  '',
  'Thanks',
  'Nehemiah',
].join('\n');

function hrefFor(userAgent) {
  return bookingSmsHref(PHONE, buildMessage(enquiry), userAgent);
}

function roundTrip(href, separator) {
  const prefix = `sms:${PHONE}${separator}`;
  assert.equal(href.slice(0, prefix.length), prefix);
  const decoded = decodeURIComponent(href.slice(prefix.length));
  assert.equal(decoded, EXPECTED_BODY);
  assert.equal(href, `sms:${PHONE}${separator}${encodeURIComponent(EXPECTED_BODY)}`);
  return decoded;
}

test('recorded enquiry body keeps newlines, apostrophe, package, add-on, customer, and suburb', () => {
  const body = buildMessage(enquiry);
  assert.equal(body, EXPECTED_BODY);
  assert.equal(body.includes('\n'), true);
  assert.equal(body.split('\n').length, 9);
  assert.equal(body.includes("I'd"), true);
  assert.equal(body.includes('Interior Detail'), true);
  assert.equal(body.includes('Small SUV / Wagon'), true);
  assert.equal(body.includes('Nehemiah Jacob'), true);
  assert.equal(body.includes('+61430063080'), true);
  assert.equal(body.includes('Berala'), true);
  assert.equal(body.includes('Engine Bay Rinse (from $60)'), true);
  assert.equal(body.endsWith('Thanks\nNehemiah'), true);
});

test('Android Chrome sms link uses ?body= to 0429654427 and round-trips the body', () => {
  const href = hrefFor(ANDROID_CHROME);
  const body = roundTrip(href, '?body=');
  assert.equal(href.includes('?&body='), false);
  assert.equal(href.indexOf('?body='), `sms:${PHONE}`.length);
  assert.equal(body.includes("I'd"), true);
  assert.equal(href.includes("I'd"), true);
  assert.equal(href.includes('%0A'), true);
  assert.equal(href.includes('%2B61430063080'), true);
  assert.equal((href.match(/%0A/g) || []).length, EXPECTED_BODY.split('\n').length - 1);
});

test('Android Samsung sms link uses the same ?body= separator', () => {
  const href = hrefFor(ANDROID_SAMSUNG);
  roundTrip(href, '?body=');
  assert.equal(href.includes('?&body='), false);
});

test('iPhone sms link keeps ?&body= to 0429654427 and round-trips the body', () => {
  const href = hrefFor(IPHONE_SAFARI);
  const body = roundTrip(href, '?&body=');
  assert.equal(href.includes('?body='), false);
  assert.equal(href.indexOf('?&body='), `sms:${PHONE}`.length);
  assert.equal(body.includes("I'd"), true);
  assert.equal(href.includes("I'd"), true);
  assert.equal(href.includes('%0A'), true);
  assert.equal(body.includes('Interior Detail'), true);
  assert.equal(body.includes('Engine Bay Rinse (from $60)'), true);
  assert.equal(body.includes('Nehemiah Jacob'), true);
  assert.equal(body.includes('Berala'), true);
});

test('word Android inside the message does not change the iPhone separator', () => {
  const body = buildMessage({
    ...enquiry,
    message: "Android note: please don't skip the mats.",
  });
  assert.equal(body.includes('Android'), true);
  assert.equal(body.includes("don't"), true);
  const href = bookingSmsHref(PHONE, body, IPHONE_SAFARI);
  const prefix = `sms:${PHONE}?&body=`;
  assert.equal(href.slice(0, prefix.length), prefix);
  assert.equal(href.includes('?body='), false);
  assert.equal(decodeURIComponent(href.slice(prefix.length)), body);
});

test('desktop Chrome keeps the existing ?&body= link the booking regression expects', () => {
  const href = hrefFor(DESKTOP_CHROME);
  roundTrip(href, '?&body=');
  assert.equal(href.startsWith('sms:0429654427?&body='), true);
});

test('booking success paths call bookingSmsHref and WhatsApp text links stay', () => {
  assert.equal(html.includes("const PHONE_LOCAL = '0429654427';"), true);
  assert.equal(
    html.split('bookingSmsHref(PHONE_LOCAL, body, navigator.userAgent)').length - 1,
    2,
  );
  assert.equal(html.includes('window.location.href = smsUrl;'), true);
  assert.equal(html.includes('sms:${PHONE_LOCAL}?&body='), false);
  assert.equal(html.includes('?&body=${encoded}'), false);
  assert.equal(html.includes('sms:${PHONE_LOCAL}?body='), false);
  assert.equal(
    html.includes('const waUrl = `https://wa.me/${PHONE_INTL}?text=${encoded}`;'),
    true,
  );
  assert.equal(
    html.includes(
      "document.getElementById('open-wa').setAttribute('href', `https://wa.me/${PHONE_INTL}?text=${encoded}`)",
    ),
    true,
  );
});
