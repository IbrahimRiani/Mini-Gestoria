/* ============================================================================
 * Prueba E2E en Node: motor fiscal, datos demo, exportación Excel y render SSR
 * de las 5 páginas. Detecta ReferenceErrors y errores de ejecución que el
 * build de Vite NO detecta.
 * ========================================================================== */

// --- Stubs de navegador (deben existir antes de cargar el bundle) ----------
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

global.window = {
  atob: global.atob,
  btoa: global.btoa,
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  scrollTo() {},
  addEventListener() {},
  removeEventListener() {}
};

global.navigator = { clipboard: { writeText: async () => {} } };

// PNG real de 1×1 para que jsPDF pueda decodificar la imagen incrustada.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fakeCanvas2d(canvas) {
  const state = {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined; // cualquier método de dibujo es un no-op
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

global.document = {
  documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
  createElement: (tag) => {
    if (tag === 'canvas') {
      const canvas = { width: 0, height: 0, style: {} };
      canvas.getContext = () => fakeCanvas2d(canvas);
      canvas.toDataURL = () => PNG_1PX;
      return canvas;
    }
    return { style: {}, setAttribute() {}, appendChild() {}, remove() {} };
  },
  addEventListener() {},
  removeEventListener() {}
};

const React = require('react');
const { renderToString } = require('react-dom/server');
const XLSX = require('xlsx');

const App = require('./.bundle.cjs');

const {
  default: AppRoot,
  parseAmount,
  normalizeDate,
  validateInvoice,
  normalizeInvoice,
  computeFiscal,
  buildDemoInvoices,
  buildWorkbook,
  exportPdf,
  DashboardPage,
  ProcessorPage,
  LedgerPage,
  ExportPage,
  SettingsPage,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  validateFile,
  MAX_FILE_SIZE,
  DEEPSEEK_TIMEOUT_MS,
  extractInvoiceWithDeepSeek
} = App;

/* --------------------------- mini framework ------------------------------ */
let passed = 0;
const failures = [];
const pendingAsync = [];

function report(label, error) {
  if (error) {
    failures.push({ label, error });
    console.log(`  ✗ ${label}\n      → ${error.message}`);
  } else {
    passed += 1;
    console.log(`  ✓ ${label}`);
  }
}

function check(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      /* Test async: se resuelve antes del resumen final. */
      pendingAsync.push(result.then(() => report(label), (error) => report(label, error)));
      return;
    }
    report(label);
  } catch (error) {
    report(label, error);
  }
}

function assert(condition, message = 'aserción fallida') {
  if (!condition) throw new Error(message);
}

function approx(actual, expected, tolerance = 0.01) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`esperado ${expected}, obtenido ${actual}`);
  }
}

/* ------------------------------- suites --------------------------------- */

console.log('\n1) Utilidades de parsing (formato ES/europeo)');
check('parseAmount("1.234,56") → 1234.56', () => approx(parseAmount('1.234,56'), 1234.56));
check('parseAmount("1,234.56") → 1234.56', () => approx(parseAmount('1,234.56'), 1234.56));
check('parseAmount("149,99 €") → 149.99', () => approx(parseAmount('149,99 €'), 149.99));
check('parseAmount("1200") → 1200', () => approx(parseAmount('1200'), 1200));
check('parseAmount("abc") → 0', () => approx(parseAmount('abc'), 0));
check('normalizeDate("15/03/2026") → 2026-03-15', () => {
  const d = normalizeDate('15/03/2026');
  if (d !== '2026-03-15') throw new Error(`obtenido ${d}`);
});
check('normalizeDate("2026-07-30") se conserva', () => {
  const d = normalizeDate('2026-07-30');
  if (d !== '2026-07-30') throw new Error(`obtenido ${d}`);
});

