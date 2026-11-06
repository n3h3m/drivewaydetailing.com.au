# GA4 and Clarity measurement

This change is non-visual. No layout, copy, or screenshot comparison.

The Google Analytics dashboard was not opened after install. Hits below were observed in the browser's network log. Realtime or standard reports can lag, so this file does not claim the property already shows data.

## Account recorded in the setup file

| | |
| --- | --- |
| Account | Driveway Detailing (`415179916`) |
| Property | Driveway Detailing - Website (`562898589`) |
| Web stream | Driveway Detailing, `https://drivewaydetailing.com.au`, stream `16285630391` |
| Measurement ID | `G-CRXCQ78F53` |
| Time zone / currency | Australia/Sydney, AUD |
| Enhanced measurement | Left on Google's defaults. The site calls `gtag('config', 'G-CRXCQ78F53')` with no extra config, so page views, scrolls, outbound clicks, site search, video, file downloads, and form interactions stay as Google set them. |
| Tag that was not installed | The setup screen also showed container `GTM-N38PG3BB`. That container snippet is not on the site. |

Clarity project `z9d9xk3est` (`https://clarity.microsoft.com/projects/view/z9d9xk3est/`). Heatmaps and session recordings stay on Clarity's defaults. Masking was not changed, and the site does not call `clarity()` to unmask fields. The GA integration inside Clarity was left off.

## Where the tags are

One direct gtag.js snippet and one Clarity snippet on each public page:

- `index.html`
- `car-detailing-western-sydney.html`
- `car-detailing-blue-mountains.html`
- `car-detailing-central-coast.html`

`404.html` and `googleb08830c1e73b6c39.html` are not tagged. Custom events live in `assets/analytics.js`, loaded once per public page.

## Event semantics

Every custom `gtag('event', ...)` is inside try/catch and is skipped if `gtag` is missing. A thrown or blocked analytics call does not stop the SMS handoff.

`generate_lead` is the only conversion. It fires when a prepared SMS is launched, once per inquiry composition for the rest of that page view:

- Booking form: the success panel is not the conversion. After a valid submit the panel is shown first. About 50ms later the site calls `generate_lead` and then opens the `sms:` link. Tapping Send as message, or submitting again with the same package, vehicle size, add-ons, and quote services, does not send another lead. Changing that composition and launching SMS again does.
- The marker is those service choices only. Name, phone, suburb, date, and notes are not part of the marker and are not sent.
- Nav Message link (the short prepared enquiry SMS): one `generate_lead` per page, `source: nav_sms`, `lead_type: custom_enquiry`.
- A location-page Text us link with no message body is not a lead.
- WhatsApp is the same composed inquiry as the SMS launch, so it is not a second lead.

Lead parameters:

| Parameter | Meaning |
| --- | --- |
| `lead_type` | `package` for a priced package, `custom_enquiry` for General enquiry |
| `enquiry_kind` | `confirmed_package`, `confirmed_package_with_custom_quote`, or `custom_enquiry` |
| `package_id` | `silver`, `gold`, `platinum`, `diamond`, `interior`, `cutpolish`, or `general_enquiry` |
| `vehicle_size` | `hatch`, `suv`, `large`, or `unspecified` |
| `addon_count`, `addon_ids` | Selected add-ons, as slugs |
| `quote_count`, `quote_ids` | Selected custom-quote services, as slugs |
| `method` | `sms` |
| `source` | `booking_sms` or `nav_sms` |
| `currency`, `value` | AUD from-price for a confirmed package when the vehicle size is known. Omitted for custom enquiries. |

`click_phone` fires for `tel:` taps only (`link_type: tel`, placement `header`, `footer`, `sticky`, `booking_form`, or `page`). A repeat tap on the same placement inside 400ms is ignored. The business number is not a parameter.

`click_email` fires for `mailto:` taps only. There is no email link in the current pages; the handler is there so a phone tap cannot be recorded as email. The address is not a parameter.

`select_package` fires when the chosen package id actually changes, from a package card (`source: package_card`) or the form. `select_addon` and `select_quote` fire when an add-on or custom-quote service becomes selected. The same id inside 400ms is ignored. Unticking does not send a selection event.

`booking_start` fires once per page on the first Book / package-card click or the first package, add-on, or quote change. Opening the form, typing a name, or restoring fields does not count as a lead.

## What was checked

`npm test` completed with exit code 0. That run includes the SMS unit tests, the analytics unit tests, the static SEO checks, the booking-form browser regression (84/84, including Android and iPhone SMS hrefs), and the analytics browser check (68/68).

Browser network log, not the GA dashboard:

- `https://www.googletagmanager.com/gtag/js?id=G-CRXCQ78F53` returned 200 on each public page.
- `https://www.clarity.ms/tag/z9d9xk3est` returned 200 on each public page.
- No request to `gtm.js` and no `GTM-` id in the DOM.
- `https://www.google-analytics.com/g/collect?v=2&tid=G-CRXCQ78F53...` included `page_view`, `click_phone`, `scroll`, `click_email`, `form_start`, `booking_start`, and `generate_lead`. One of those collect URLs had `hasLead: true`.
- The mobile Message link produced a collect whose event names were `page_view,generate_lead`.
- Google collect URLs and the custom event payloads did not contain the test name, phone, suburb, date, or note. The SMS draft itself still contained them.
- No page exception and no failed request for a local asset. Headless Chrome logged `Not allowed to launch 'sms:...' because a user gesture is required` when the timer opened the SMS link. That is the browser refusing a timer-driven protocol handoff in this test. It is not a script exception, and the booking regression still reported no console errors with the SMS route aborted.
- 404 loaded with `gtag`, `clarity`, and `DDAnalytics` all undefined.

GA key events were not marked in the admin UI. `generate_lead` has to be received by the property before it can be marked there.
