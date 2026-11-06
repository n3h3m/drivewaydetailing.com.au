/**
 * Static SEO checks (Node built-ins only, no browser).
 *
 *   node tests/seo-static.mjs            # check the repo this file lives in
 *   node tests/seo-static.mjs --root=DIR # check another checkout / build
 *
 * Covers: title/description/canonical/OG per indexable page, one <h1> and one
 * <main>, heading order, JSON-LD validity and "no invented facts" (no ratings,
 * reviews, geo, street address, email), a single LocalBusiness node shared by
 * @id, sitemap <-> indexable pages, robots.txt, internal links + #fragments,
 * image files/alt/size attributes, prices on area pages vs homepage PRICES,
 * and no runtime Tailwind CDN.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argRoot = (process.argv.find((a) => a.startsWith('--root=')) || '').slice(7);
const ROOT = path.resolve(argRoot || path.join(__dirname, '..'));
const SITE = 'https://drivewaydetailing.com.au';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : String(detail).slice(0, 300));
}

const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : null;
};
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const meta = (html, key, val) =>
  tags(html, 'meta').find((t) => (attr(t, key) || '').toLowerCase() === val.toLowerCase());
const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&rsquo;/g, '’').replace(/&middot;/g, '·').replace(/&quot;/g, '"');
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const noScripts = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const pages = {};
for (const f of htmlFiles) pages[f] = read(f);
const idsOf = (html) =>
  new Set((noScripts(html).match(/\sid="([^"]+)"/g) || []).map((m) => m.slice(5, -1)));

// ---------- per-page head / structure ----------
const isNoindex = (html) => /noindex/i.test(attr(meta(html, 'name', 'robots') || '', 'content') || '');
const isVerification = (f) => /^google[0-9a-f]+\.html$/i.test(f) || /^BingSiteAuth/i.test(f);
const indexable = htmlFiles.filter((f) => !isVerification(f) && !isNoindex(pages[f]));
const canonicals = {};
const ldNodes = [];

check('has-index-and-404', htmlFiles.includes('index.html') && htmlFiles.includes('404.html'));
check('404-is-noindex', pages['404.html'] && isNoindex(pages['404.html']));

for (const f of indexable) {
  const html = pages[f];
  const body = noScripts(html);
  const t = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  const title = t ? stripTags(t) : '';
  check(`${f}: title 25-65 chars`, title.length >= 25 && title.length <= 65, title);
  check(`${f}: one <title>`, (html.match(/<title>/gi) || []).length === 1);
  const desc = decode(attr(meta(html, 'name', 'description') || '', 'content') || '');
  check(`${f}: description 120-165 chars`, desc.length >= 120 && desc.length <= 165, `${desc.length}: ${desc}`);
  check(`${f}: lang en-AU`, /<html lang="en-AU">/.test(html));
  const canTags = tags(html, 'link').filter((l) => attr(l, 'rel') === 'canonical');
  const can = canTags[0] ? attr(canTags[0], 'href') : '';
  check(`${f}: one absolute canonical`, canTags.length === 1 && can.startsWith(SITE + '/'), can);
  const expected = f === 'index.html' ? `${SITE}/` : `${SITE}/${f}`;
  check(`${f}: canonical points at itself`, can === expected, `${can} != ${expected}`);
  canonicals[f] = can;
  const og = (p) => attr(meta(html, 'property', p) || '', 'content') || '';
  check(`${f}: og:url = canonical`, og('og:url') === can, og('og:url'));
  check(`${f}: og:image absolute`, og('og:image').startsWith(SITE + '/') && !og('og:image').includes('#'), og('og:image'));
  check(`${f}: og:locale en_AU`, og('og:locale') === 'en_AU');
  const img = og('og:image').replace(SITE + '/', '');
  check(`${f}: og:image file exists`, existsSync(path.join(ROOT, img)), img);
  check(`${f}: og image dims`, og('og:image:width') && og('og:image:height'));
  check(`${f}: twitter card`, !!meta(html, 'name', 'twitter:card') && !!meta(html, 'name', 'twitter:image'));
  const h1s = body.match(/<h1\b[\s\S]*?<\/h1>/gi) || [];
  check(`${f}: exactly one <h1>`, h1s.length === 1, h1s.length);
  check(`${f}: h1 mentions car detailing + place`, h1s[0] && /car detailing/i.test(stripTags(h1s[0])) && /(Sydney|Blue Mountains|Central Coast)/.test(stripTags(h1s[0])), h1s[0] && stripTags(h1s[0]));
  check(`${f}: one <main>`, (body.match(/<main\b/gi) || []).length === 1 && /<\/main>/.test(body));
  const mainHtml = (body.match(/<main\b[\s\S]*<\/main>/i) || [''])[0];
  check(`${f}: h1 inside <main>`, h1s[0] && mainHtml.includes(h1s[0]));
  // heading order: never skip a level going deeper
  const levels = (body.match(/<h[1-6]\b/gi) || []).map((h) => +h[2]);
  let bad = null;
  levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1 && !bad) bad = `${levels[i - 1]}->${l} at #${i}`; });
  check(`${f}: heading levels do not skip`, !bad && levels[0] === 1, bad || levels.slice(0, 5));
  // no keyword-stuffed headings (many commas)
  const stuffed = (body.match(/<h[1-3]\b[\s\S]*?<\/h[1-3]>/gi) || []).map(stripTags).filter((h) => (h.match(/,/g) || []).length >= 3);
  check(`${f}: no comma-stuffed headings`, stuffed.length === 0, stuffed);
  check(`${f}: no runtime Tailwind CDN`, !/cdn\.tailwindcss\.com/.test(html));
  check(`${f}: uses built site.css`, /href="\.\/assets\/site\.css"/.test(html));
  check(`${f}: no Google Fonts request`, !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html));
  check(`${f}: tel link`, /href="tel:0429654427"/.test(html));
  // JSON-LD
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  check(`${f}: has JSON-LD`, blocks.length >= 1);
  for (const b of blocks) {
    let data = null;
    try { data = JSON.parse(b); } catch (e) { check(`${f}: JSON-LD parses`, false, e.message); continue; }
    check(`${f}: JSON-LD parses`, true);
    const graph = data['@graph'] || [data];
    graph.forEach((n) => ldNodes.push({ f, n }));
    const s = JSON.stringify(data);
    for (const k of ['aggregateRating', '"review"', '"geo"', 'latitude', 'longitude', 'streetAddress', 'postalCode', '"email"', 'ratingValue']) {
      check(`${f}: JSON-LD has no ${k.replace(/"/g, '')}`, !s.includes(k));
    }
    check(`${f}: JSON-LD phone is the real number`, !/telephone/.test(s) || /"telephone":\s*"\+61429654427"/.test(s));
  }
}
check('canonicals unique', new Set(Object.values(canonicals)).size === Object.values(canonicals).length);

// ---------- one LocalBusiness, referenced by @id ----------
const LB = ['LocalBusiness', 'AutomotiveBusiness', 'AutoWash'];
const businessNodes = ldNodes.filter(({ n }) => [].concat(n['@type'] || []).some((t) => LB.includes(t)));
check('exactly one LocalBusiness node (homepage)', businessNodes.length === 1 && businessNodes[0].f === 'index.html', businessNodes.map((b) => b.f));
const bizId = businessNodes[0] && businessNodes[0].n['@id'];
check('LocalBusiness has @id/url/telephone/areaServed', bizId && businessNodes[0].n.url === `${SITE}/` && businessNodes[0].n.areaServed?.length);
const addr = businessNodes[0]?.n.address;
check('address is locality only (no street)', !addr || (!addr.streetAddress && addr.addressLocality === 'Sydney'));
const refs = JSON.stringify(ldNodes.filter(({ f }) => f !== 'index.html').map(({ n }) => n));
check('area pages reference the business @id', !bizId || indexable.filter((f) => f !== 'index.html').every((f) => JSON.stringify(ldNodes.filter((x) => x.f === f).map((x) => x.n)).includes(bizId)), refs.slice(0, 200));
const offers = businessNodes[0]?.n.hasOfferCatalog?.itemListElement || [];
check('offers use from-prices (minPrice), AUD', offers.length > 0 && offers.every((o) => o.priceSpecification?.minPrice > 0 && o.priceSpecification.priceCurrency === 'AUD'));

// ---------- prices: schema + area pages agree with the homepage PRICES table ----------
const pricesSrc = (pages['index.html'].match(/const PRICES = (\{[\s\S]*?\});/) || [])[1];
const PRICES = pricesSrc ? Function(`return (${pricesSrc})`)() : null;
check('homepage PRICES found', !!PRICES);
if (PRICES) {
  const anchorKey = { 'pkg-silver': 'silver', 'pkg-gold': 'gold', 'pkg-platinum': 'platinum', 'pkg-diamond': 'diamond', 'pkg-interior': 'interior', 'pkg-cutpolish': 'cutpolish' };
  for (const o of offers) {
    const k = anchorKey[(o.url || '').split('#')[1]];
    check(`schema offer ${k} = hatch price`, k && o.priceSpecification.minPrice === PRICES[k].hatch, `${o.url} ${o.priceSpecification.minPrice}`);
  }
  for (const f of indexable.filter((x) => x !== 'index.html')) {
    const rows = [...pages[f].matchAll(/<a href="\/#(pkg-[a-z]+)"[^>]*>[^<]*<\/a>[\s\S]*?<\/th>\s*((?:<td[^>]*>[^<]*<\/td>\s*)+)/g)];
    let ok = rows.length >= 5;
    for (const [, anchor, tds] of rows) {
      const k = anchorKey[anchor];
      const nums = [...tds.matchAll(/\$(\d+)/g)].map((m) => +m[1]);
      const want = k === 'cutpolish' ? [PRICES[k].hatch] : [PRICES[k].hatch, PRICES[k].suv, PRICES[k].large];
      if (JSON.stringify(nums) !== JSON.stringify(want)) ok = false;
    }
    check(`${f}: price table matches homepage`, ok, rows.length);
  }
}

// ---------- sitemap + robots ----------
const sitemap = read('sitemap.xml');
check('sitemap is a urlset', /^<\?xml[^>]*\?>\s*(<!--[\s\S]*?-->\s*)?<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(sitemap));
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const want = Object.values(canonicals).sort();
check('sitemap = canonical URLs of indexable pages', JSON.stringify([...locs].sort()) === JSON.stringify(want), `${locs} vs ${want}`);
check('sitemap has no fragments / 404 / verification', !locs.some((l) => l.includes('#') || /404|google[0-9a-f]+\.html/i.test(l)));
const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
check('sitemap lastmod per url, W3C date', lastmods.length === locs.length && lastmods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
const robots = read('robots.txt');
check('robots allows all', /^User-agent: \*\s*$/m.test(robots) && /^Allow: \/\s*$/m.test(robots) && !/^Disallow: \/\s*$/m.test(robots));
check('robots lists sitemap', robots.includes(`Sitemap: ${SITE}/sitemap.xml`));

// ---------- links, fragments, images ----------
const fileForPath = (p) => (p === '/' || p === '' ? 'index.html' : p.replace(/^\//, '').replace(/^\.\//, ''));
for (const f of htmlFiles.filter((x) => !isVerification(x))) {
  const body = noScripts(pages[f]);
  const broken = [];
  for (const a of tags(body, 'a')) {
    const href = attr(a, 'href');
    if (!href || /^(https?:|tel:|sms:|mailto:)/.test(href)) continue;
    const [p, frag] = href.split('#');
    const target = p === '' ? f : fileForPath(p);
    if (!pages[target] && !existsSync(path.join(ROOT, target))) { broken.push(href); continue; }
    if (frag && pages[target] && !idsOf(pages[target]).has(frag)) broken.push(href);
  }
  check(`${f}: internal links + #fragments resolve`, broken.length === 0, broken);
  const imgs = tags(body, 'img');
  const noAlt = imgs.filter((i) => attr(i, 'alt') === null);
  check(`${f}: every <img> has alt`, noAlt.length === 0, noAlt);
  const unsized = imgs.filter((i) => !attr(i, 'width') || !attr(i, 'height')).filter((i) => attr(i, 'id') !== 'lb-img');
  check(`${f}: images have width/height`, unsized.length === 0, unsized);
  const missing = [];
  const assetRefs = [...imgs.map((i) => attr(i, 'src')), ...tags(body, 'source').flatMap((s) => (attr(s, 'srcset') || '').split(',').map((x) => x.trim().split(' ')[0])), ...tags(body, 'link').map((l) => attr(l, 'href'))];
  for (const r of assetRefs) {
    if (!r || /^https?:/.test(r) || !/\.(png|jpe?g|webp|css|woff2)$/.test(r)) continue;
    if (!existsSync(path.join(ROOT, r.replace(/^\.?\//, '')))) missing.push(r);
  }
  for (const m of body.matchAll(/data-src="([^"]+)"/g)) if (!existsSync(path.join(ROOT, m[1]))) missing.push(m[1]);
  check(`${f}: referenced assets exist`, missing.length === 0, missing);
}
const css = existsSync(path.join(ROOT, 'assets/site.css')) ? read('assets/site.css') : '';
for (const cls of ['.hidden', '.flex', '.border-teal', '.bg-teal-50', '.border-red-500', '.group[open] .group-open\\:rotate-45', '.sr-only']) {
  check(`site.css has ${cls}`, css.includes(cls));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SEO STATIC ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length} ===`);
process.exit(failed.length ? 1 : 0);