console.log('\n2) Validación matemática (base + IVA − IRPF = total)');
check('factura cuadrada → Verificada', () => {
  const inv = normalizeInvoice({
    tipo: 'INGRESO',
    base_imponible: 1000,
    porcentaje_iva: 21,
    cuota_iva: 210,
    porcentaje_irpf: 15,
    cuota_irpf: 150,
    total: 1060,
    fecha: '2026-01-01'
  });
  const estado = validateInvoice(inv);
  if (estado !== 'Verificada') throw new Error(`obtenido ${estado}`);
});
check('factura descuadrada → Inconsistente (Revisar)', () => {
  const estado = validateInvoice({ base_imponible: 1000, cuota_iva: 210, cuota_irpf: 0, total: 1300 });
  if (estado !== 'Inconsistente (Revisar)') throw new Error(`obtenido ${estado}`);
});
check('normalizeInvoice recalcula cuota y total si faltan', () => {
  const inv = normalizeInvoice({ tipo: 'GASTO', base_imponible: 200, porcentaje_iva: 21, fecha: '2026-02-01' });
  approx(inv.cuota_iva, 42);
  approx(inv.total, 242);
  if (inv.estado !== 'Verificada') throw new Error(`obtenido ${inv.estado}`);
});

console.log('\n3) Datos de demostración (12 facturas)');
const demo = buildDemoInvoices();
check('son exactamente 12', () => {
  if (demo.length !== 12) throw new Error(`obtenido ${demo.length}`);
});
check('7 ingresos y 5 gastos', () => {
  const ing = demo.filter((i) => i.tipo === 'INGRESO').length;
  const gas = demo.filter((i) => i.tipo === 'GASTO').length;
  if (ing !== 7 || gas !== 5) throw new Error(`${ing} ingresos / ${gas} gastos`);
});
check('11 verificadas y 1 inconsistente a propósito', () => {
  const malas = demo.filter((i) => i.estado !== 'Verificada');
  if (malas.length !== 1) throw new Error(`obtenido ${malas.length} incidencias`);
  if (malas[0].numero_factura !== 'F-2026-018') throw new Error(`falsa alarma en ${malas[0].numero_factura}`);
});
check('categorías válidas todas', () => {
  const validas = ['Suministros', 'Software', 'Servicios Profesionales', 'Dietas', 'Material', 'Otro'];
  demo.forEach((i) => {
    if (!validas.includes(i.categoria)) throw new Error(`categoría inválida: ${i.categoria}`);
  });
});

console.log('\n4) Motor fiscal (ejercicio 2025/2026 sobre datos demo)');
const fiscal = computeFiscal(demo, 2026, DEFAULT_SETTINGS);

check('ingresos totales = 15.953,40 €', () => approx(fiscal.ingresosTotales, 15953.4));
check('gastos totales = 3.349,69 €', () => approx(fiscal.gastosTotales, 3349.69));
check('resultado neto = 12.603,71 €', () => approx(fiscal.resultadoNeto, 12603.71));
check('base ingresos = 14.790,00 €', () => approx(fiscal.baseIngresos, 14790));
check('base gastos = 2.766,39 €', () => approx(fiscal.baseGastos, 2766.39));
check('IVA repercutido = 3.105,90 €', () => approx(fiscal.ivaRepercutido, 3105.9));
check('IVA soportado = 580,94 €', () => approx(fiscal.ivaSoportado, 580.94));
check('liquidación 303 = 2.524,96 €', () => approx(fiscal.liquidacion303, 2524.96));
check('rendimiento neto = 12.023,61 €', () => approx(fiscal.rendimientoNeto, 12023.61));
check('estimación 130 @15% = 1.803,54 €', () => approx(fiscal.estimacion130, 1803.54));
check('retenciones soportadas = 1.942,50 €', () => approx(fiscal.retencionesSoportadas, 360 + 540 + 142.5 + 270 + 630));
check('12 facturas y 1 incidencia', () => {
  if (fiscal.totalFacturas !== 12) throw new Error(`obtenido ${fiscal.totalFacturas}`);
  if (fiscal.incidencias !== 1) throw new Error(`obtenido ${fiscal.incidencias}`);
});
check('presión fiscal acumulada ≈ 27,13 %', () => approx(fiscal.presionFiscal, 27.13, 0.02));

