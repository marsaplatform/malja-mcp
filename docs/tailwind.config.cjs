/**
 * Tailwind config for the landing pages (docs/index.html — English default,
 * docs/ar/index.html — Arabic) — mirrors the theme that previously lived
 * inline next to the CDN script. Regenerate tw.css after editing classes
 * in either file:  npm run landing:css
 */
module.exports = {
  content: ['./docs/index.html', './docs/ar/index.html'],
  theme: {
    extend: {
      colors: {
        ink: '#141c2e',
        ink2: '#1d2742',
        inkline: '#2c3a5c',
        paper: '#f6f1e7',
        card: '#fdfaf3',
        rule: '#ddd4c0',
        soft: '#5b6274',
        fog: '#9aa3bd',
        teal: '#0e7568',
        amber: '#e3a83a',
        crisis: '#c4372c',
        sand: '#ece3cf',
      },
      fontFamily: {
        head: ['Zad', '"Noto Sans Arabic"', 'sans-serif'],
        body: ['Zad', '"Noto Sans Arabic"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        grow: { from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' } },
        fadeup: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        grow: 'grow .9s cubic-bezier(0.16,1,0.3,1) both',
        fadeup: 'fadeup .7s cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
};
