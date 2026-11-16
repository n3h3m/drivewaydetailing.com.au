/**
 * Tailwind v3.4.17 build config for drivewaydetailing.com.au.
 * Mirrors the former runtime `tailwind.config` from the CDN script exactly
 * (colors, fonts, maxWidth, shadows). No plugins (the CDN loaded none).
 *
 * Build (from repo root):
 *   /workspace/perf-tools/node_modules/.bin/tailwindcss \
 *     -c tools/tailwind.config.cjs -i tools/tailwind.input.css -o assets/site.css --minify
 */
module.exports = {
    content: {
        relative: true,
        // HTML includes the inline <script> blocks, so class strings built in JS
        // (hidden, flex, border-teal, bg-teal-50, border-red-500, innerHTML price
        // markup, etc.) are picked up as well.
        files: ['../*.html'],
    },
    theme: {
        // nehem.dev-style visual system (Nov 2026 restyle): ink canvas colours,
        // teal / coral / violet / amber accents, square cards, pill CTAs, no
        // drop shadows. Class names (navy, teal, gold...) are kept so markup and
        // JS class strings stay unchanged; only their values moved.
        borderRadius: {
            none: '0',
            sm: '0',
            DEFAULT: '0',
            md: '0',
            lg: '0',
            xl: '9999px', // only the package size switcher buttons (pills)
            '2xl': '9999px', // CTA buttons -> pills
            '3xl': '0',
            full: '9999px',
        },
        extend: {
            colors: {
                navy: {
                    DEFAULT: '#0A0A0A',
                    50: '#F2F2F0',
                    100: '#E2E2E2',
                    600: '#0A0A0A',
                    700: '#2A2A2A',
                    800: '#141414',
                    900: '#000000',
                },
                teal: {
                    DEFAULT: '#11968A',
                    50: '#E8F5F3',
                    100: '#CDEAE6',
                    600: '#11968A',
                    700: '#0B6F66',
                },
                gold: {
                    DEFAULT: '#E9A321',
                    600: '#E9A321',
                    700: '#8A5A00',
                },
                coral: { DEFAULT: '#E4533B', 700: '#B93A24' },
                violet: { DEFAULT: '#3B36B8', 700: '#332EA3' },
                amber: { DEFAULT: '#E9A321', 700: '#8A5A00' },
                ink: '#1A1A1A',
                paper: '#FFFFFF',
                tint: '#F5F5F3',
                cream: '#FFFFFF',
            },
            fontFamily: {
                sans: ['Archivo', '"Archivo Fallback"', 'Arial', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                display: ['Archivo', '"Archivo Fallback"', '"Arial Narrow"', 'Arial', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
                script: ['Archivo', '"Archivo Fallback"', 'Arial', 'sans-serif'],
            },
            maxWidth: { '8xl': '88rem' },
            boxShadow: {
                card: '0 0 #0000',
                cardLg: '0 0 #0000',
                ring: '0 0 0 4px rgba(17,150,138,0.22)',
            },
        },
    },
    plugins: [],
};