console.log('\n5) Series de gráficos');
check('12 meses con neto = ingresos − gastos', () => {
  if (fiscal.monthly.length !== 12) throw new Error(`obtenido ${fiscal.monthly.length}`);
  fiscal.monthly.forEach((m) => approx(m.neto, m.ingresos - m.gastos));
});
check('enero acumula 2.544 € de ingresos', () => approx(fiscal.monthly[0].ingresos, 2544));
check('mayo no tiene ingresos pero sí gasto (1.754,50 €)', () => {
  approx(fiscal.monthly[4].ingresos, 0);
  approx(fiscal.monthly[4].gastos, 1754.5);
});
check('categorías ordenadas por importe descendente', () => {
  const cats = fiscal.gastosPorCategoria;
  if (!cats.length) throw new Error('sin gastos');
  for (let i = 1; i < cats.length; i += 1) {
    if (cats[i].value > cats[i - 1].value) throw new Error('orden incorrecto');
  }
});
check('Material domina el gasto (1.450 €) y las categorías suman la base de gastos', () => {
  const top = fiscal.gastosPorCategoria[0];
  if (top.name !== 'Material') throw new Error(`top = ${top.name}`);
  approx(top.value, 1450);
  const sumaCategorias = fiscal.gastosPorCategoria.reduce((s, c) => s + c.value, 0);
  approx(sumaCategorias, fiscal.baseGastos);
});
check('las 5 categorías con gasto están presentes', () => {
  const nombres = fiscal.gastosPorCategoria.map((c) => c.name).sort();
  const esperadas = ['Dietas', 'Material', 'Otro', 'Servicios Profesionales', 'Software'].sort();
  if (JSON.stringify(nombres) !== JSON.stringify(esperadas)) {
    throw new Error(`obtenido ${nombres.join(', ')}`);
  }
});

console.log('\n6) Presión fiscal trimestral');
check('T1..T4 presentes con T4 sin actividad', () => {
  if (fiscal.quarters.length !== 4) throw new Error(`obtenido ${fiscal.quarters.length}`);
  approx(fiscal.quarters[3].ingresos, 0);
  approx(fiscal.quarters[3].gastos, 0);
});
check('T1: ingresos 7.367 €, IVA a liquidar 1.203,30 €', () => {
  approx(fiscal.quarters[0].ingresos, 7367);
  approx(fiscal.quarters[0].ivaLiquidado, 1203.3);
});
check('T1: carga = IVA + IRPF y presión ≈ 28 %', () => {
  const t1 = fiscal.quarters[0];
  approx(t1.carga, t1.ivaLiquidado + t1.irpfEstimado);
  assert(t1.presion > 27 && t1.presion < 29, `presión ${t1.presion}`);
});
check('la suma trimestral de ingresos = total anual', () => {
  const suma = fiscal.quarters.reduce((s, q) => s + q.ingresos, 0);
  approx(suma, fiscal.ingresosTotales);
});
check('la suma trimestral de IVA a liquidar = liquidación 303 anual', () => {
  const suma = fiscal.quarters.reduce((s, q) => s + q.ivaLiquidado, 0);
  approx(suma, fiscal.liquidacion303);
});

