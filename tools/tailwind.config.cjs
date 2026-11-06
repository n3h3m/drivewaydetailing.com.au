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
        extend: {
            colors: {
                navy: {
                    DEFAULT: '#0E2A57',
                    50: '#E8EDF5',
                    100: '#CCD5E5',
                    600: '#0E2A57',
                    700: '#0A2046',
                    800: '#071834',
                    900: '#04102A',
                },
                teal: {
                    DEFAULT: '#14C5BD',
                    50: '#E2FAF8',
                    100: '#BFF3EF',
                    600: '#14C5BD',
                    700: '#0FA39C',
                },
                gold: {
                    DEFAULT: '#C9A45D',
                    600: '#C9A45D',
                    700: '#A8884B',
                },
                ink: '#1A1A1A',
                paper: '#F5F7FA',
                cream: '#FAF8F2',
            },
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                script: ['Caveat', 'cursive'],
            },
            maxWidth: { '8xl': '88rem' },
            boxShadow: {
                card: '0 1px 2px rgba(14,42,87,0.06), 0 8px 24px -8px rgba(14,42,87,0.18)',
                cardLg: '0 6px 16px -4px rgba(14,42,87,0.10), 0 24px 48px -12px rgba(14,42,87,0.28)',
                ring: '0 0 0 4px rgba(20,197,189,0.18)',
            },
        },
    },
    plugins: [],
};
