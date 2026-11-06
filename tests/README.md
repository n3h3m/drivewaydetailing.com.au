# Site tests

Three dependency-free suites (no npm install needed):

| Script | What | Needs |
| --- | --- | --- |
| `node --test tests/sms-uri.test.mjs` (`npm run test:sms`) | Unit tests for the SMS link builder in `assets/enquiry-utils.js` | Node 18+ only |
| `node tests/seo-static.mjs` (`npm run test:seo`) | Static SEO checks on every HTML page | Node 18+ only |
| `node tests/booking-form-regression.mjs` (`npm run test:booking`) | Booking form regression in a real browser | Node 18+, `playwright-core`, Chrome |

`npm test` runs all three (SMS unit tests, SEO, then booking).

## Requirements

- Node 18+
- `playwright-core` available (repo uses `/workspace/node_modules/playwright-core`)
- Google Chrome at `/usr/bin/google-chrome` (no browser download)

## Run

From the site repo root (`drivewaydetailing.com.au/`):

```bash
npm test                                   # both suites
node tests/seo-static.mjs                  # SEO only
node tests/seo-static.mjs --root=/some/dir # SEO checks against another checkout
node tests/booking-form-regression.mjs     # booking only (serves repo over a local http server)
node tests/booking-form-regression.mjs --base=http://127.0.0.1:8765  # use a server you already started
node tests/booking-form-regression.mjs --file                         # legacy file:// mode
```

The booking suite now serves the repo root over `http://127.0.0.1:<random port>`
(`tests/static-server.mjs`, Node built-ins only) because the pages use self-hosted
fonts, which Chrome blocks over `file://`. `BASE_URL=...` works like `--base=`.

Exit code `0` = all checks passed. Booking JSON report + screenshot land in `tests/out/`.

## Booking suite covers

1. General enquiry auto-select when a custom quote checkbox is ticked (no vehicle required); SMS/WA success hrefs
2. “Get a quote” CTA selects General enquiry and submits with a pill
3. Known package (Silver) retained when a quote is also selected; price summary shows package amount
4. Add-on Services block: order, visibility, prices; summary reflects selected add-ons
5. Incomplete submit: compact inline errors (not giant hero cards), fieldset mark, scroll to first error
6. Sticky/nav **Book** while invalid: preserves filled fields & quote choices; scrolls to first error
7. Valid in-progress **Book**: preserves package/addons; no error flash; correct SMS/WA success hrefs
8. Footer ABN + credit link; mobile horizontal overflow; console errors
9. SMS links per device (Android Chrome UA and iPhone Safari UA): nav link and submit/live-preview
   `#open-sms` hrefs are exact — Android `sms:0429654427?body=…`, iPhone `sms:0429654427?&body=…`
   (desktop/unknown also `?body=`); body decodes to the preview text; WhatsApp href unchanged.
   This checks the link contract only; it cannot open a real phone's SMS app.

## SMS unit tests cover

`buildSmsUri(phone, body, userAgent)` / `normalizeSmsHref(href, userAgent)`: Android (Chrome,
Samsung Internet) get `?body=` and never `?&body=` (the old Android URI is reproduced and
rejected); iPhone/iPad keep the existing `?&body=`; desktop/undefined UA fall back to `?body=`;
newlines, apostrophes, `$`, en dash, accents and emoji round-trip; the number stays `0429654427`
(no `+61`); empty body gives a bare `sms:` link; and `index.html` loads the helper once, before the
main script, and routes submit + live preview + static links through it.

## SEO suite covers

- Per indexable page: title (25–65 chars), meta description (120–165), `lang="en-AU"`,
  one self-referencing absolute canonical, `og:url`/absolute `og:image` (file exists, dimensions),
  Twitter card, exactly one `<h1>` (mentions car detailing + place) inside one `<main>`,
  heading levels never skip, no comma-stuffed headings, no Tailwind CDN / Google Fonts requests.
- JSON-LD parses; no invented facts (`aggregateRating`, `review`, `geo`, street address,
  postcode, email); exactly one LocalBusiness node (homepage) that area pages reference by `@id`;
  schema offers and area-page price tables equal the homepage `PRICES` table.
- `sitemap.xml` lists exactly the canonical URLs of indexable pages (no fragments, 404 or
  verification files); `robots.txt` allows all and points at the sitemap; `404.html` is noindex.
- Every internal link and `#fragment` resolves; every `<img>` has `alt`, width/height and an
  existing file (including `<source srcset>` and lightbox `data-src`).

Private evidence only — not client annotations.