console.log('\n7) Exportación Excel (3 hojas)');
check('buildWorkbook genera Resumen Fiscal + Emitidas + Recibidas', () => {
  const wb = buildWorkbook(demo, fiscal, 2026, DEFAULT_SETTINGS);
  const names = wb.SheetNames;
  const esperadas = ['Resumen Fiscal', 'Facturas Emitidas', 'Facturas Recibidas'];
  esperadas.forEach((n) => {
    if (!names.includes(n)) throw new Error(`falta la hoja «${n}» · hay: ${names.join(', ')}`);
  });
  if (names.length !== 3) throw new Error(`obtenido ${names.length} hojas`);
});
check('hoja Emitidas tiene 7 filas de datos + autofiltro', () => {
  const wb = buildWorkbook(demo, fiscal, 2026, DEFAULT_SETTINGS);
  const ws = wb.Sheets['Facturas Emitidas'];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const filas = range.e.r - range.s.r; // cabecera + filas
  if (filas !== 7) throw new Error(`obtenido ${filas} filas`);
  if (!ws['!autofilter']) throw new Error('falta autofiltro');
});
check('hoja Recibidas tiene 5 filas de datos', () => {
  const wb = buildWorkbook(demo, fiscal, 2026, DEFAULT_SETTINGS);
  const ws = wb.Sheets['Facturas Recibidas'];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const filas = range.e.r - range.s.r;
  if (filas !== 5) throw new Error(`obtenido ${filas} filas`);
});
check('el resumen incluye el bloque de liquidación 303', () => {
  const wb = buildWorkbook(demo, fiscal, 2026, DEFAULT_SETTINGS);
  const ws = wb.Sheets['Resumen Fiscal'];
  const csv = XLSX.utils.sheet_to_csv(ws);
  ['LIQUIDACIÓN IVA', 'ESTIMACIÓN IRPF', 'TRIMESTRE', 'CATEGORÍA DE GASTOS'].forEach((busca) => {
    if (!csv.includes(busca)) throw new Error(`no se encuentra «${busca}»`);
  });
});

console.log('\n8) Render SSR de las 5 páginas (detecta ReferenceErrors)');
const baseProps = {
  invoices: demo,
  fiscal,
  year: 2026,
  years: [2026],
  onYearChange() {},
  settings: { ...DEFAULT_SETTINGS, empresaNombre: 'Estudio Ribera S.L.', empresaNif: 'B-99887766' },
  aiReady: false,
  onNavigate() {},
  onLoadDemo() {},
  onUpdate() {},
  onDelete() {},
  onCreate() {},
  pushToast() {},
  onSaveMany() {},
  onImportJson() {},
  onPatchSettings() {},
  onThemeChange() {},
  onClearAll() {},
  onMergeInvoices() {},
  theme: 'dark'
};

