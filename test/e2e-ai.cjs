/* ============================================================================
 * Prueba E2E del procesador de facturas:
 *   PDF real (jsPDF) → extracción de texto (pdfjs) → DeepSeek JSON Mode
 *
 * La parte de IA solo se ejecuta si se pasa la clave por variable de entorno:
 *   DEEPSEEK_KEY=sk-... node test/e2e-ai.cjs
 * La clave NUNCA se escribe en disco.
 * ========================================================================== */

/* Lee una variable del .env local (fallback del test cuando no hay DEEPSEEK_KEY). */
function readDotEnv(name) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = raw.match(new RegExp(`^\\s*${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const fs = require('fs');
const path = require('path');

// --- Stubs de navegador (idénticos a run.cjs) -----------------------------
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = {
  atob: global.atob,
  btoa: global.btoa,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  scrollTo() {},
  addEventListener() {},
  removeEventListener() {}
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.document = {
  documentElement: { classList: { toggle() {} } },
  createElement: () => ({ style: {}, getContext: () => null, toDataURL: () => 'data:,' }),
  addEventListener() {},
  removeEventListener() {}
};

const { jsPDF } = require('jspdf');

// Polyfill para Node 20 / navegadores antiguos (pdfjs-dist usa ES2024).
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const App = require('./.bundle.cjs');
const { extractFileText, extractInvoiceWithDeepSeek, validateInvoice } = App;

const PDF_PATH = path.join(__dirname, 'factura-ejemplo.pdf');
let ok = 0;
const fallos = [];

const check = (label, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => {
      ok += 1;
      console.log(`  ✓ ${label}`);
    })
    .catch((error) => {
      fallos.push({ label, error });
      console.log(`  ✗ ${label}\n      → ${error.message}`);
    });

const assert = (cond, msg = 'aserción fallida') => {
  if (!cond) throw new Error(msg);
};

/* ---------- 1. Genera un PDF de factura real (texto español) ------------- */
function crearPdf() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const lineas = [
    'FACTURA SIMULADA Nº E-2026-042',
    'Fecha: 15/09/2026',
    'Emisor: CloudHosting Ibérica S.L. · NIF B-55667788',
    'Receptor: Estudio Ribera S.L. · NIF B-99887766',
    'Concepto: Alojamiento y ancho de banda - cuarta trimestral',
    'Base imponible: 1.250,00 EUR',
    'IVA 21 %: 262,50 EUR',
    'Retención IRPF 15 %: 0,00 EUR',
    'TOTAL: 1.512,50 EUR'
  ];
  doc.setFontSize(12);
  lineas.forEach((l, i) => doc.text(l, 18, 30 + i * 10));
  const buffer = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(PDF_PATH, buffer);
  return buffer;
}

(async () => {
  console.log('\n1) Extracción de texto de un PDF real (pdfjs-dist)');

  let buffer;
  await check('jsPDF genera el PDF de prueba', () => {
    buffer = crearPdf();
    assert(buffer.length > 2000, `PDF demasiado pequeño: ${buffer.length}`);
    assert(fs.readFileSync(PDF_PATH).subarray(0, 5).toString('latin1') === '%PDF-', 'cabecera inválida');
  });

  let texto = '';
  await check('extractFileText recupera el texto capa por capa', async () => {
    const etapas = [];
    const file = {
      name: 'factura-ejemplo.pdf',
      type: 'application/pdf',
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    };
    texto = await extractFileText(file, (s) => etapas.push(s.step));
    assert(texto.length > 50, `texto demasiado corto: ${texto.length} caracteres`);
    assert(etapas.includes('pdf'), 'no se reportó la etapa pdf');
  });

  await check('el texto contiene los marcadores clave de la factura', () => {
    ['FACTURA', 'CloudHosting', 'B-55667788', '1.512,50'].forEach((m) => {
      // pdfjs puede separar espacios: comparamos sin espacios dobles
      const normalizado = texto.replace(/\s+/g, ' ');
      assert(normalizado.includes(m), `no se encuentra «${m}»`);
    });
  });

  await check('un PDF sin capa de texto lanza un error accionable', async () => {
    // PDF sin contenido de texto: solo un rectángulo.
    const vacio = new jsPDF({ unit: 'mm', format: 'a4' });
    vacio.setDrawColor(0, 0, 0);
    vacio.rect(20, 20, 50, 30);
    const buf = Buffer.from(vacio.output('arraybuffer'));
    let error;
    try {
      await extractFileText({
        name: 'vacio.pdf',
        type: 'application/pdf',
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      });
    } catch (e) {
      error = e;
    }
    assert(error, 'no lanzó error con un PDF vacío');
    assert(/capa de texto|escaneado/i.test(error.message), `mensaje inesperado: ${error.message}`);
  });

  /* ---------- 2. DeepSeek JSON Mode (requiere clave) --------------------- */
  const KEY = process.env.DEEPSEEK_KEY || readDotEnv('VITE_DEEPSEEK_API_KEY');
  console.log('\n2) DeepSeek API (JSON Mode con el prompt de la aplicación)');

  if (!KEY) {
    console.log('  ○ omitido: define DEEPSEEK_KEY (o VITE_DEEPSEEK_API_KEY en .env) para ejecutar la llamada real\n');
  } else {
    await check('la API responde y devuelve el esquema fiscal completo', async () => {
      const factura = await extractInvoiceWithDeepSeek({
        apiKey: KEY,
        model: 'deepseek-chat',
        rawText: texto,
        fileName: 'factura-ejemplo.pdf'
      });

      const campos = [
        'tipo',
        'numero_factura',
        'fecha',
        'emisor_nombre',
        'emisor_nif',
        'receptor_nombre',
        'receptor_nif',
        'base_imponible',
        'porcentaje_iva',
        'cuota_iva',
        'porcentaje_irpf',
        'cuota_irpf',
        'total',
        'categoria'
      ];
      campos.forEach((c) => assert(c in factura, `falta el campo «${c}»`));

      assert(factura.tipo === 'GASTO', `tipo = ${factura.tipo}`);
      assert(factura.fecha === '2026-09-15', `fecha = ${factura.fecha}`);
      assert(/^B-\d{8}$/.test(factura.emisor_nif), `NIF emisor = ${factura.emisor_nif}`);
      assert(Math.abs(factura.base_imponible - 1250) < 0.01, `base = ${factura.base_imponible}`);
      assert(Math.abs(factura.cuota_iva - 262.5) < 0.01, `cuota IVA = ${factura.cuota_iva}`);
      assert(Math.abs(factura.total - 1512.5) < 0.01, `total = ${factura.total}`);
      assert(factura.estado === 'Verificada', `estado = ${factura.estado}`);
      assert(validateInvoice(factura) === 'Verificada', 'la validación local falla');
      assert(
        ['Suministros', 'Software', 'Servicios Profesionales', 'Dietas', 'Material', 'Otro'].includes(factura.categoria),
        `categoría = ${factura.categoria}`
      );
      assert(factura.origen === 'deepseek', `origen = ${factura.origen}`);

      console.log('      →', JSON.stringify(factura, null, 2).split('\n').slice(0, 6).join(' '), '…');
    });

    await check('una API key inválida produce un error claro (401)', async () => {
      let error;
      try {
        await extractInvoiceWithDeepSeek({ apiKey: 'sk-invalida-123', rawText: 'factura x', fileName: 'x.txt' });
      } catch (e) {
        error = e;
      }
      assert(error, 'no lanzó error con clave inválida');
      assert(/401|inválida/i.test(error.message), `mensaje inesperado: ${error.message}`);
    });

    await check('un texto no facturable devuelve un error comprensible', async () => {
      let error;
      try {
        await extractInvoiceWithDeepSeek({
          apiKey: KEY,
          model: 'deepseek-chat',
          rawText: 'El martes fui a comprar pan y veo una película por la tarde.',
          fileName: 'nota.txt'
        });
      } catch (e) {
        error = e;
      }
      assert(error, 'no lanzó error con texto no facturable');
      console.log('      →', error.message);
    });
  }

  try {
    fs.unlinkSync(PDF_PATH);
  } catch {
    /* ya eliminado */
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Resultado E2E: ${ok} comprobaciones OK · ${fallos.length} fallos`);
  if (fallos.length) {
    fallos.forEach((f) => console.log(` - ${f.label}: ${f.error.message}`));
    process.exit(1);
  }
  console.log('Pipeline del procesador verificado ✓\n');
})();
