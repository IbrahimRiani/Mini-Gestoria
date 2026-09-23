/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Acentos: verde esmeralda (positivo / verificado) + azul marino financiero (primario)
        brand: {
          50: '#eef4ff',
          100: '#dae5ff',
          200: '#bdd0ff',
          300: '#93b1ff',
          400: '#6086ff',
          500: '#3b5eff',
          600: '#2440f5',
          700: '#1c30e1',
          800: '#1e2ab6',
          900: '#1e2b8f',
          950: '#0b1147'
        }
      },
      fontFamily: {
        // Jerarquía tipográfica: interfaz de sistema (estilo Apple) + cifras tabulares
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px -12px rgb(15 23 42 / 0.12)',
        lift: '0 2px 4px rgb(15 23 42 / 0.06), 0 24px 48px -24px rgb(15 23 42 / 0.28)'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' }
        }
      },
      animation: {
        'fade-up': 'fade-up .32s cubic-bezier(.22,1,.36,1) both',
        'soft-pulse': 'soft-pulse 1.6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