check('App raíz renderiza sin errores', () => {
  const html = renderToString(React.createElement(AppRoot));
  assert(html.includes('Mini Gestoría') || html.length > 500, 'markup vacío');
});
check('Dashboard renderiza con datos demo', () => {
  const html = renderToString(React.createElement(DashboardPage, baseProps));
  assert(html.includes('Dashboard Financiero'), 'falta el título');
  assert(html.includes('Ingresos totales'), 'falta KPI ingresos');
  assert(html.includes('Liquidación IVA'), 'falta KPI 303');
  assert(html.includes('Modelo 130'), 'falta KPI 130');
  assert(html.includes('Presión fiscal'), 'falta el panel de presión fiscal');
});
check('Dashboard renderiza estado vacío', () => {
  const html = renderToString(React.createElement(DashboardPage, { ...baseProps, invoices: [], fiscal: computeFiscal([], 2026, DEFAULT_SETTINGS) }));
  assert(html.includes('demostración'), 'falta CTA de demo');
});
check('Procesador renderiza dropzone y bandeja', () => {
  const html = renderToString(React.createElement(ProcessorPage, baseProps));
  assert(html.includes('Arrastra aquí tus facturas'), 'falta el dropzone');
  assert(html.includes('Bandeja de revisión'), 'falta la bandeja');
  assert(html.includes('Cómo funciona'), 'falta el panel lateral');
});
check('Libro Registro renderiza tabla con filas y totales', () => {
  const html = renderToString(React.createElement(LedgerPage, baseProps));
  assert(html.includes('Libro Registro de Facturas'), 'falta el título');
  assert(html.includes('Totales de la selección'), 'falta el pie de totales');
  assert(html.includes('Inconsistente'), 'falta la insignia de incidencia');
  assert((html.match(/Clic para editar/g) || []).length >= 5, 'no hay celdas editables');
});
check('Exportación renderiza las 3 tarjetas', () => {
  const html = renderToString(React.createElement(ExportPage, baseProps));
  assert(html.includes('Libro Excel'), 'falta Excel');
  assert(html.includes('Informe PDF oficial'), 'falta PDF');
  assert(html.includes('Copia de seguridad'), 'falta JSON');
  assert(html.includes('Resumen Fiscal'), 'falta vista previa');
});
check('Ajustes: exclusivamente configuración del cliente, sin credenciales ni marca', () => {
  const html = renderToString(React.createElement(SettingsPage, baseProps));

  /* Configuración del cliente */
  assert(html.includes('Datos fiscales del autónomo / empresa'), 'falta la sección de datos fiscales');
  assert(html.includes('NIF / CIF'), 'falta el NIF/CIF');
  assert(html.includes('Domicilio fiscal'), 'falta el domicilio');
  assert(html.includes('Preferencias fiscales'), 'falta la sección fiscal');
  assert(html.includes('Retención IRPF clientes'), 'falta la retención IRPF por defecto');
  assert(html.includes('Apariencia'), 'falta la preferencia de tema');
  assert(html.includes('Opciones de exportación'), 'faltan las opciones de exportación');

  /* Sin introducción de claves y sin panel de integraciones */
  assert(!html.includes('type="password"'), 'queda un campo de contraseña');
  assert(!html.includes('API Key'), 'queda una mención a API Key');
  assert(!html.includes('Project URL'), 'queda el campo de Project URL');
  assert(!html.includes('Anon public key'), 'queda el campo de anon key');
  assert(!html.includes('Supabase'), 'queda UI de Supabase en Ajustes');
  assert(!html.includes('Integraciones'), 'queda la tarjeta de integraciones');
  assert(!html.includes('sk-488e'), 'se filtra la clave en la interfaz');
});

check('la interfaz no menciona al proveedor de IA (DeepSeek / deepseek-chat / Supabase)', () => {
  const brandPattern = /DeepSeek|deepseek-chat|Supabase/i;
  const renders = [
    ['App', renderToString(React.createElement(AppRoot))],
    ['Dashboard', renderToString(React.createElement(DashboardPage, baseProps))],
    ['Procesador', renderToString(React.createElement(ProcessorPage, baseProps))],
    ['Libro', renderToString(React.createElement(LedgerPage, baseProps))],
    ['Exportación', renderToString(React.createElement(ExportPage, baseProps))],
    ['Ajustes', renderToString(React.createElement(SettingsPage, baseProps))]
  ];
  renders.forEach(([name, markup]) => {
    assert(!brandPattern.test(markup), `la página ${name} menciona al proveedor`);
  });

  /* El aviso de desarrollo vive en el Dashboard (donde se usa la IA), sin nombre de variable de marca */
  const dashboard = renders[1][1];
  assert(dashboard.includes('falta la clave del motor de IA'), 'falta el aviso de desarrollo genérico');
  assert(dashboard.includes('.env'), 'el aviso no apunta al archivo .env');
  assert(!dashboard.includes('VITE_DEEPSEEK'), 'el aviso filtra el nombre de la variable con marca');
});

check('el perfil guardado purga credenciales heredadas (migración v1)', () => {
  const s = sanitizeSettings({ empresaNombre: 'X', deepseekApiKey: 'sk-LEAK', supabaseUrl: 'https://x.supabase.co' });
  assert(s.deepseekApiKey === undefined, 'se conserva la clave de DeepSeek heredada');
  assert(s.supabaseUrl === undefined, 'se conserva la URL de Supabase heredada');
  assert(s.empresaNombre === 'X', 'pierde datos legítimos del cliente');
});

