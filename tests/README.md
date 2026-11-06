# Booking form regression tests

Automated Playwright (system Chrome) smoke/regression for the Driveway Detailing booking form.

## Requirements

- Node 18+
- `playwright-core` available (repo uses `/workspace/node_modules/playwright-core`)
- Google Chrome at `/usr/bin/google-chrome` (no browser download)

## Run

From the site repo root (`drivewaydetailing.com.au/`):

```bash
node tests/booking-form-regression.mjs
# or
npm test
```

Exit code `0` = all checks passed. JSON report + screenshot land in `tests/out/`.

## What it covers

1. General enquiry auto-select when a custom quote checkbox is ticked (no vehicle required); SMS/WA success hrefs
2. “Get a quote” CTA selects General enquiry and submits with a pill
3. Known package (Silver) retained when a quote is also selected; price summary shows package amount
4. Add-on Services block: order, visibility, prices; summary reflects selected add-ons
5. Incomplete submit: compact inline errors (not giant hero cards), fieldset mark, scroll to first error
6. Sticky/nav **Book** while invalid: preserves filled fields & quote choices; scrolls to first error
7. Valid in-progress **Book**: preserves package/addons; no error flash; correct SMS/WA success hrefs
8. Footer ABN + credit link; mobile horizontal overflow; console errors

Private evidence only — not client annotations.
