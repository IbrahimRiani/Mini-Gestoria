/* QA estático: identificadores duplicados, clases Tailwind inválidas, imports sin usar, secretos. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const body = src.split('export default function App')[1] || src;
const lines = src.split('\n');

let fail = 0;
const bad = (m) => { console.error('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  ok   ' + m);

/* -- id duplicados -- */
const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
dupIds.length ? bad('id duplicados: ' + [...new Set(dupIds)].join(', ')) : ok('sin id duplicados (' + ids.length + ' ids)');

/* -- clases Tailwind -- */
const invalid = new Set();
for (const m of src.matchAll(/(className|className:\s*)=\{?["'`]([^"'`]*)["'`]/g)) {
  for (const c of m[2].split(/\s+/)) {
    if (!c) continue;
    /* spacing *.5 solo existe para 0.5, 1.5, 2.5 y 3.5 en Tailwind 3 */
    const half = c.match(/^(?:h|w|gap|p[trblxy]?|m[trblxy]?|text|bg|border|top|bottom|left|right)-(\d+)\.5$/);
    if (half && !['0', '1', '2', '3'].includes(half[1])) invalid.add(c);
  }
}
invalid.size ? bad('clases inválidas: ' + [...invalid].join(', ')) : ok('sin clases h-*/w-*.5 inválidas');

/* -- imports sin usar -- */
const importNames = new Set();
for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
  m[1].split(',').forEach((n) => { const name = n.trim().split(/\s+as\s+/).pop().trim(); if (name) importNames.add(name); });
}
const unused = [...importNames].filter((n) => {
  const uses = src.split(new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b')).length - 1;
  return uses <= 1;
});
unused.length ? bad('imports sin usar: ' + unused.join(', ')) : ok('sin imports sin usar (' + importNames.size + ')');

/* -- credenciales -- */
const secrets = [];
if (/sk-[a-f0-9]{32,}/.test(src + html)) secrets.push('deepseek key en fuentes');
if (/sb_secret_[A-Za-z0-9]+/.test(src + html)) secrets.push('supabase secret en fuentes');
if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(src)) secrets.push('JWT incrustado');
secrets.length ? bad(secrets.join(', ')) : ok('sin credenciales incrustadas');

console.log(fail ? `\nQA: ${fail} problemas` : '\nQA: todo OK');
process.exit(fail ? 1 : 0);