check('el código lee las credenciales de import.meta.env (VITE_*)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  assert(src.includes('import.meta.env.VITE_DEEPSEEK_API_KEY'), 'no lee VITE_DEEPSEEK_API_KEY');
  assert(src.includes('import.meta.env.VITE_SUPABASE_URL'), 'no lee VITE_SUPABASE_URL');
  assert(src.includes('import.meta.env.VITE_SUPABASE_ANON_KEY'), 'no lee VITE_SUPABASE_ANON_KEY');
  assert(!/deepseekApiKey:\s*''/.test(src), 'DEFAULT_SETTINGS aún declara deepseekApiKey');
  assert(!/settings\.deepseekApiKey/.test(src), 'aún se usa la clave desde settings/localStorage');
  assert(!/settings\.supabaseUrl/.test(src), 'aún se usa Supabase desde settings/localStorage');
});

check('el .env.example documenta las tres variables sin valores', () => {
  const fs = require('fs');
  const example = fs.readFileSync(require('path').join(__dirname, '..', '.env.example'), 'utf8');
  ['VITE_DEEPSEEK_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].forEach((v) =>
    assert(example.includes(v), `falta ${v}`)
  );
  assert(!/sk-[a-z0-9]{10,}/i.test(example), 'el .env.example contiene una clave real');
});

check('el HTML estático no contiene ninguna credencial', () => {
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert(!/sk-[a-z0-9]{10,}/i.test(html), 'index.html contiene una clave DeepSeek');
  assert(!/sb_secret|eyJhbGciOi/i.test(html), 'index.html contiene una clave Supabase');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  assert(!/sk-[a-z0-9]{16,}/i.test(src), 'App.jsx incrusta una clave DeepSeek');
  assert(!/sb_secret_[a-z0-9]+/i.test(src), 'App.jsx incrusta una clave Supabase');
});

console.log('\n9) Exportación PDF real (jsPDF v4: membrete, impuestos, gráficos y detalle)');
const fs = require('fs');

function cleanGenerated(pattern) {
  fs.readdirSync('.')
    .filter((f) => pattern.test(f))
    .forEach((f) => {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignora */
      }
    });
}

check('genera un PDF con membrete, tablas y libro registro completo', () => {
  cleanGenerated(/^MiniGestoria_Informe_.*\.pdf$/);
  exportPdf({
    invoices: demo,
    fiscal,
    year: 2026,
    settings: baseProps.settings,
    includeCharts: true,
    includeDetail: true
  });

  const generados = fs.readdirSync('.').filter((f) => /^MiniGestoria_Informe_.*\.pdf$/.test(f));
  if (generados.length !== 1) throw new Error(`archivos generados: ${generados.join(', ') || 'ninguno'}`);

  const contenido = fs.readFileSync(generados[0]);
  const cabecera = contenido.subarray(0, 5).toString('latin1');
  if (cabecera !== '%PDF-') throw new Error(`cabecera inválida: ${cabecera}`);
  if (contenido.length < 8000) throw new Error(`PDF demasiado pequeño: ${contenido.length} bytes`);

  const texto = contenido.toString('latin1');
  if (!texto.includes('/Type /Page')) throw new Error('el PDF no contiene páginas');
  if (!texto.includes('/Subtype /Image')) throw new Error('faltan los gráficos incrustados como imagen');

  fs.unlinkSync(generados[0]);
});

