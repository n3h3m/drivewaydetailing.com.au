# Build tools

## CSS (Tailwind, compiled — no runtime CDN)

`assets/site.css` is generated; do not edit it by hand. After changing classes in any
`*.html` page (including class strings inside inline `<script>`), rebuild:

```bash
npm run build:css
# = /workspace/perf-tools/node_modules/.bin/tailwindcss -c tools/tailwind.config.cjs \
#     -i tools/tailwind.input.css -o assets/site.css --minify
```

`tools/tailwind.config.cjs` mirrors the old in-page `tailwind.config` (colors, fonts,
`max-w-8xl`, shadows) for Tailwind v3.4.17 with no plugins. The homepage keeps its
custom inline `<style>`; `site.css` is linked after it so the cascade order matches the
old CDN behaviour.

## Fonts

`assets/fonts/inter-latin-var.woff2` and `caveat-latin-var.woff2` are the Google Fonts
latin subsets of Inter and Caveat (SIL Open Font License 1.1), self-hosted to avoid
render-blocking third-party requests. `@font-face` rules live in `tools/tailwind.input.css`.

## Images

`assets/processed/*-640.webp`, `hero-bmw-800.webp`, `hero-bmw-1280.webp` are WebP
(quality 85, Pillow) resizes of the original JPGs, which stay as `<img>` fallbacks and
as lightbox full-size images. `logo-nav.png` / `logo-white-nav.png` are 314×120 resizes
of the original logos for the 40px-high header/footer logo.
