/*!
 * Driveway Detailing enquiry helpers (no dependencies).
 * UMD: window.DDEnquiry in the browser, module.exports in Node (tests).
 *
 * SMS deep links differ by platform:
 *   iPhone / iPad / iPod (iOS Messages):  sms:0429654427?&body=...   (existing, works on iPhone)
 *   Android + everything else (RFC 5724): sms:0429654427?body=...
 * The old "?&body=" form makes some Android SMS apps drop the message body,
 * so Android must get "?body=". Only the separator changes; the number and
 * the encodeURIComponent body encoding stay exactly the same.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DDEnquiry = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var IOS_RE = /iPhone|iPad|iPod/i;
    var ANDROID_RE = /Android/i;

    /** 'ios' | 'android' | 'other' from a user-agent string (undefined => 'other'). */
    function smsPlatform(ua) {
        var s = typeof ua === 'string' ? ua : '';
        // Some Android UAs mention "like iPhone"-style tokens; Android wins.
        if (ANDROID_RE.test(s)) return 'android';
        if (IOS_RE.test(s)) return 'ios';
        return 'other';
    }

    /**
     * Build an sms: URI for the user's default messaging app.
     * @param {string} phone  digits as dialled locally, e.g. '0429654427' (kept as given)
     * @param {string} body   plain-text message (newlines, apostrophes, $ etc. allowed)
     * @param {string} [ua]   navigator.userAgent
     */
    function buildSmsUri(phone, body, ua) {
        var num = String(phone == null ? '' : phone).replace(/\s+/g, '');
        var text = body == null ? '' : String(body);
        if (!text) return 'sms:' + num;
        var sep = smsPlatform(ua) === 'ios' ? '?&body=' : '?body=';
        return 'sms:' + num + sep + encodeURIComponent(text);
    }

    /**
     * Re-target an existing sms: href (e.g. a static link written in iOS form)
     * for the current platform. Non-sms or body-less hrefs are returned unchanged.
     */
    function normalizeSmsHref(href, ua) {
        var m = /^sms:([^?]*)\?&?body=(.*)$/i.exec(String(href || ''));
        if (!m) return href;
        var body;
        try {
            body = decodeURIComponent(m[2]);
        } catch (e) {
            return href;
        }
        return buildSmsUri(m[1], body, ua);
    }

    return { buildSmsUri: buildSmsUri, normalizeSmsHref: normalizeSmsHref, smsPlatform: smsPlatform };
});
