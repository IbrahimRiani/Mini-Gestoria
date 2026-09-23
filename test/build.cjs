// Compila src/App.jsx a CJS con esbuild para poder probarlo en Node.
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'App.jsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  jsx: 'automatic',
  outfile: path.join(__dirname, '.bundle.cjs'),
  // Dependencias cargadas bajo demanda y solo en navegador (nunca se ejecutan aquí).
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'pdfjs-dist',
    'pdfjs-dist/*',
    'tesseract.js',
    '@supabase/supabase-js'
  ],
  loader: { '.js': 'jsx' },
  // En Node no hay import.meta.env: se define vacío (las tests validan el código fuente).
  define: {
    'import.meta.env.VITE_DEEPSEEK_API_KEY': '""',
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""'
  },
  logLevel: 'warning'
});

console.log('bundle generado: test/.bundle.cjs');
