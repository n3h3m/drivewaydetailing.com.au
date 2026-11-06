/*!
 * Driveway Detailing measurement helpers (no dependencies).
 * UMD: window.DDAnalytics in the browser, module.exports in Node (tests).
 *
 * The page head loads GA4 (gtag.js, measurement id only) and Clarity.
 * This file only sends custom events. It never reads contact fields, and
 * every gtag call is guarded so a blocked or broken analytics script cannot
 * stop the booking SMS handoff.
 *
 * generate_lead fires when a prepared SMS is launched (booking form handoff
 * or the nav message link), once per inquiry composition. Showing the
 * success panel is not a lead. Phone and email clicks are separate events.
 */
(function (root, factory) {
    var api = factory(root || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.DDAnalytics = api;
        if (root.document) api.install(root.document);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    // From-prices match the homepage PRICES table. Value is sent only for a
    // confirmed package once a vehicle size is known. Custom quotes have no value.
    var PRICES = {
        silver: { hatch: 129, suv: 149, large: 169 },
        gold: { hatch: 249, suv: 289, large: 329 },
        platinum: { hatch: 349, suv: 399, large: 449 },
        diamond: { hatch: 799, suv: 899, large: 999 },
        interior: { hatch: 199, suv: 219, large: 239 },
        cutpolish: { hatch: 349, suv: 349, large: 349 },
    };

    var PII_KEY = /name|phone|email|e-mail|message|address|suburb|postcode|postal|date|note|body|first|last|\btel\b/i;
    var PII_VALUE = /(?:\+?\d[\d\s().-]{6,}\d)|(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

    var markers = Object.create(null);
    var recent = Object.create(null);
    var lastPackageId = '';
    var bookingStarted = false;
    var pendingPackageSource = 'form';

    function slug(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/&amp;/g, ' and ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 48);
    }

    function isCustomPackage(snapshot) {
        var id = snapshot && snapshot.packageId;
        var label = snapshot && snapshot.packageLabel;
        return !id || id === 'general_enquiry' || label === 'General enquiry';
    }

    function enquiryKind(snapshot) {
        var quotes = (snapshot && snapshot.quotes) || [];
        if (isCustomPackage(snapshot)) return 'custom_enquiry';
        if (quotes.length) return 'confirmed_package_with_custom_quote';
        return 'confirmed_package';
    }

    function scrubParams(params) {
        var out = {};
        if (!params || typeof params !== 'object') return out;
        Object.keys(params).forEach(function (key) {
            if (PII_KEY.test(key)) return;
            var value = params[key];
            if (typeof value === 'number') {
                if (!isFinite(value)) return;
                out[key] = value;
                return;
            }
            if (typeof value !== 'string') return;
            if (!value || PII_VALUE.test(value)) return;
            out[key] = value;
        });
        return out;
    }

    function leadParams(snapshot, source) {
        var snap = snapshot || {};
        var custom = isCustomPackage(snap);
        var addons = snap.addons || [];
        var quotes = snap.quotes || [];
        var size = snap.vehicleSize || '';
        var packageId = custom ? 'general_enquiry' : snap.packageId;
        var params = {
            lead_type: custom ? 'custom_enquiry' : 'package',
            enquiry_kind: enquiryKind(snap),
            package_id: packageId || 'general_enquiry',
            vehicle_size: size || 'unspecified',
            addon_count: addons.length,
            quote_count: quotes.length,
            method: 'sms',
            source: source || 'booking_sms',
        };
        if (addons.length) params.addon_ids = addons.map(slug).filter(Boolean).join(',');
        if (quotes.length) params.quote_ids = quotes.map(slug).filter(Boolean).join(',');
        var price = !custom && size && PRICES[packageId] && PRICES[packageId][size];
        if (price) {
            params.currency = 'AUD';
            params.value = price;
        }
        return scrubParams(params);
    }

    function inquiryMarker(snapshot, source) {
        if (source === 'nav_sms') return 'nav_sms';
        var snap = snapshot || {};
        return [
            'booking',
            (isCustomPackage(snap) ? 'general_enquiry' : snap.packageId) || 'none',
            snap.vehicleSize || 'unspecified',
            (snap.addons || []).map(slug).filter(Boolean).sort().join('+'),
            (snap.quotes || []).map(slug).filter(Boolean).sort().join('+'),
        ].join('|');
    }

    function claimMarker(marker, store) {
        var bag = store || markers;
        if (!marker || bag[marker]) return false;
        bag[marker] = true;
        return true;
    }

    function allowEvent(key, ms, now) {
        var t = typeof now === 'number' ? now : Date.now();
        var prev = recent[key];
        if (typeof prev === 'number' && t - prev < ms) return false;
        recent[key] = t;
        return true;
    }

    function safeGtag(name, params) {
        try {
            var gtag = root && root.gtag;
            if (typeof gtag !== 'function') return false;
            gtag('event', name, params);
            return true;
        } catch (err) {
            return false;
        }
    }

    function track(name, params) {
        return safeGtag(name, scrubParams(params));
    }

    function trackLead(snapshot, source) {
        try {
            var params = leadParams(snapshot, source);
            var marker = inquiryMarker(snapshot, source);
            if (!claimMarker(marker)) return { sent: false, duplicate: true, params: params, marker: marker };
            return { sent: track('generate_lead', params), duplicate: false, params: params, marker: marker };
        } catch (err) {
            return { sent: false, duplicate: false, params: {}, marker: '' };
        }
    }

    function placement(el) {
        if (!el || !el.closest) return 'page';
        if (el.closest('#mobile-sticky-bar')) return 'sticky';
        if (el.closest('#booking-form')) return 'booking_form';
        if (el.closest('header')) return 'header';
        if (el.closest('footer')) return 'footer';
        return 'page';
    }

    function readBooking(doc) {
        var form = doc && doc.getElementById && doc.getElementById('booking-form');
        if (!form) return null;
        var pkg = form.querySelector('input[name="package"]:checked');
        var vehicle = form.querySelector('input[name="vehicletype"]:checked');
        function values(name) {
            return Array.prototype.map.call(
                form.querySelectorAll('input[name="' + name + '"]:checked'),
                function (el) { return el.value; },
            );
        }
        return {
            packageLabel: pkg ? pkg.value : '',
            packageId: pkg ? (pkg.getAttribute('data-pkg') || slug(pkg.value)) : '',
            vehicleSize: vehicle ? (vehicle.getAttribute('data-size') || '') : '',
            addons: values('addons'),
            quotes: values('quoteservices'),
        };
    }

    function onPreparedSmsLaunch(source) {
        try {
            if (source === 'nav_sms') {
                return trackLead({
                    packageLabel: 'General enquiry',
                    packageId: 'general_enquiry',
                    vehicleSize: '',
                    addons: [],
                    quotes: [],
                }, 'nav_sms');
            }
            var snap = readBooking(root.document);
            // No package yet: the success panel can be shown in tests, but a
            // composed booking SMS always has a package selected.
            if (!snap || !snap.packageLabel) return { sent: false, duplicate: false, params: {}, marker: '' };
            return trackLead(snap, 'booking_sms');
        } catch (err) {
            return { sent: false, duplicate: false, params: {}, marker: '' };
        }
    }

    function trackBookingStart(entry) {
        if (bookingStarted) return false;
        if (!allowEvent('booking_start', 400)) return false;
        bookingStarted = true;
        track('booking_start', { entry: entry || 'form' });
        return true;
    }

    function composedSmsHref(href) {
        return /[?&]body=/.test(String(href || ''));
    }

    function onClick(event) {
        try {
            var target = event && event.target;
            if (!target || !target.closest) return;
            var tel = target.closest('a[href^="tel:"]');
            if (tel) {
                var phoneKey = 'click_phone:' + placement(tel);
                if (allowEvent(phoneKey, 400)) {
                    track('click_phone', { link_type: 'tel', placement: placement(tel) });
                }
                return;
            }
            var mail = target.closest('a[href^="mailto:"]');
            if (mail) {
                var mailKey = 'click_email:' + placement(mail);
                if (allowEvent(mailKey, 400)) {
                    track('click_email', { link_type: 'mailto', placement: placement(mail) });
                }
                return;
            }
            var sms = target.closest('a[href^="sms:"]');
            if (sms && composedSmsHref(sms.getAttribute('href'))) {
                onPreparedSmsLaunch(sms.id === 'open-sms' ? 'booking_sms' : 'nav_sms');
                return;
            }
            var book = target.closest('a[href="#booking-form"], a[href="/#booking-form"], a[href$="#booking-form"], .pkg-cta');
            if (!book) return;
            if (book.classList && book.classList.contains('pkg-cta')) pendingPackageSource = 'package_card';
            trackBookingStart(book.classList && book.classList.contains('pkg-cta') ? 'package_card' : 'booking_cta');
        } catch (err) {}
    }

    function onChange(event) {
        try {
            var el = event && event.target;
            if (!el || !el.name || !el.closest || !el.closest('#booking-form')) return;
            if (el.name === 'package' && el.checked) {
                var id = el.getAttribute('data-pkg') || slug(el.value);
                var custom = id === 'general_enquiry' || el.value === 'General enquiry';
                var packageId = custom ? 'general_enquiry' : id;
                if (packageId !== lastPackageId && allowEvent('select_package:' + packageId, 400)) {
                    lastPackageId = packageId;
                    track('select_package', {
                        package_id: packageId,
                        lead_type: custom ? 'custom_enquiry' : 'package',
                        source: pendingPackageSource || 'form',
                    });
                }
                pendingPackageSource = 'form';
                trackBookingStart('form');
                return;
            }
            if (el.name === 'addons' && el.checked) {
                var addonId = slug(el.value);
                if (addonId && allowEvent('select_addon:' + addonId, 400)) {
                    track('select_addon', { addon_id: addonId, source: 'form' });
                }
                trackBookingStart('form');
                return;
            }
            if (el.name === 'quoteservices' && el.checked) {
                var quoteId = slug(el.value);
                if (quoteId && allowEvent('select_quote:' + quoteId, 400)) {
                    track('select_quote', { quote_id: quoteId, lead_type: 'custom_enquiry' });
                }
                trackBookingStart('form');
            }
        } catch (err) {}
    }

    function install(doc) {
        if (!doc || !doc.addEventListener || doc.__ddAnalyticsInstalled) return false;
        doc.__ddAnalyticsInstalled = true;
        doc.addEventListener('click', onClick, true);
        doc.addEventListener('change', onChange, true);
        return true;
    }

    function resetForTests() {
        markers = Object.create(null);
        recent = Object.create(null);
        lastPackageId = '';
        bookingStarted = false;
        pendingPackageSource = 'form';
    }

    return {
        PRICES: PRICES,
        slug: slug,
        scrubParams: scrubParams,
        leadParams: leadParams,
        inquiryMarker: inquiryMarker,
        enquiryKind: enquiryKind,
        claimMarker: claimMarker,
        allowEvent: allowEvent,
        safeGtag: safeGtag,
        trackLead: trackLead,
        onPreparedSmsLaunch: onPreparedSmsLaunch,
        readBooking: readBooking,
        composedSmsHref: composedSmsHref,
        placement: placement,
        install: install,
        resetForTests: resetForTests,
    };
});