check('genera un PDF sin gráficos ni detalle cuando se desactivan', () => {
  cleanGenerated(/^MiniGestoria_Informe_.*\.pdf$/);
  exportPdf({
    invoices: demo,
    fiscal,
    year: 'all',
    settings: baseProps.settings,
    includeCharts: false,
    includeDetail: false
  });

  const generados = fs.readdirSync('.').filter((f) => /^MiniGestoria_Informe_.*\.pdf$/.test(f));
  if (generados.length !== 1) throw new Error('no se generó el PDF');

  const contenido = fs.readFileSync(generados[0]);
  if (contenido.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('cabecera inválida');
  if (contenido.length >= 8000) throw new Error(`el PDF reducido es sospechosamente grande: ${contenido.length}`);

  fs.unlinkSync(generados[0]);
});

console.log('\n10) Validación de archivos y timeout del motor de IA');
check('validateFile acepta un PDF válido', () => {
  const err = validateFile({ name: 'factura.pdf', type: 'application/pdf', size: 1024 });
  if (err !== null) throw new Error(`rechazó un PDF válido: ${err}`);
});
check('validateFile acepta un JPG válido', () => {
  const err = validateFile({ name: 'escaner.jpg', type: 'image/jpeg', size: 2048 });
  if (err !== null) throw new Error(`rechazó un JPG válido: ${err}`);
});
check('validateFile rechaza un archivo > 10 MB', () => {
  const err = validateFile({ name: 'factura.pdf', type: 'application/pdf', size: MAX_FILE_SIZE + 1 });
  if (!err || !/10 MB/.test(err)) throw new Error(`mensaje inesperado: ${err}`);
});
check('validateFile rechaza un formato no admitido', () => {
  const err = validateFile({ name: 'malware.exe', type: 'application/x-msdownload', size: 100 });
  if (!err || !/Formato no admitido/.test(err)) throw new Error(`mensaje inesperado: ${err}`);
});
check('validateFile rechaza un archivo vacío', () => {
  const err = validateFile({ name: 'vacio.pdf', type: 'application/pdf', size: 0 });
  if (!err || !/vacío/.test(err)) throw new Error(`mensaje inesperado: ${err}`);
});
check('el límite es de 10 MB exactos', () => {
  if (MAX_FILE_SIZE !== 10 * 1024 * 1024) throw new Error(`obtenido ${MAX_FILE_SIZE}`);
});
check('declara timeout de 60 s', () => {
  if (DEEPSEEK_TIMEOUT_MS !== 60000) throw new Error(`obtenido ${DEEPSEEK_TIMEOUT_MS}`);
});
check('timeout del motor de IA → mensaje genérico y abortación con signal', async () => {
  const originalFetch = global.fetch;
  let capturedSignal = null;
  global.fetch = async (url, init) => {
    capturedSignal = init?.signal || null;
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  };
  try {
    await extractInvoiceWithDeepSeek({
      apiKey: 'sk-test',
      rawText: 'FACTURA 1\nTotal: 100',
      fileName: 't.pdf'
    });
    throw new Error('no lanzó excepción');
  } catch (error) {
    if (!/superó el tiempo de espera/.test(error.message)) throw new Error(`mensaje inesperado: ${error.message}`);
  } finally {
    global.fetch = originalFetch;
  }
  if (!(capturedSignal instanceof AbortSignal)) throw new Error('no se envió AbortSignal al fetch');
});
check('sin conexión → mensaje de red genérico (sin marca)', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const e = new TypeError('Failed to fetch');
    throw e;
  };
  try {
    await extractInvoiceWithDeepSeek({ apiKey: 'sk-test', rawText: 'x', fileName: 't.pdf' });
    throw new Error('no lanzó excepción');
  } catch (error) {
    if (!/Sin conexión con el servicio de IA/.test(error.message)) throw new Error(`mensaje inesperado: ${error.message}`);
  } finally {
    global.fetch = originalFetch;
  }
});

/* ------------------------------- resumen -------------------------------- */
(async () => {
  await Promise.all(pendingAsync);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Resultado: ${passed} comprobaciones OK · ${failures.length} fallos`);
  if (failures.length) {
    console.log('\nFallos:');
    failures.forEach((f) => console.log(` - ${f.label}: ${f.error.message}`));
    process.exit(1);
  }
  console.log('Todas las comprobaciones han pasado ✓\n');
})();
