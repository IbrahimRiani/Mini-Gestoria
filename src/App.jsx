/* ============================================================================
 * MINI GESTORÍA INTELIGENTE B2B
 * Archivo unificado de aplicación — src/App.jsx
 * ----------------------------------------------------------------------------
 * Índice:
 *  1. Dependencias
 *  2. Constantes y tokens de dominio
 *  3. Utilidades (formato ES, fechas, números, validación)
 *  4. Persistencia Local-First (localStorage)
 *  5. Servicios: DeepSeek · Extractores de texto (PDF/OCR) · Supabase
 *  6. Motor fiscal (303 · 130 · presión fiscal por trimestre)
 *  7. Datos de demostración
 *  8. Primitivas de interfaz (Sistema de diseño)
 *  9. Gráficos (Recharts + presión fiscal)
 * 10. Páginas: Dashboard · Procesador · Libro Registro · Exportación · Ajustes
 * 11. Shell (navegación) y componente App
 * ============================================================================ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Braces,
  Calculator,
  ChartColumn,
  ChartPie,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  Database,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Image,
  Info,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LoaderCircle,
  Lock,
  Menu,
  Monitor,
  Moon,
  Pencil,
  Play,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Scale,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  Trash,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Upload,
  Wallet,
  X,
  Zap
} from 'lucide-react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

/* ============================================================================
 * 2. CONSTANTES Y TOKENS DE DOMINIO
 * ========================================================================== */

const CATEGORIAS = [
  'Suministros',
  'Software',
  'Servicios Profesionales',
  'Dietas',
  'Material',
  'Otro'
];

/** Paleta de series: distinción por tono + posición, legible en ambos temas. */
const CATEGORIA_COLORS = {
  Suministros: '#0ea5e9',
  Software: '#6366f1',
  'Servicios Profesionales': '#10b981',
  Dietas: '#f59e0b',
  Material: '#a855f7',
  Otro: '#64748b'
};

const SERIES = {
  ingresos: '#10b981', // esmeralda
  gastos: '#f43f5e', // rojo financiero
  iva: '#1e40af', // azul marino
  irpf: '#f59e0b'
};

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const MESES_LARGOS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

const TRIMESTRES = [
  { id: 'T1', meses: [0, 1, 2] },
  { id: 'T2', meses: [3, 4, 5] },
  { id: 'T3', meses: [6, 7, 8] },
  { id: 'T4', meses: [9, 10, 11] }
];

const STORAGE_KEYS = {
  invoices: 'mg_invoices_v1',
  settings: 'mg_settings_v1',
  theme: 'mg_theme_v1'
};

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

/** Límite por archivo antes de leerlo (evita colgar el navegador con OCR de ficheros enormes). */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Tiempo máximo de espera a DeepSeek antes de abortar la petición. */
const DEEPSEEK_TIMEOUT_MS = 60000; // 60 s

/** Extensiones admitidas en el dropzone (validación previa, el atributo `accept` solo filtra el selector). */
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif', '.txt', '.csv'];

/**
 * Validación previa de tipo y tamaño. Devuelve un mensaje de error humano o `null` si el archivo es válido.
 * Se aplica tanto al selector como al drag & drop (el `accept` del input no protege al drop).
 */
function validateFile(file) {
  if (!file) return 'Archivo no válido.';
  const name = String(file.name || '').toLowerCase();
  const ext = ACCEPTED_EXTENSIONS.find((e) => name.endsWith(e));
  if (!ext && !file.type?.startsWith('image/') && file.type !== 'application/pdf' && file.type !== 'text/csv' && file.type !== 'text/plain') {
    return `Formato no admitido (${file.name}). Usa ${ACCEPTED_EXTENSIONS.join(', ')}.`;
  }
  if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
    return `El archivo supera los 10 MB (${(file.size / 1024 / 1024).toFixed(1)} MB). Comprime o divide la factura.`;
  }
  if (file.size === 0) return 'El archivo está vacío.';
  return null;
}

/** Versiones fijas de los binarios de OCR (se descargan solo al usarlos). */
const TESSERACT = {
  worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  lang: 'https://tessdata.projectnaptha.com/4.0.0'
};

/* ============================================================================
 * CREDENCIALES DE PROVEEDOR — variables de entorno (.env)
 * ==========================================================================
 * Vite inyecta estas variables en build (prefijo VITE_). El cliente final NUNCA
 * las introduce ni las ve en la interfaz: si faltan, la aplicación muestra un
 * aviso de desarrollo y sigue operativa en modo local (alta manual, demo,
 * exportaciones) sin pedir ninguna clave.
 *
 * Nota de seguridad: lo prefijado con VITE_ viaja al bundle del navegador;
 * para producción se recomienda un proxy de servidor que añada la cabecera
 * Authorization (ver README → «Credenciales y proxy»).
 */

const readEnvVar = (get) => {
  try {
    const value = get();
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
};

const ENV = {
  deepseekApiKey: readEnvVar(() => import.meta.env.VITE_DEEPSEEK_API_KEY),
  supabaseUrl: readEnvVar(() => import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: readEnvVar(() => import.meta.env.VITE_SUPABASE_ANON_KEY)
};

/** Modelo fijo de DeepSeek: no es un dato del cliente, por eso no es configurable en la UI. */
const DEEPSEEK_MODEL = 'deepseek-chat';

/** Aviso de desarrollo (sin pedir claves ni mostrar marca) cuando falta la variable de entorno. */
function envNotice() {
  return 'Aviso de desarrollo: falta la clave del motor de IA en el archivo .env del proyecto (ver .env.example). Define la variable y reinicia el servidor (npm run dev). Mientras tanto, la app funciona en modo local sin IA.';
}

/**
 * Ajustes por defecto del cliente: solo configuración propia (datos fiscales,
 * preferencias y exportación). No contienen credenciales de ningún proveedor.
 */
const DEFAULT_SETTINGS = {
  empresaNombre: '',
  empresaNif: '',
  empresaDomicilio: '',
  empresaEmail: '',
  tipoIva: 21,
  tipoIrpfRetencion: 15,
  tipoIrpf130: 15,
  exportIncluirGraficos: true,
  exportIncluirDetalle: true
};

/** Claves residuales de versiones anteriores que deben purgarse del perfil. */
const LEGACY_SECRET_SETTINGS = ['deepseekApiKey', 'deepseekModel', 'supabaseUrl', 'supabaseAnonKey'];

/** Fusiona el perfil guardado con los defaults y elimina cualquier credencial heredada. */
function sanitizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  LEGACY_SECRET_SETTINGS.forEach((k) => delete merged[k]);
  return merged;
}

const DEEPSEEK_SCHEMA_HINT = `{
  "tipo": "GASTO" | "INGRESO",
  "numero_factura": "STRING",
  "fecha": "YYYY-MM-DD",
  "emisor_nombre": "STRING",
  "emisor_nif": "STRING",
  "receptor_nombre": "STRING",
  "receptor_nif": "STRING",
  "base_imponible": 0.00,
  "porcentaje_iva": 21,
  "cuota_iva": 0.00,
  "porcentaje_irpf": 0,
  "cuota_irpf": 0.00,
  "total": 0.00,
  "categoria": "Suministros | Software | Servicios Profesionales | Dietas | Material | Otro"
}`;

/* ============================================================================
 * 3. UTILIDADES
 * ========================================================================== */

const cx = (...parts) => parts.filter(Boolean).join(' ');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const pad2 = (n) => String(n).padStart(2, '0');

const uid = () =>
  `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const EUR_FMT = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const EUR_FMT_SHORT = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
});

const NUM_FMT = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const formatEUR = (n) => EUR_FMT.format(Number(n) || 0);
const formatEUR0 = (n) => EUR_FMT_SHORT.format(Number(n) || 0);
const formatNum = (n) => NUM_FMT.format(Number(n) || 0);

/** Versión abreviada para ejes de gráfico (1,2 k€). */
const formatAxis = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} k€`;
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
};

const formatPct = (n, digits = 1) =>
  `${(Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: digits })} %`;

const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const todayISO = () => toISODate(new Date());

/**
 * Normaliza fechas en distintos formatos a `YYYY-MM-DD`.
 * Acepta: 2026-03-15 · 15/03/2026 · 15-3-26 · «15 de marzo de 2026» (Date).
 */
function normalizeDate(value) {
  if (!value) return todayISO();
  const s = String(value).trim();
  if (!s) return todayISO();

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${pad2(m[2])}-${pad2(m[1])}`; // formato español día/mes
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);
  return todayISO();
}

/**
 * Convierte importes en formato español/europeo a número.
 * Soporta: 1.234,56 · 1234.56 · 1,234.56 · "1 234,56 €" · 1200
 */
function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value) : 0;
  if (value === null || value === undefined) return 0;
  let s = String(value).replace(/[€\s\u00a0]/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    // «1,5» → decimal · «1,500» (3 dígitos finales) → miles
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0].length > 0 && Number(parts[0]) >= 1000 && s.indexOf(',') === s.lastIndexOf(',')
      ? parts.join('')
      : s.replace(',', '.');
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? round2(n) : 0;
}

const getYear = (isoDate) => Number(String(isoDate || '').slice(0, 4)) || new Date().getFullYear();
const getMonth = (isoDate) => Number(String(isoDate || '').slice(5, 7)) - 1;
const getQuarter = (isoDate) => Math.floor(getMonth(isoDate) / 3) + 1;

/** Validación matemática local exigida por la ficha de producto. */
function validateInvoice(inv) {
  const expected = round2((Number(inv.base_imponible) || 0) + (Number(inv.cuota_iva) || 0) - (Number(inv.cuota_irpf) || 0));
  const diff = Math.abs(round2(expected - (Number(inv.total) || 0)));
  return diff <= 0.01 ? 'Verificada' : 'Inconsistente (Revisar)';
}

const isValid = (estado) => estado === 'Verificada';

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return '••••••••';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================================
 * 4. PERSISTENCIA LOCAL-FIRST
 * ========================================================================== */

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Escribe en localStorage. Devuelve `false` si falla (cuota superada, modo privado). */
function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    /* cuota superada o modo privado: la app sigue operativa en memoria, pero el llamante debe avisar */
    return false;
  }
}

/** Normaliza cualquier factura entrante (demo, IA, importación, Supabase). */
function normalizeInvoice(raw = {}) {
  const tipo = String(raw.tipo || '').toUpperCase().includes('GASTO') ? 'GASTO' : 'INGRESO';

  const base = round2(parseAmount(raw.base_imponible));
  let porcentajeIva = Number(raw.porcentaje_iva);
  if (!Number.isFinite(porcentajeIva)) porcentajeIva = DEFAULT_SETTINGS.tipoIva;
  let porcentajeIrpf = Number(raw.porcentaje_irpf);
  if (!Number.isFinite(porcentajeIrpf)) porcentajeIrpf = 0;

  let cuotaIva = round2(parseAmount(raw.cuota_iva));
  if (!cuotaIva && base) cuotaIva = round2((base * porcentajeIva) / 100);

  let cuotaIrpf = round2(parseAmount(raw.cuota_irpf));
  if (!cuotaIrpf && base && porcentajeIrpf) cuotaIrpf = round2((base * porcentajeIrpf) / 100);

  let total = round2(parseAmount(raw.total));
  if (!total && base) total = round2(base + cuotaIva - cuotaIrpf);

  const categoria = CATEGORIAS.includes(raw.categoria)
    ? raw.categoria
    : CATEGORIAS.includes(String(raw.categoria || '').trim())
      ? String(raw.categoria).trim()
      : 'Otro';

  const inv = {
    id: raw.id || uid(),
    tipo,
    numero_factura: String(raw.numero_factura || raw.numero || '').trim(),
    fecha: normalizeDate(raw.fecha),
    emisor_nombre: String(raw.emisor_nombre || '').trim(),
    emisor_nif: String(raw.emisor_nif || '').toUpperCase().trim(),
    receptor_nombre: String(raw.receptor_nombre || '').trim(),
    receptor_nif: String(raw.receptor_nif || '').toUpperCase().trim(),
    base_imponible: base,
    porcentaje_iva: round2(porcentajeIva),
    cuota_iva: cuotaIva,
    porcentaje_irpf: round2(porcentajeIrpf),
    cuota_irpf: cuotaIrpf,
    total,
    categoria,
    origen: raw.origen || 'manual',
    created_at: raw.created_at || new Date().toISOString()
  };

  inv.estado = validateInvoice(inv);
  return inv;
}

/** Recalcula importes derivados tras una edición in-line. */
function recalcInvoice(inv, { base, porcentajeIva, porcentajeIrpf, cuotaIrpf } = {}) {
  const next = { ...inv };
  if (base !== undefined) next.base_imponible = round2(base);
  if (porcentajeIva !== undefined) next.porcentaje_iva = round2(porcentajeIva);
  if (porcentajeIrpf !== undefined) next.porcentaje_irpf = round2(porcentajeIrpf);

  next.cuota_iva = round2(((Number(next.base_imponible) || 0) * (Number(next.porcentaje_iva) || 0)) / 100);

  if (cuotaIrpf !== undefined) next.cuota_irpf = round2(cuotaIrpf);
  else if (next.porcentaje_irpf > 0) {
    next.cuota_irpf = round2(((Number(next.base_imponible) || 0) * Number(next.porcentaje_irpf)) / 100);
  } else {
    next.cuota_irpf = 0;
  }

  next.total = round2((Number(next.base_imponible) || 0) + next.cuota_iva - next.cuota_irpf);
  next.estado = validateInvoice(next);
  return next;
}

/* ============================================================================
 * 5. SERVICIOS
 * ========================================================================== */

/* ---------- 5.1 DeepSeek (JSON Mode) ------------------------------------- */

function buildSystemPrompt() {
  return [
    'Eres un extractor de datos fiscales de facturas españolas para una gestoría.',
    'Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin markdown, sin comentarios y sin texto adicional.',
    `Schema obligatorio: ${DEEPSEEK_SCHEMA_HINT}`,
    'Reglas:',
    '- "fecha" siempre en formato YYYY-MM-DD (si es española dd/mm/aaaa, invierte el orden).',
    '- Importes numéricos con punto decimal, sin símbolo de moneda.',
    '- "porcentaje_iva": 21, 10, 4 o 0 según la factura; "cuota_iva" = base * IVA / 100.',
    '- "porcentaje_irpf": 15, 7 o 0 (retención del emisor solo aparece en facturas de ingreso de servicios profesionales).',
    '- Si la factura es un gasto para el usuario, "tipo" = "GASTO"; si es un ingreso cobrado, "tipo" = "INGRESO".',
    '- "categoria" debe ser exactamente uno de: Suministros, Software, Servicios Profesionales, Dietas, Material, Otro.',
    '- Si un dato no aparece en el documento usa cadena vacía o 0, nunca inventes NIF.',
    '- Si el texto no contiene una factura responde con {"error": "DESCRIPCION_BREVE"}.'
  ].join('\n');
}

function parseJsonSafe(content) {
  if (!content) throw new Error('La IA devolvió una respuesta vacía.');
  let text = String(content).trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('No se pudo interpretar la respuesta de la IA. Inténtalo de nuevo.');
  }
}

async function extractInvoiceWithDeepSeek({ apiKey, model = DEEPSEEK_MODEL, rawText, fileName = '' }) {
  if (!apiKey) throw new Error(envNotice());

  const contenido = [
    fileName ? `Archivo: ${fileName}` : null,
    'Texto extraído del documento:',
    '"""\n' + String(rawText || '').slice(0, 12000) + '\n"""'
  ]
    .filter(Boolean)
    .join('\n');

  let res;
  try {
    res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS) : undefined,
      body: JSON.stringify({
        model,
        temperature: 0,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: contenido }
        ]
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(
        `El motor de IA superó el tiempo de espera (${DEEPSEEK_TIMEOUT_MS / 1000} s). Revisa tu conexión y reintenta.`
      );
    }
    throw new Error('Sin conexión con el servicio de IA. Revisa tu red o CORS.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || '';
    } catch {
      /* respuesta no JSON */
    }
    if (res.status === 401) throw new Error('Clave de entorno inválida o revocada (401). Revisa la variable del motor de IA en el archivo .env.');
    if (res.status === 402) throw new Error('Crédito agotado en el servicio de IA (402).');
    if (res.status === 429) throw new Error('Límite de IA alcanzado (429). Reintenta en unos segundos.');
    throw new Error(`El servicio de IA respondió ${res.status}${detail ? `: ${detail}` : ''}.`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = parseJsonSafe(content);

  if (parsed?.error) throw new Error(`La IA no reconoció una factura: ${parsed.error}`);

  const invoice = normalizeInvoice({ ...parsed, origen: 'deepseek' });
  invoice.sourceFile = fileName;
  return invoice;
}

async function testDeepSeekConnection(apiKey, model = DEEPSEEK_MODEL) {
  if (!apiKey) throw new Error(envNotice());
  let res;
  try {
    res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Responde solo: OK' }]
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('La conexión superó los 15 s de espera. Revisa tu red.');
    }
    throw new Error('Sin conexión con el servicio de IA.');
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('401 · Clave no válida (revisa el archivo .env).');
    throw new Error(`La conexión falló (HTTP ${res.status}).`);
  }
  return true;
}

/* ---------- 5.2 Extractores de texto: PDF · imagen(OCR) · texto ----------- */

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist')
      .then(async (pdfjs) => {
        try {
          const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        } catch {
          // Entorno sin bundler (tests Node): pdfjs usa su worker integrado.
        }
        return pdfjs;
      })
      .catch((error) => {
        pdfjsPromise = null;
        throw error;
      });
  }
  return pdfjsPromise;
}

async function extractPdfText(file, onStage) {
  onStage?.({ step: 'pdf', progress: 0.1 });
  const pdfjs = await loadPdfjs();
  const data = await file.arrayBuffer();

  let doc;
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  } catch (error) {
    throw new Error(
      `El PDF está dañado, protegido o no es un PDF válido (${error?.name || 'error'}). Vuelve a descargar el documento o pega el texto manualmente.`
    );
  }

  const chunks = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items.map((it) => it.str).join(' ');
    if (line.trim()) chunks.push(line);
    onStage?.({ step: 'pdf', progress: 0.1 + (p / doc.numPages) * 0.8 });
  }
  await doc.destroy?.();

  const text = chunks.join('\n').trim();
  onStage?.({ step: 'pdf', progress: 1 });
  if (!text) {
    throw new Error('El PDF no contiene capa de texto (probablemente esté escaneado). Exporta a imagen o pega el texto.');
  }
  return text;
}

async function extractImageText(file, onStage) {
  onStage?.({ step: 'ocr', progress: 0 });
  let Tesseract;
  try {
    Tesseract = await import('tesseract.js');
  } catch {
    throw new Error('No se pudo cargar el módulo OCR. Pega el texto de la factura manualmente.');
  }

  let worker;
  try {
    worker = await Tesseract.createWorker('spa', 1, {
      logger: (m) => {
        if (m?.status === 'recognizing text') onStage?.({ step: 'ocr', progress: m.progress || 0 });
      },
      workerPath: TESSERACT.worker,
      corePath: TESSERACT.core,
      langPath: TESSERACT.lang
    });

    const { data } = await worker.recognize(file);
    const text = (data?.text || '').trim();
    if (!text) throw new Error('OCR vacío');
    onStage?.({ step: 'ocr', progress: 1 });
    return text;
  } catch (error) {
    throw new Error(
      `No se pudo leer la imagen (OCR). ${error?.message ? `Detalle: ${error.message}. ` : ''}Puedes pegar el texto manualmente.`
    );
  } finally {
    try {
      await worker?.terminate?.();
    } catch {
      /* ya terminado */
    }
  }
}

async function extractFileText(file, onStage) {
  const name = file.name.toLowerCase();

  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/.test(name)) {
    return extractImageText(file, onStage);
  }

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdfText(file, onStage);
  }

  // TXT / CSV / JSON y cualquier texto plano
  onStage?.({ step: 'read', progress: 0.5 });
  const text = await file.text();
  onStage?.({ step: 'read', progress: 1 });
  if (!text.trim()) throw new Error('El archivo está vacío.');
  return text;
}

/* ---------- 5.3 Supabase (opcional, importación diferida) ---------------- */

async function getSupabaseClient(url, anonKey) {
  if (!url || !anonKey) throw new Error('Supabase no configurado: faltan las variables de entorno en el archivo .env.');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function invoiceToRow(inv) {
  return {
    id: inv.id,
    tipo: inv.tipo,
    numero_factura: inv.numero_factura,
    fecha: inv.fecha,
    emisor_nombre: inv.emisor_nombre,
    emisor_nif: inv.emisor_nif,
    receptor_nombre: inv.receptor_nombre,
    receptor_nif: inv.receptor_nif,
    base_imponible: inv.base_imponible,
    porcentaje_iva: inv.porcentaje_iva,
    cuota_iva: inv.cuota_iva,
    porcentaje_irpf: inv.porcentaje_irpf,
    cuota_irpf: inv.cuota_irpf,
    total: inv.total,
    categoria: inv.categoria,
    estado: inv.estado,
    origen: inv.origen
  };
}

async function testSupabaseConnection(url, anonKey) {
  const client = await getSupabaseClient(url, anonKey);
  const { error } = await client.from('facturas').select('id', { count: 'exact', head: true });
  if (error) throw new Error(`${error.message}${error.details ? ` · ${error.details}` : ''}`);
  return true;
}

async function pushToSupabase(url, anonKey, invoices) {
  const client = await getSupabaseClient(url, anonKey);
  const rows = invoices.map(invoiceToRow);
  const { error } = await client.from('facturas').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Subida rechazada: ${error.message}`);
  return rows.length;
}

async function pullFromSupabase(url, anonKey) {
  const client = await getSupabaseClient(url, anonKey);
  const { data, error } = await client.from('facturas').select('*').order('fecha', { ascending: false });
  if (error) throw new Error(`Descarga rechazada: ${error.message}`);
  return (data || []).map((row) => normalizeInvoice({ ...row, origen: row.origen || 'supabase' }));
}

/** Fusión conservadora: gana el local por id; añade los remotos nuevos. */
function mergeInvoices(local, remote) {
  const byId = new Map();
  remote.forEach((r) => byId.set(r.id, r));
  local.forEach((l) => byId.set(l.id, l));
  return Array.from(byId.values());
}

/* ============================================================================
 * 6. MOTOR FISCAL
 * ========================================================================== */

function emptyFiscal() {
  return {
    ingresosTotales: 0,
    gastosTotales: 0,
    resultadoNeto: 0,
    baseIngresos: 0,
    baseGastos: 0,
    margenNeto: 0,
    ivaRepercutido: 0,
    ivaSoportado: 0,
    liquidacion303: 0,
    rendimientoNeto: 0,
    estimacion130: 0,
    retencionesSoportadas: 0,
    presionFiscal: 0,
    totalFacturas: 0,
    incidencias: 0,
    monthly: MESES.map((mes, i) => ({ mes, indice: i, ingresos: 0, gastos: 0, neto: 0 })),
    gastosPorCategoria: CATEGORIAS.map((name) => ({ name, value: 0, count: 0 })),
    quarters: TRIMESTRES.map((q) => ({
      id: q.id,
      ingresos: 0,
      gastos: 0,
      ivaLiquidado: 0,
      irpfEstimado: 0,
      carga: 0,
      presion: 0
    }))
  };
}

/**
 * Agrega el libro registro para un ejercicio (o `all`).
 * Estimaciones orientativas — ver README > Modelo fiscal.
 */
function computeFiscal(invoices, year, settings) {
  const out = emptyFiscal();
  const scoped = invoices.filter((inv) => (year === 'all' ? true : getYear(inv.fecha) === year));

  out.totalFacturas = scoped.length;
  out.incidencias = scoped.filter((inv) => !isValid(inv.estado)).length;

  const monthly = out.monthly;
  const quarters = out.quarters;
  const catMap = new Map(CATEGORIAS.map((c) => [c, { name: c, value: 0, count: 0 }]));

  scoped.forEach((inv) => {
    const base = Number(inv.base_imponible) || 0;
    const total = Number(inv.total) || 0;
    const iva = Number(inv.cuota_iva) || 0;
    const irpf = Number(inv.cuota_irpf) || 0;
    const m = clamp(getMonth(inv.fecha), 0, 11);
    const q = quarters[Math.floor(m / 3)];

    if (inv.tipo === 'INGRESO') {
      out.ingresosTotales += total;
      out.baseIngresos += base;
      out.ivaRepercutido += iva;
      out.retencionesSoportadas += irpf;
      monthly[m].ingresos += total;
      q.ingresos += total;
    } else {
      out.gastosTotales += total;
      out.baseGastos += base;
      out.ivaSoportado += iva;
      monthly[m].gastos += total;
      q.gastos += total;

      const bucket = catMap.get(inv.categoria) || catMap.get('Otro');
      bucket.value += base;
      bucket.count += 1;
    }
  });

  out.resultadoNeto = out.ingresosTotales - out.gastosTotales;
  out.margenNeto = out.ingresosTotales > 0 ? (out.resultadoNeto / out.ingresosTotales) * 100 : 0;
  out.liquidacion303 = out.ivaRepercutido - out.ivaSoportado;
  out.rendimientoNeto = out.baseIngresos - out.baseGastos;
  out.estimacion130 = round2(Math.max(0, (out.rendimientoNeto * (Number(settings.tipoIrpf130) || 0)) / 100));
  out.presionFiscal =
    out.ingresosTotales > 0
      ? ((Math.max(0, out.liquidacion303) + out.estimacion130) / out.ingresosTotales) * 100
      : 0;

  out.monthly = monthly.map((row) => ({ ...row, neto: row.ingresos - row.gastos }));
  out.gastosPorCategoria = Array.from(catMap.values())
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  out.quarters = quarters.map((row) => ({
    id: row.id,
    ingresos: row.ingresos,
    gastos: row.gastos,
    ivaRep: 0,
    ivaSop: 0,
    ivaLiquidado: 0,
    irpfEstimado: 0,
    carga: 0,
    presion: 0
  }));

  out.monthly = monthly.map((row) => ({ ...row, neto: row.ingresos - row.gastos }));
  out.gastosPorCategoria = Array.from(catMap.values())
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  // Cálculo trimestral preciso (suma directa, nunca proporcional).
  const qAgg = TRIMESTRES.map(() => ({ ivaRep: 0, ivaSop: 0, baseIng: 0, baseGas: 0 }));
  scoped.forEach((inv) => {
    const qi = Math.floor(clamp(getMonth(inv.fecha), 0, 11) / 3);
    if (inv.tipo === 'INGRESO') {
      qAgg[qi].ivaRep += Number(inv.cuota_iva) || 0;
      qAgg[qi].baseIng += Number(inv.base_imponible) || 0;
    } else {
      qAgg[qi].ivaSop += Number(inv.cuota_iva) || 0;
      qAgg[qi].baseGas += Number(inv.base_imponible) || 0;
    }
  });

  out.quarters = out.quarters.map((row, i) => {
    const agg = qAgg[i];
    const ivaLiquidado = agg.ivaRep - agg.ivaSop;
    const rendimiento = agg.baseIng - agg.baseGas;
    const irpfEstimado = Math.max(0, (rendimiento * (Number(settings.tipoIrpf130) || 0)) / 100);
    const carga = Math.max(0, ivaLiquidado) + irpfEstimado;
    return {
      ...row,
      ivaRep: agg.ivaRep,
      ivaSop: agg.ivaSop,
      ivaLiquidado,
      irpfEstimado,
      carga,
      presion: row.ingresos > 0 ? (carga / row.ingresos) * 100 : 0
    };
  });

  return out;
}

/* ============================================================================
 * 7. DATOS DE DEMOSTRACIÓN (12 facturas)
 * ========================================================================== */

const DEMO_ROWS = [
  // --- INGRESOS (facturas emitidas) ---
  ['INGRESO', 'E-2026-001', '2026-01-15', 'Nortia Digital S.L.', 'B-8842190', 'Estudio Ribera S.L.', 'B-99887766', 2400, 21, 15, 'Servicios Profesionales'],
  ['INGRESO', 'E-2026-002', '2026-02-10', 'Vantso Retail S.A.', 'A-77123455', 'Estudio Ribera S.L.', 'B-99887766', 3600, 21, 15, 'Servicios Profesionales'],
  ['INGRESO', 'E-2026-003', '2026-03-05', 'Clínica Aurora S.L.', 'B-44556677', 'Estudio Ribera S.L.', 'B-99887766', 950, 21, 15, 'Servicios Profesionales'],
  ['INGRESO', 'E-2026-004', '2026-04-20', 'Grupo Meridiano S.L.', 'B-33112244', 'Estudio Ribera S.L.', 'B-99887766', 1800, 21, 15, 'Servicios Profesionales'],
  ['INGRESO', 'E-2026-005', '2026-06-12', 'Fundación Aldea Verde', 'G-22998877', 'Estudio Ribera S.L.', 'B-99887766', 1200, 21, 0, 'Servicios Profesionales'],
  ['INGRESO', 'E-2026-006', '2026-07-30', 'Helios Cloud España S.L.', 'B-66554433', 'Estudio Ribera S.L.', 'B-99887766', 4200, 21, 15, 'Servicios Profesionales'],
  ['INGRESO', 'E-2026-007', '2026-09-02', 'Delta Analytics B.V.', 'NL-88224411B01', 'Estudio Ribera S.L.', 'B-99887766', 640, 21, 0, 'Software'],

  // --- GASTOS (facturas recibidas) ---
  ['GASTO', 'F-2026-014', '2026-01-20', 'Inmobiliaria Paseo S.L.', 'B-11223344', 'Estudio Ribera S.L.', 'B-99887766', 850, 21, 0, 'Otro'],
  ['GASTO', 'F-2026-015', '2026-02-28', 'Gestoría Larrañaga S.L.', 'B-99112233', 'Estudio Ribera S.L.', 'B-99887766', 220, 21, 0, 'Servicios Profesionales'],
  ['GASTO', 'F-2026-016', '2026-03-15', 'CloudHosting Ibérica S.L.', 'B-55667788', 'Estudio Ribera S.L.', 'B-99887766', 149.99, 21, 0, 'Software'],
  ['GASTO', 'F-2026-017', '2026-05-08', 'TecnoHardware Ibérica S.L.', 'B-77889900', 'Estudio Ribera S.L.', 'B-99887766', 1450, 21, 0, 'Material'],
  // ⚠ Inconsistente a propósito (total desviado +2,36 €) para mostrar el badge de validación.
  ['GASTO', 'F-2026-018', '2026-06-21', 'Restaurante El Fogón S.L.', 'B-22446688', 'Estudio Ribera S.L.', 'B-99887766', 96.4, 21, 0, 'Dietas', 119]
];

function buildDemoInvoices() {
  return DEMO_ROWS.map((row, index) => {
    const [tipo, numero, fecha, emisor, emisorNif, receptor, receptorNif, base, iva, irpf, categoria, totalOverride] = row;
    const cuotaIva = round2((base * iva) / 100);
    const cuotaIrpf = round2((base * irpf) / 100);
    const total = totalOverride !== undefined ? totalOverride : round2(base + cuotaIva - cuotaIrpf);

    return normalizeInvoice({
      id: `demo_${index + 1}`,
      tipo,
      numero_factura: numero,
      fecha,
      emisor_nombre: emisor,
      emisor_nif: emisorNif,
      receptor_nombre: receptor,
      receptor_nif: receptorNif,
      base_imponible: base,
      porcentaje_iva: iva,
      cuota_iva: cuotaIva,
      porcentaje_irpf: irpf,
      cuota_irpf: cuotaIrpf,
      total,
      categoria,
      origen: 'demo'
    });
  });
}

const SQL_SUPABASE_SNIPPET = `create table if not exists public.facturas (
  id text primary key, tipo text not null, numero_factura text default '',
  fecha date not null, emisor_nombre text default '', emisor_nif text default '',
  receptor_nombre text default '', receptor_nif text default '',
  base_imponible numeric(12,2) default 0, porcentaje_iva numeric(5,2) default 21,
  cuota_iva numeric(12,2) default 0, porcentaje_irpf numeric(5,2) default 0,
  cuota_irpf numeric(12,2) default 0, total numeric(12,2) default 0,
  categoria text default 'Otro', estado text default 'Verificada',
  origen text default 'manual', created_at timestamptz default now()
);
alter table public.facturas enable row level security;
create policy "demo anon full access" on public.facturas
  for all using (true) with check (true);`;

/* ============================================================================
 * 8. PRIMITIVAS DE INTERFAZ — Sistema de diseño
 * ========================================================================== */

const TONES = {
  emerald: {
    chip: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400',
    icon: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    solid: 'bg-emerald-600 text-white'
  },
  rose: {
    chip: 'bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-400',
    icon: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    solid: 'bg-rose-600 text-white'
  },
  blue: {
    chip: 'bg-blue-500/12 text-blue-700 ring-blue-500/25 dark:text-blue-400',
    icon: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',
    solid: 'bg-blue-700 text-white'
  },
  amber: {
    chip: 'bg-amber-500/14 text-amber-700 ring-amber-500/25 dark:text-amber-400',
    icon: 'bg-amber-500/14 text-amber-700 dark:text-amber-400',
    solid: 'bg-amber-500 text-white'
  },
  slate: {
    chip: 'bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-300',
    icon: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
    solid: 'bg-slate-700 text-white'
  }
};

function Card({ title, subtitle, actions, children, className = '', bodyClassName = '' }) {
  return (
    <section className={cx('glass-card overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}

function KpiCard({ label, value, hint, icon: Icon, tone = 'slate', badge }) {
  const t = TONES[tone] || TONES.slate;
  return (
    <article className="glass-card group relative p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className={cx('flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset', t.chip)}>
          {Icon && <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />}
        </div>
        {badge}
      </div>

      <p className="section-title mt-3">{label}</p>

      <p className="tabular mt-1.5 text-[1.6rem] font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
        {value}
      </p>

      {hint && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>}
    </article>
  );
}

function Badge({ tone = 'slate', children, icon: Icon, className = '' }) {
  const t = TONES[tone] || TONES.slate;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset',
        t.chip,
        className
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

function StatusBadge({ estado }) {
  const ok = isValid(estado);
  return ok ? (
    <Badge tone="emerald" icon={CircleCheck}>
      Verificada
    </Badge>
  ) : (
    <Badge tone="amber" icon={TriangleAlert}>
      Inconsistente
    </Badge>
  );
}

function Spinner({ className = 'h-4 w-4' }) {
  return <LoaderCircle className={cx('animate-spin', className)} aria-hidden="true" />;
}

function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function TextInput({ className = '', ...props }) {
  return <input {...props} className={cx('input-base', className)} />;
}

function SelectInput({ className = '', children, ...props }) {
  return (
    <div className="relative">
      <select {...props} className={cx('input-base appearance-none pr-9', className)}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
    </div>
  );
}

function SegmentedControl({ options, value, onChange, className = '', ariaLabel }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-1 dark:border-white/10 dark:bg-slate-950/60',
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            )}
          >
            {opt.icon && <opt.icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon = Layers, title, description, action, className = '' }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500 ring-1 ring-inset ring-slate-200 dark:from-slate-800 dark:to-slate-900 dark:text-slate-400 dark:ring-white/10">
        {Icon && <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm dark:bg-slate-950/75"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative z-10 my-6 w-full animate-fade-up rounded-2xl border border-slate-200 bg-white shadow-lift dark:border-white/10 dark:bg-slate-900',
          sizes[size]
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto scrollbar-slim px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-4 dark:border-white/10">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value = 0, tone = 'emerald', className = '' }) {
  const bar = {
    emerald: 'from-emerald-500 to-teal-400',
    blue: 'from-blue-700 to-sky-400',
    amber: 'from-amber-500 to-orange-400',
    rose: 'from-rose-500 to-pink-400'
  }[tone];
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10', className)}>
      <div
        className={cx('h-full rounded-full bg-gradient-to-r transition-[width] duration-500', bar)}
        style={{ width: `${clamp(value, 0, 100)}%` }}
      />
    </div>
  );
}

function InlineNotice({ tone = 'info', title, children, icon, className = '' }) {
  const tones = {
    info: 'border-blue-500/25 bg-blue-500/10 text-blue-800 dark:text-blue-300',
    success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
    warning: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    danger: 'border-rose-500/25 bg-rose-500/10 text-rose-800 dark:text-rose-300'
  };
  const fallback = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert }[tone];
  const NoticeIcon = icon || fallback;
  return (
    <div className={cx('flex gap-3 rounded-xl border p-3.5', tones[tone], className)}>
      <span className="mt-0.5 shrink-0">
        <NoticeIcon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 text-xs leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cx(title && 'mt-0.5 opacity-90')}>{children}</div>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,26rem)] flex-col gap-2">
      {toasts.map((t) => {
        const tone = TONES[t.type === 'error' ? 'rose' : t.type === 'success' ? 'emerald' : 'blue'];
        const Icon = t.type === 'error' ? CircleAlert : t.type === 'success' ? CircleCheck : Info;
        return (
          <div
            key={t.id}
            className="pointer-events-auto animate-fade-up rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lift backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
            role="status"
          >
            <div className="flex items-start gap-2.5">
              <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', tone.chip)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <p className="flex-1 text-xs leading-relaxed text-slate-700 dark:text-slate-200">{t.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Descartar aviso"
                className="rounded p-1 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * 9. GRÁFICOS
 * ========================================================================== */

/** Tooltip común: superficie de vidrio, cifras tabulares y alineación a la derecha. */
function ChartTooltip({ active, payload, label, formatter = formatEUR }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[10rem] rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lift backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {typeof label === 'string' ? label : MESES_LARGOS[label] ?? label}
      </p>
      <div className="mt-2 space-y-1.5">
        {payload.map((entry, i) => (
          <div key={entry.dataKey || i} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[4px]" style={{ backgroundColor: entry.color || entry.fill }} />
              {entry.name}
            </span>
            <span className="tabular font-semibold text-slate-900 dark:text-white">{formatter(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartLegend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span className="h-2.5 w-2.5 rounded-[4px]" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Barras comparativas mensuales: Ingresos vs Gastos (+ línea de neto por punto de referencia). */
function MonthlyBars({ data }) {
  return (
    <div>
      <ChartLegend
        items={[
          { label: 'Ingresos', color: SERIES.ingresos },
          { label: 'Gastos', color: SERIES.gastos }
        ]}
      />
      <div className="mt-3 h-[276px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -6, bottom: 0 }} barGap={3}>
            <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
            <XAxis
              dataKey="mes"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="text-slate-500 dark:text-slate-400"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={62}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="text-slate-500 dark:text-slate-400"
              tickFormatter={formatAxis}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.10)' }}
              content={<ChartTooltip />}
            />
            <Bar dataKey="ingresos" name="Ingresos" fill={SERIES.ingresos} radius={[6, 6, 2, 2]} maxBarSize={26} />
            <Bar dataKey="gastos" name="Gastos" fill={SERIES.gastos} radius={[6, 6, 2, 2]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Donut de distribución de gastos por categoría (base imponible). */
function ExpensesDonut({ data, totalGastos }) {
  const palette = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b', '#a855f7', '#64748b'];
  const withColor = data.map((d, i) => ({ ...d, fill: CATEGORIA_COLORS[d.name] || palette[i % palette.length] }));

  if (!withColor.length) {
    return <EmptyState icon={ChartPie} title="Sin gastos registrados" description="Los gastos del ejercicio aparecerán agrupados por categoría." />;
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative h-[190px] w-full shrink-0 sm:w-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={withColor}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="transparent"
              startAngle={90}
              endAngle={-270}
            >
              {withColor.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Gastos</span>
          <span className="tabular text-sm font-semibold text-slate-800 dark:text-slate-100">{formatEUR0(totalGastos)}</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2.5">
        {withColor.map((entry) => {
          const pct = totalGastos > 0 ? (entry.value / totalGastos) * 100 : 0;
          return (
            <li key={entry.name}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ backgroundColor: entry.fill }} />
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="tabular shrink-0 font-semibold text-slate-900 dark:text-white">{formatEUR(entry.value)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: entry.fill }} />
                </div>
                <span className="tabular w-11 shrink-0 text-right text-[10px] text-slate-400">{formatPct(pct, 0)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Presión fiscal acumulada por trimestre.
 * presión = (IVA a liquidar + IRPF estimado) ÷ ingresos del trimestre
 */
function QuarterlyPressure({ quarters }) {
  const maxPresion = Math.max(50, ...quarters.map((q) => q.presion));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {quarters.map((q) => {
          const pct = clamp(q.presion, 0, 100);
          const tone = pct >= 45 ? 'rose' : pct >= 30 ? 'amber' : 'emerald';
          const hasData = q.ingresos > 0 || q.gastos > 0;
          return (
            <div
              key={q.id}
              className="rounded-xl border border-slate-200/80 bg-white/70 p-3.5 dark:border-white/10 dark:bg-slate-950/40"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold text-white dark:bg-white dark:text-slate-900">
                    {q.id}
                  </span>
                  Trimestre
                </span>
                <span className={cx('tabular text-sm font-semibold', tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                  {hasData ? formatPct(q.presion, 1) : '—'}
                </span>
              </div>

              <ProgressBar value={(q.presion / maxPresion) * 100} tone={tone} className="mt-2.5" />

              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <dt className="text-slate-400">IVA liquidar</dt>
                  <dd className={cx('tabular font-semibold', q.ivaLiquidado > 0 ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400')}>
                    {hasData ? formatEUR(q.ivaLiquidado) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">IRPF est.</dt>
                  <dd className="tabular font-semibold text-slate-800 dark:text-slate-100">
                    {hasData ? formatEUR(q.irpfEstimado) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Ingresos</dt>
                  <dd className="tabular font-semibold text-slate-800 dark:text-slate-100">
                    {hasData ? formatEUR0(q.ingresos) : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Presión fiscal = (IVA a liquidar en el 303 + retención de IRPF estimada al 130) ÷ ingresos del trimestre. Cálculo
        orientativo para previsión de tesorería, no sustituye la liquidación oficial.
      </p>
    </div>
  );
}

/* ============================================================================
 * 10.1 PÁGINA — DASHBOARD FINANCIERO
 * ========================================================================== */

function PeriodSelector({ year, years, onChange }) {
  const options = [
    ...years.map((y) => ({ value: String(y), label: String(y) })),
    { value: 'all', label: 'Histórico (todos)' }
  ];
  return (
    <SelectInput
      aria-label="Ejercicio fiscal"
      value={String(year)}
      onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      className="w-44"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectInput>
  );
}

function DashboardPage({ invoices, fiscal, year, years, onYearChange, settings, aiReady, onNavigate, onLoadDemo }) {
  const scopedCount = invoices.length;
  const netoPositivo = fiscal.resultadoNeto >= 0;

  const latest = useMemo(
    () =>
      [...invoices]
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
        .slice(0, 6),
    [invoices]
  );

  if (scopedCount === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard Financiero"
          subtitle="Visión consolidada de ingresos, gastos y obligaciones fiscales"
          right={<PeriodSelector year={year} years={years} onChange={onYearChange} />}
        />
        <div className="glass-card">
          <EmptyState
            icon={LayoutGrid}
            title="Aún no hay facturas en el libro registro"
            description="Carga 12 facturas de demostración para ver los gráficos, los KPIs y las exportaciones en segundos — o escanea tu primera factura con IA."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" className="btn-primary" onClick={onLoadDemo}>
                  <Sparkles className="h-4 w-4" />
                  Cargar datos de demostración
                </button>
                <button type="button" className="btn-secondary" onClick={() => onNavigate('processor')}>
                  <ScanLine className="h-4 w-4" />
                  Escanear factura
                </button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Financiero"
        subtitle={`${fiscal.totalFacturas} facturas · ${year === 'all' ? 'histórico completo' : `ejercicio ${year}`}`}
        right={<PeriodSelector year={year} years={years} onChange={onYearChange} />}
      />

      {fiscal.incidencias > 0 && (
        <InlineNotice tone="warning" title={`${fiscal.incidencias} factura(s) con cuadre matemático inconsistente`}>
          Revisa la columna de estado en el{' '}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onNavigate('ledger')}>
            Libro Registro
          </button>{' '}
          antes de exportar para la gestoría.
        </InlineNotice>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <KpiCard
          label="Ingresos totales"
          value={formatEUR(fiscal.ingresosTotales)}
          icon={Wallet}
          tone="emerald"
          hint={`Base imponible ${formatEUR(fiscal.baseIngresos)}`}
        />
        <KpiCard
          label="Gastos totales"
          value={formatEUR(fiscal.gastosTotales)}
          icon={Banknote}
          tone="rose"
          hint={`Base imponible ${formatEUR(fiscal.baseGastos)}`}
        />
        <KpiCard
          label="Resultado neto"
          value={formatEUR(fiscal.resultadoNeto)}
          icon={netoPositivo ? TrendingUp : TrendingDown}
          tone={netoPositivo ? 'blue' : 'rose'}
          hint={`Margen sobre ingresos: ${formatPct(fiscal.margenNeto)}`}
          badge={
            netoPositivo ? (
              <Badge tone="emerald" icon={ArrowUpRight}>
                +{formatPct(fiscal.margenNeto, 0)}
              </Badge>
            ) : (
              <Badge tone="rose" icon={ArrowDownRight}>
                {formatPct(fiscal.margenNeto, 0)}
              </Badge>
            )
          }
        />
        <KpiCard
          label="Liquidación IVA · Modelo 303"
          value={formatEUR(fiscal.liquidacion303)}
          icon={ReceiptText}
          tone="blue"
          hint={`Repercutido ${formatEUR0(fiscal.ivaRepercutido)} − soportado ${formatEUR0(fiscal.ivaSoportado)}`}
        />
        <KpiCard
          label="Estimación IRPF · Modelo 130"
          value={formatEUR(fiscal.estimacion130)}
          icon={Calculator}
          tone="amber"
          hint={`${settings.tipoIrpf130} % sobre rendimiento neto (${formatEUR0(fiscal.rendimientoNeto)})`}
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Ingresos vs Gastos"
          subtitle="Comparativa mensual del ejercicio seleccionado"
          actions={<Badge tone="slate" icon={ChartColumn}>Mensual</Badge>}
        >
          <MonthlyBars data={fiscal.monthly} />
        </Card>

        <Card
          title="Distribución de gastos"
          subtitle="Por categoría · base imponible"
          actions={<Badge tone="slate" icon={ChartPie}>Donut</Badge>}
        >
          <ExpensesDonut data={fiscal.gastosPorCategoria} totalGastos={fiscal.baseGastos} />
        </Card>
      </div>

      <Card
        title="Presión fiscal por trimestre"
        subtitle="Previsión de IVA a liquidar y retención de IRPF estimada"
        actions={
          <Badge tone={fiscal.presionFiscal >= 40 ? 'amber' : 'emerald'} icon={Scale}>
            Acumulado {formatPct(fiscal.presionFiscal)}
          </Badge>
        }
      >
        <QuarterlyPressure quarters={fiscal.quarters} />
      </Card>

      {/* Últimos movimientos */}
      <Card
        title="Últimos movimientos"
        subtitle="Facturas registradas más recientes"
        actions={
          <button type="button" className="btn-ghost" onClick={() => onNavigate('ledger')}>
            Ver libro completo
            <ArrowRight className="h-4 w-4" />
          </button>
        }
        bodyClassName="px-0 py-0"
      >
        <ul className="divide-y divide-slate-200/70 dark:divide-white/10">
          {latest.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
              <span
                className={cx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
                  inv.tipo === 'INGRESO'
                    ? 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400'
                    : 'bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-400'
                )}
              >
                {inv.tipo === 'INGRESO' ? (
                  <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {inv.tipo === 'INGRESO' ? inv.emisor_nombre || 'Cliente sin nombre' : inv.emisor_nombre || 'Proveedor sin nombre'}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {inv.numero_factura || 'S/N'} · {new Date(`${inv.fecha}T00:00:00`).toLocaleDateString('es-ES')} · {inv.categoria}
                </p>
              </div>

              <div className="hidden shrink-0 sm:block">
                <StatusBadge estado={inv.estado} />
              </div>

              <p
                className={cx(
                  'tabular w-28 shrink-0 text-right text-sm font-semibold',
                  inv.tipo === 'INGRESO'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-700 dark:text-slate-200'
                )}
              >
                {inv.tipo === 'INGRESO' ? '+' : '−'}
                {formatEUR(inv.total)}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      {!aiReady && (
        <InlineNotice tone="info" title="Modo Local-First · motor de IA sin configurar">
          Estás trabajando solo con almacenamiento local y sin lectura automática con IA. {envNotice()}
        </InlineNotice>
      )}
    </div>
  );
}

function PageHeader({ title, subtitle, right }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

/* ============================================================================
 * 10.2 PÁGINA — PROCESADOR DE FACTURAS (DeepSeek)
 * ========================================================================== */

const EMPTY_INVOICE = {
  tipo: 'GASTO',
  numero_factura: '',
  fecha: '',
  emisor_nombre: '',
  emisor_nif: '',
  receptor_nombre: '',
  receptor_nif: '',
  base_imponible: '',
  porcentaje_iva: '21',
  cuota_iva: '',
  porcentaje_irpf: '0',
  cuota_irpf: '',
  total: '',
  categoria: 'Otro'
};

/** Modal editador de facturas — reutilizado por Procesador, Libro y alta manual. */
function InvoiceEditorModal({ open, invoice, title, onClose, onSave, settings }) {
  const [form, setForm] = useState(EMPTY_INVOICE);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    const src = invoice || EMPTY_INVOICE;
    const next = { ...EMPTY_INVOICE };
    Object.keys(next).forEach((key) => {
      const v = src[key];
      next[key] = v === undefined || v === null ? EMPTY_INVOICE[key] : String(v);
    });
    if (!src.fecha) next.fecha = todayISO();
    if (!next.receptor_nombre && settings?.empresaNombre) next.receptor_nombre = settings.empresaNombre;
    if (!next.receptor_nif && settings?.empresaNif) next.receptor_nif = settings.empresaNif;
    setForm(next);
    setDirty(false);
  }, [open, invoice, settings]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setDirty(true);
  };

  const base = parseAmount(form.base_imponible);
  const cuotaIva = parseAmount(form.cuota_iva);
  const cuotaIrpf = parseAmount(form.cuota_irpf);
  const total = parseAmount(form.total);
  const esperado = round2(base + cuotaIva - cuotaIrpf);
  const cuadra = Math.abs(esperado - total) <= 0.01;

  const autoCalcular = () => {
    const iva = parseAmount(form.porcentaje_iva);
    const irpf = parseAmount(form.porcentaje_irpf);
    const nuevaCuotaIva = round2((base * iva) / 100);
    const nuevaCuotaIrpf = round2((base * irpf) / 100);
    setForm((f) => ({
      ...f,
      cuota_iva: String(nuevaCuotaIva),
      cuota_irpf: String(nuevaCuotaIrpf),
      total: String(round2(base + nuevaCuotaIva - nuevaCuotaIrpf))
    }));
    setDirty(true);
  };

  const guardar = () => {
    const normalizada = normalizeInvoice({
      ...(invoice?.id ? { id: invoice.id } : {}),
      ...(invoice?.origen ? { origen: invoice.origen } : {}),
      ...(invoice?.created_at ? { created_at: invoice.created_at } : {}),
      ...form,
      base_imponible: base,
      porcentaje_iva: parseAmount(form.porcentaje_iva),
      cuota_iva: cuotaIva,
      porcentaje_irpf: parseAmount(form.porcentaje_irpf),
      cuota_irpf: cuotaIrpf,
      total
    });
    onSave(normalizada);
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || 'Editar factura'}
      description="Todos los campos son editables: la validación matemática se recalcula en vivo."
      size="lg"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <Badge tone={cuadra ? 'emerald' : 'amber'} icon={cuadra ? CircleCheck : TriangleAlert}>
              {cuadra ? 'Verificada' : 'Inconsistente (Revisar)'}
            </Badge>
            <span className="tabular text-xs text-slate-500 dark:text-slate-400">
              {formatNum(base)} + {formatNum(cuotaIva)} − {formatNum(cuotaIrpf)} = {formatNum(esperado)}
            </span>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={guardar} disabled={!form.fecha}>
            <Check className="h-4 w-4" />
            {dirty ? 'Guardar cambios' : 'Guardar en el libro'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tipo de operación">
            <SegmentedControl
              ariaLabel="Tipo de operación"
              value={form.tipo}
              onChange={(v) => {
                setForm((f) => ({ ...f, tipo: v }));
                setDirty(true);
              }}
              options={[
                { value: 'GASTO', label: 'Gasto', icon: ArrowUpRight },
                { value: 'INGRESO', label: 'Ingreso', icon: ArrowDownRight }
              ]}
            />
          </Field>

          <Field label="Número de factura" htmlFor="f-numero">
            <TextInput id="f-numero" value={form.numero_factura} onChange={set('numero_factura')} placeholder="E-2026-001" />
          </Field>

          <Field label="Fecha" htmlFor="f-fecha">
            <TextInput id="f-fecha" type="date" value={form.fecha} onChange={set('fecha')} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Emisor (proveedor / cliente emisor)" htmlFor="f-emisor">
            <TextInput id="f-emisor" value={form.emisor_nombre} onChange={set('emisor_nombre')} placeholder="Razón social" />
          </Field>
          <Field label="NIF emisor" htmlFor="f-emisornif">
            <TextInput id="f-emisornif" value={form.emisor_nif} onChange={set('emisor_nif')} placeholder="B-00000000" />
          </Field>
          <Field label="Receptor" htmlFor="f-receptor">
            <TextInput id="f-receptor" value={form.receptor_nombre} onChange={set('receptor_nombre')} placeholder="Razón social" />
          </Field>
          <Field label="NIF receptor" htmlFor="f-receptornif">
            <TextInput id="f-receptornif" value={form.receptor_nif} onChange={set('receptor_nif')} placeholder="B-00000000" />
          </Field>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-slate-950/40">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="section-title">Desglose económico</p>
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={autoCalcular}>
              <Zap className="h-3.5 w-3.5" />
              Recalcular desde base
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Base imponible" htmlFor="f-base">
              <TextInput id="f-base" type="number" step="0.01" min="0" value={form.base_imponible} onChange={set('base_imponible')} />
            </Field>
            <Field label="% IVA" htmlFor="f-piva">
              <TextInput id="f-piva" type="number" step="0.01" min="0" max="100" value={form.porcentaje_iva} onChange={set('porcentaje_iva')} />
            </Field>
            <Field label="Cuota IVA" htmlFor="f-civa">
              <TextInput id="f-civa" type="number" step="0.01" value={form.cuota_iva} onChange={set('cuota_iva')} />
            </Field>
            <Field label="% IRPF" htmlFor="f-pirpf">
              <TextInput id="f-pirpf" type="number" step="0.01" min="0" max="100" value={form.porcentaje_irpf} onChange={set('porcentaje_irpf')} />
            </Field>
            <Field label="Cuota IRPF" htmlFor="f-cirpf">
              <TextInput id="f-cirpf" type="number" step="0.01" value={form.cuota_irpf} onChange={set('cuota_irpf')} />
            </Field>
            <Field label="TOTAL" htmlFor="f-total">
              <TextInput
                id="f-total"
                type="number"
                step="0.01"
                value={form.total}
                onChange={set('total')}
                className={cuadra ? '' : '!border-amber-400 !ring-amber-500/30'}
              />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Categoría" htmlFor="f-cat">
            <SelectInput id="f-cat" value={form.categoria} onChange={set('categoria')}>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Estado de validación" hint="base + cuota IVA − cuota IRPF = total">
            <div className="pt-1">
              <Badge tone={cuadra ? 'emerald' : 'amber'} icon={cuadra ? CircleCheck : TriangleAlert}>
                {cuadra ? 'Verificada' : 'Inconsistente (Revisar)'}
              </Badge>
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function StagePanel({ stage, onRetry }) {
  if (!stage || stage.status === 'idle') return null;

  const labels = {
    read: 'Leyendo archivo…',
    pdf: 'Extrayendo texto del PDF…',
    ocr: 'Reconociendo texto (OCR)…',
    ai: 'Analizando factura con IA…',
    save: 'Guardando…'
  };

  const failed = stage.status === 'error';

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3.5 dark:border-white/10 dark:bg-slate-950/40">
      <div className="flex items-center gap-3">
        {stage.status === 'working' ? (
          <Spinner className="h-4 w-4 text-emerald-500" />
        ) : failed ? (
          <CircleAlert className="h-4 w-4 text-rose-500" />
        ) : (
          <CircleCheck className="h-4 w-4 text-emerald-500" />
        )}
        <p className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-200">
          {failed ? stage.message : labels[stage.step] || 'Procesando…'}
        </p>
        {stage.status === 'working' && stage.progress != null && (
          <span className="tabular text-[11px] text-slate-400">{Math.round(stage.progress * 100)} %</span>
        )}
      </div>
      {stage.status === 'working' && stage.progress != null && (
        <ProgressBar value={stage.progress * 100} tone={stage.step === 'ai' ? 'blue' : 'emerald'} className="mt-2.5" />
      )}
      {failed && <p className="mt-2 text-[11px] leading-relaxed text-rose-500">{stage.detail}</p>}
      {failed && onRetry && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-1.5 text-[11px]" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

function ProcessorPage({ settings, onSaveMany, pushToast, onNavigate }) {
  const [dragOver, setDragOver] = useState(false);
  const [stage, setStage] = useState({ status: 'idle' });
  const [pending, setPending] = useState([]);
  const [manualText, setManualText] = useState('');
  const [editing, setEditing] = useState(null); // { index }
  const [retryFile, setRetryFile] = useState(null); // último archivo fallido (para Reintentar)
  const fileInputRef = useRef(null);

  /* La clave vive en .env (VITE_DEEPSEEK_API_KEY); el cliente nunca la introduce ni la ve. */
  const aiReady = Boolean(ENV.deepseekApiKey);

  const processFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      for (const file of files) {
        /* Validación previa de tipo y tamaño (también en drag & drop). */
        const invalid = validateFile(file);
        if (invalid) {
          setStage({ status: 'error', step: 'read', message: 'Archivo rechazado', detail: invalid });
          pushToast('error', invalid);
          continue;
        }

        try {
          setStage({ status: 'working', step: file.type === 'application/pdf' ? 'pdf' : 'read', progress: 0 });

          const rawText = await extractFileText(file, ({ step, progress }) =>
            setStage({ status: 'working', step, progress })
          );

          if (!aiReady) {
            setStage({
              status: 'error',
              step: 'ai',
              message: 'IA no configurada en este entorno',
              detail: `${envNotice()} El texto extraído se conserva en la bandeja para revisión manual.`
            });
            setPending((p) => [
              { id: uid(), fileName: file.name, invoice: null, rawText, error: 'IA sin configurar (aviso de desarrollo).' },
              ...p
            ]);
            continue;
          }

          setStage({ status: 'working', step: 'ai', progress: null });
          const invoice = await extractInvoiceWithDeepSeek({
            apiKey: ENV.deepseekApiKey,
            model: DEEPSEEK_MODEL,
            rawText,
            fileName: file.name
          });

          setStage({ status: 'success', step: 'ai' });
          setRetryFile(null);
          setPending((p) => [{ id: uid(), fileName: file.name, invoice, rawText, error: null }, ...p]);
        } catch (error) {
          setRetryFile(file);
          setStage({
            status: 'error',
            step: 'ai',
            message: 'No se pudo procesar el documento',
            detail: error?.message || 'Error desconocido.'
          });
          pushToast('error', `${file.name}: ${error?.message || 'error desconocido'}`);
        }
      }
    },
    [aiReady, pushToast]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const analyzePastedText = async () => {
    if (!manualText.trim()) return;
    if (!aiReady) {
      pushToast('error', envNotice());
      return;
    }
    try {
      setStage({ status: 'working', step: 'ai', progress: null });
      const invoice = await extractInvoiceWithDeepSeek({
        apiKey: ENV.deepseekApiKey,
        model: DEEPSEEK_MODEL,
        rawText: manualText,
        fileName: 'texto-pegado'
      });
      setStage({ status: 'success', step: 'ai' });
      setPending((p) => [{ id: uid(), fileName: 'Texto pegado', invoice, rawText: manualText, error: null }, ...p]);
      setManualText('');
    } catch (error) {
      setStage({ status: 'error', step: 'ai', message: 'Fallo en el motor de IA', detail: error?.message });
      pushToast('error', error?.message || 'Error al analizar el texto');
    }
  };

  const guardarItem = (index) => {
    const item = pending[index];
    if (!item?.invoice) return;
    onSaveMany([item.invoice]);
    setPending((p) => p.filter((_, i) => i !== index));
    pushToast('success', `Factura ${item.invoice.numero_factura || 'sin número'} guardada en el libro.`);
  };

  const guardarTodo = () => {
    const validas = pending.filter((p) => p.invoice);
    if (!validas.length) return;
    onSaveMany(validas.map((p) => p.invoice));
    setPending((p) => p.filter((item) => !item.invoice));
    pushToast('success', `${validas.length} factura(s) guardadas en el libro registro.`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procesador de Facturas"
        subtitle="Digitaliza PDF o imagen, extrae los datos con IA y validados matemáticamente antes de guardarlos"
        right={
          <>
            <Badge tone={aiReady ? 'emerald' : 'slate'} icon={aiReady ? CircleCheck : KeyRound}>
              {aiReady ? 'Motor de IA · listo' : 'IA no configurada'}
            </Badge>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEditing({ index: null, invoice: null })}
            >
              <Plus className="h-4 w-4" />
              Alta manual
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Zona de carga */}
        <div className="space-y-4 xl:col-span-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cx(
              'glass-card relative flex flex-col items-center justify-center px-6 py-10 text-center transition',
              dragOver && 'scale-[1.01] border-emerald-400/70 ring-2 ring-emerald-500/30'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.txt,.csv"
              className="sr-only"
              onChange={(e) => {
                processFiles(e.target.files);
                e.target.value = '';
              }}
            />

            <div
              className={cx(
                'flex h-14 w-14 items-center justify-center rounded-2xl transition',
                dragOver
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gradient-to-br from-emerald-500/15 to-blue-600/15 text-emerald-600 dark:text-emerald-400'
              )}
            >
              <CloudUpload className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
            </div>

            <h2 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">
              Arrastra aquí tus facturas
            </h2>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Formatos admitidos: <strong>PDF</strong> (capa de texto), <strong>PNG / JPG</strong> (OCR local) y ficheros
              de texto. Varios archivos a la vez, <strong>máx. 10 MB por archivo</strong>.
            </p>

            <button type="button" className="btn-primary mt-4" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Seleccionar archivos
            </button>

            <StagePanel stage={stage} onRetry={retryFile ? () => processFiles([retryFile]) : null} />
          </div>

          {/* Texto alternativo */}
          <Card
            title="¿Sin fichero a mano?"
            subtitle="Pega el texto o los datos de la factura y la IA los estructurará igualmente"
          >
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              rows={5}
              placeholder={
                'FACTURA Nº 2026-014\nFecha: 15/03/2026\nEmisor: CloudHosting Ibérica S.L. · B-55667788\nBase imponible: 149,99 €\nIVA 21 %: 31,50 €\nTotal: 181,49 €'
              }
              className="input-base scrollbar-slim min-h-[7rem] resize-y font-mono text-xs leading-relaxed"
              aria-label="Texto de la factura"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">{manualText.trim().length} caracteres</span>
              <button
                type="button"
                className="btn-primary"
                onClick={analyzePastedText}
                disabled={!manualText.trim() || stage.status === 'working'}
              >
                {stage.status === 'working' ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                Analizar con IA
              </button>
            </div>
          </Card>

          {/* Bandeja de revisión */}
          <Card
            title={`Bandeja de revisión (${pending.length})`}
            subtitle="Revisa, corrige si hace falta y guarda en el libro registro"
            actions={
              pending.some((p) => p.invoice) ? (
                <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={guardarTodo}>
                  <Check className="h-3.5 w-3.5" />
                  Guardar todas
                </button>
              ) : null
            }
            bodyClassName="px-0 py-0"
          >
            {pending.length === 0 ? (
              <EmptyState
                icon={ScanLine}
                title="No hay facturas pendientes"
                description="Los documentos que escanees aparecerán aquí para su revisión antes de entrar al libro registro."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-slate-200/70 dark:divide-white/10">
                {pending.map((item, index) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300">
                      {item.fileName.toLowerCase().endsWith('.pdf') ? (
                        <FileText className="h-4 w-4" />
                      ) : /\.(png|jpe?g|webp)$/.test(item.fileName.toLowerCase()) ? (
                        <Image className="h-4 w-4" />
                      ) : (
                        <Braces className="h-4 w-4" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      {item.invoice ? (
                        <>
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {item.invoice.emisor_nombre || 'Sin emisor'} ·{' '}
                            <span className={cx('font-semibold', item.invoice.tipo === 'INGRESO' ? 'text-emerald-500' : 'text-rose-500')}>
                              {item.invoice.tipo}
                            </span>
                          </p>
                          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {item.fileName} · {item.invoice.numero_factura || 'S/N'} · {item.invoice.categoria} ·{' '}
                            {formatEUR(item.invoice.total)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.fileName}</p>
                          <p className="truncate text-[11px] text-amber-600 dark:text-amber-400">
                            {item.error} El texto extraído se conserva para corrección manual.
                          </p>
                        </>
                      )}
                    </div>

                    {item.invoice && <StatusBadge estado={item.invoice.estado} />}

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        className="btn-ghost !px-2 !py-1.5"
                        title="Editar datos"
                        onClick={() => setEditing({ index, invoice: item.invoice })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !px-2 !py-1.5 text-rose-500 hover:!bg-rose-500/10"
                        title="Descartar"
                        onClick={() => setPending((p) => p.filter((_, i) => i !== index))}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                      {item.invoice && (
                        <button type="button" className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => guardarItem(index)}>
                          Guardar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Panel lateral */}
        <aside className="space-y-4">
          <Card title="Cómo funciona" subtitle="Flujo de digitalización en 3 pasos">
            <ol className="space-y-4">
              {[
                { icon: Upload, t: 'Carga el documento', d: 'PDF, PNG o JPG. El texto se extrae en tu navegador (pdfjs / OCR).' },
                { icon: Sparkles, t: 'El motor de IA estructura los datos', d: 'Lectura automática en JSON Mode con el esquema fiscal completo.' },
                { icon: ShieldCheck, t: 'Validación matemática local', d: 'Se comprueba base + IVA − IRPF = total antes de aceptar la factura.' }
              ].map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-400">
                      <s.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {i < 2 && <span className="mt-1 w-px flex-1 bg-slate-200 dark:bg-white/10" />}
                  </div>
                  <div className="pb-1">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {i + 1}. {s.t}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Estado del procesamiento">
            <ul className="space-y-3 text-xs">
              <li className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <KeyRound className="h-3.5 w-3.5" /> Motor de IA
                </span>
                <Badge tone={aiReady ? 'emerald' : 'slate'}>{aiReady ? 'Activa (.env)' : 'Sin configurar'}</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Image className="h-3.5 w-3.5" /> OCR de imágenes
                </span>
                <Badge tone="blue">Tesseract · local</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Database className="h-3.5 w-3.5" /> Almacenamiento
                </span>
                <Badge tone="slate">localStorage</Badge>
              </li>
            </ul>

            {!aiReady && (
              <InlineNotice tone="warning" title="Aviso de desarrollo" className="mt-4">
                {envNotice()}
              </InlineNotice>
            )}
          </Card>
        </aside>
      </div>

      <InvoiceEditorModal
        open={Boolean(editing)}
        title={editing?.invoice?.id ? 'Editar factura extraída' : 'Alta manual de factura'}
        invoice={editing?.invoice}
        settings={settings}
        onClose={() => setEditing(null)}
        onSave={(inv) => {
          if (editing?.index != null) {
            setPending((p) => p.map((item, i) => (i === editing.index ? { ...item, invoice: inv } : item)));
          } else {
            onSaveMany([inv]);
            pushToast('success', 'Factura creada en el libro registro.');
          }
          setEditing(null);
        }}
      />
    </div>
  );
}

/* ============================================================================
 * 10.3 PÁGINA — LIBRO REGISTRO DE FACTURAS
 * ========================================================================== */

/** Celda editable in-line: clic para editar, Enter/blur confirma, Esc cancela. */
function EditableCell({ value, numeric = false, align = 'left', onCommit, ariaLabel, prefix, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(String(value ?? ''));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (numeric) {
      const parsed = parseAmount(draft);
      if (parsed !== parseAmount(value)) onCommit(parsed);
    } else if (draft !== String(value ?? '')) {
      onCommit(draft);
    }
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={ariaLabel}
        type={numeric ? 'text' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        className={cx(
          'w-full rounded-md border border-emerald-400 bg-white px-1.5 py-1 text-xs text-slate-900 outline-none ring-2 ring-emerald-500/30 dark:bg-slate-950 dark:text-slate-100',
          align === 'right' && 'text-right'
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Clic para editar"
      aria-label={`${ariaLabel}: ${value}. Clic para editar.`}
      className={cx(
        'group/edit w-full rounded-md px-1.5 py-1 text-left transition hover:bg-emerald-500/10 focus-visible:ring-2',
        align === 'right' && 'text-right',
        className
      )}
    >
      {prefix}
      <span className="tabular">{String(value ?? '')}</span>
      <Pencil className="ml-1.5 inline h-3 w-3 text-slate-300 opacity-0 transition group-hover/edit:opacity-100 dark:text-slate-600" aria-hidden="true" />
    </button>
  );
}

function LedgerPage({ invoices, year, years, onYearChange, onUpdate, onDelete, onCreate, pushToast }) {
  const [query, setQuery] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [trimestre, setTrimestre] = useState('todos');
  const [categoria, setCategoria] = useState('todas');
  const [sort, setSort] = useState({ key: 'fecha', dir: 'desc' });
  const [pendingDelete, setPendingDelete] = useState(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = invoices.filter((inv) => {
      if (year !== 'all' && getYear(inv.fecha) !== year) return false;
      if (tipo !== 'todos' && inv.tipo !== tipo) return false;
      if (trimestre !== 'todos' && getQuarter(inv.fecha) !== Number(trimestre)) return false;
      if (categoria !== 'todas' && inv.categoria !== categoria) return false;
      if (!q) return true;
      return [inv.numero_factura, inv.emisor_nombre, inv.emisor_nif, inv.receptor_nombre, inv.receptor_nif, inv.categoria, inv.estado]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'fecha') return a.fecha < b.fecha ? -dir : a.fecha > b.fecha ? dir : 0;
      if (sort.key === 'total') return (Number(a.total) - Number(b.total)) * dir;
      if (sort.key === 'numero_factura') return String(a.numero_factura).localeCompare(String(b.numero_factura), 'es') * dir;
      return 0;
    });
  }, [invoices, query, tipo, trimestre, categoria, year, sort]);

  const totales = useMemo(
    () =>
      rows.reduce(
        (acc, inv) => {
          acc.base += Number(inv.base_imponible) || 0;
          acc.iva += Number(inv.cuota_iva) || 0;
          acc.irpf += Number(inv.cuota_irpf) || 0;
          acc.total += Number(inv.total) || 0;
          return acc;
        },
        { base: 0, iva: 0, irpf: 0, total: 0 }
      ),
    [rows]
  );

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  /** Aplica un parche a una factura y recalcula su estado de validación. */
  const patchInvoice = (inv, patch) => {
    const next = { ...inv, ...patch };
    next.estado = validateInvoice(next);
    onUpdate(inv.id, next);
  };

  const SortHeader = ({ k, children, className = '' }) => (
    <th scope="col" className={cx('px-2 py-2.5 font-semibold', className)}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cx(
          'inline-flex items-center gap-1 rounded transition hover:text-slate-900 dark:hover:text-white',
          sort.key === k ? 'text-slate-900 dark:text-white' : ''
        )}
      >
        {children}
        <ArrowUpDown className={cx('h-3 w-3', sort.key === k ? 'opacity-90' : 'opacity-30')} aria-hidden="true" />
      </button>
    </th>
  );

  const filtrosActivos = query || tipo !== 'todos' || trimestre !== 'todos' || categoria !== 'todas';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Libro Registro de Facturas"
        subtitle={`${rows.length} de ${invoices.length} facturas visibles · edición in-line habilitada`}
        right={
          <>
            <PeriodSelector year={year} years={years} onChange={onYearChange} />
            <button type="button" className="btn-primary" onClick={() => onCreate()}>
              <Plus className="h-4 w-4" />
              Nueva factura
            </button>
          </>
        }
      />

      <Card
        title="Herramientas de consulta"
        subtitle="Búsqueda libre, filtros por trimestre y categoría, ordenación por fecha o importe"
        actions={
          filtrosActivos ? (
            <button
              type="button"
              className="btn-ghost !py-1.5 !text-xs"
              onClick={() => {
                setQuery('');
                setTipo('todos');
                setTrimestre('todos');
                setCategoria('todas');
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <TextInput
              aria-label="Buscar facturas"
              placeholder="Buscar por nº, NIF, cliente…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="!pl-9"
            />
          </div>

          <SelectInput aria-label="Filtrar por trimestre" value={trimestre} onChange={(e) => setTrimestre(e.target.value)}>
            <option value="todos">Todos los trimestres</option>
            {TRIMESTRES.map((t) => (
              <option key={t.id} value={Number(t.id[1])}>
                {t.id}
              </option>
            ))}
          </SelectInput>

          <SelectInput aria-label="Filtrar por categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="todas">Todas las categorías</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectInput>

          <SegmentedControl
            ariaLabel="Filtrar por tipo"
            value={tipo}
            onChange={setTipo}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'INGRESO', label: 'Ingresos' },
              { value: 'GASTO', label: 'Gastos' }
            ]}
          />
        </div>
      </Card>

      <Card
        title="Facturas registradas"
        subtitle="Clic en cualquier celda para editarla directamente · Enter confirma · Esc cancela"
        actions={
          <Badge tone="slate" icon={Table2}>
            {rows.length} filas
          </Badge>
        }
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Ninguna factura coincide con los filtros"
            description="Ajusta la búsqueda o los filtros, o crea una factura manualmente."
            action={
              <button type="button" className="btn-primary" onClick={() => onCreate()}>
                <Plus className="h-4 w-4" />
                Nueva factura
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-slim">
            <table className="w-full min-w-[68rem] border-collapse text-xs">
              <caption className="sr-only">Libro registro de facturas emitidas y recibidas</caption>
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                <tr className="border-b border-slate-200/80 dark:border-white/10">
                  <SortHeader k="fecha" className="w-24 text-left">
                    Fecha
                  </SortHeader>
                  <SortHeader k="numero_factura" className="w-32 text-left">
                    Nº Factura
                  </SortHeader>
                  <th scope="col" className="px-2 py-2.5 text-left font-semibold">
                    Tipo
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-left font-semibold">
                    Emisor / Receptor
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-left font-semibold">
                    Categoría
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">
                    Base
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">
                    IVA
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">
                    IRPF
                  </th>
                  <SortHeader k="total" className="w-28 text-right">
                    Total
                  </SortHeader>
                  <th scope="col" className="px-2 py-2.5 text-left font-semibold">
                    Estado
                  </th>
                  <th scope="col" className="w-10 px-2 py-2.5 text-right font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200/70 text-slate-700 dark:divide-white/10 dark:text-slate-300">
                {rows.map((inv) => (
                  <tr key={inv.id} className="transition hover:bg-slate-50/70 dark:hover:bg-white/[0.03]">
                    <td className="px-1 py-1">
                      <EditableCell
                        ariaLabel="Fecha"
                        value={inv.fecha}
                        onCommit={(v) => patchInvoice(inv, { fecha: normalizeDate(v) })}
                        align="left"
                        className="text-xs"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <EditableCell
                        ariaLabel="Número de factura"
                        value={inv.numero_factura}
                        onCommit={(v) => patchInvoice(inv, { numero_factura: v })}
                        className="text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Badge tone={inv.tipo === 'INGRESO' ? 'emerald' : 'rose'}>{inv.tipo}</Badge>
                    </td>
                    <td className="px-1 py-1">
                      <EditableCell
                        ariaLabel="Nombre del emisor"
                        value={inv.emisor_nombre}
                        onCommit={(v) => patchInvoice(inv, { emisor_nombre: v })}
                        className="min-w-[10rem] text-xs font-medium"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        aria-label="Categoría"
                        value={inv.categoria}
                        onChange={(e) => patchInvoice(inv, { categoria: e.target.value })}
                        className="w-full cursor-pointer rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs transition hover:border-slate-300 hover:bg-white focus:border-emerald-400 dark:hover:border-white/20 dark:hover:bg-slate-950"
                      >
                        {CATEGORIAS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        ariaLabel="Base imponible"
                        numeric
                        align="right"
                        value={formatNum(inv.base_imponible)}
                        onCommit={(v) => onUpdate(inv.id, recalcInvoice(inv, { base: v }))}
                        className="text-xs"
                      />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        ariaLabel="Cuota de IVA"
                        numeric
                        align="right"
                        value={formatNum(inv.cuota_iva)}
                        onCommit={(v) => patchInvoice(inv, { cuota_iva: v, total: round2(inv.base_imponible + v - inv.cuota_irpf) })}
                        className="text-xs"
                      />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        ariaLabel="Cuota de IRPF"
                        numeric
                        align="right"
                        value={formatNum(inv.cuota_irpf)}
                        onCommit={(v) => patchInvoice(inv, { cuota_irpf: v, total: round2(inv.base_imponible + inv.cuota_iva - v) })}
                        className="text-xs"
                      />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <EditableCell
                        ariaLabel="Total"
                        numeric
                        align="right"
                        value={formatNum(inv.total)}
                        onCommit={(v) => patchInvoice(inv, { total: v })}
                        className="text-xs font-semibold"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <StatusBadge estado={inv.estado} />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        aria-label={`Eliminar factura ${inv.numero_factura || inv.id}`}
                        onClick={() => setPendingDelete(inv)}
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-500"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="bg-slate-50/80 font-semibold text-slate-800 dark:bg-white/[0.03] dark:text-slate-100">
                <tr className="border-t border-slate-200/80 dark:border-white/10">
                  <td colSpan={5} className="px-3 py-2.5 text-[11px] uppercase tracking-wider text-slate-500">
                    Totales de la selección
                  </td>
                  <td className="tabular px-2 py-2.5 text-right text-xs">{formatNum(totales.base)}</td>
                  <td className="tabular px-2 py-2.5 text-right text-xs">{formatNum(totales.iva)}</td>
                  <td className="tabular px-2 py-2.5 text-right text-xs">{formatNum(totales.irpf)}</td>
                  <td className="tabular px-2 py-2.5 text-right text-xs">{formatNum(totales.total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Eliminar factura"
        description="Esta acción quita la factura del libro registro y de los cálculos fiscales."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPendingDelete(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn bg-rose-600 text-white hover:bg-rose-500"
              onClick={() => {
                onDelete(pendingDelete.id);
                pushToast('success', 'Factura eliminada del libro registro.');
                setPendingDelete(null);
              }}
            >
              <Trash className="h-4 w-4" />
              Eliminar definitivamente
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Se eliminará la factura <strong>{pendingDelete?.numero_factura || 'sin número'}</strong> de{' '}
          <strong>{pendingDelete?.emisor_nombre}</strong> por <strong>{formatEUR(pendingDelete?.total)}</strong>.
        </p>
      </Modal>
    </div>
  );
}

/* ============================================================================
 * 10.4 PÁGINA — CENTRO DE EXPORTACIÓN DE DATOS
 * ========================================================================== */

const EXCEL_HEADERS = [
  'Fecha',
  'Nº Factura',
  'Tipo',
  'Emisor',
  'NIF Emisor',
  'Receptor',
  'NIF Receptor',
  'Base Imponible',
  '% IVA',
  'Cuota IVA',
  '% IRPF',
  'Cuota IRPF',
  'Total',
  'Categoría',
  'Estado',
  'Origen'
];

function invoiceToExcelRow(inv) {
  return {
    Fecha: inv.fecha,
    'Nº Factura': inv.numero_factura,
    Tipo: inv.tipo,
    Emisor: inv.emisor_nombre,
    'NIF Emisor': inv.emisor_nif,
    Receptor: inv.receptor_nombre,
    'NIF Receptor': inv.receptor_nif,
    'Base Imponible': Number(inv.base_imponible) || 0,
    '% IVA': Number(inv.porcentaje_iva) || 0,
    'Cuota IVA': Number(inv.cuota_iva) || 0,
    '% IRPF': Number(inv.porcentaje_irpf) || 0,
    'Cuota IRPF': Number(inv.cuota_irpf) || 0,
    Total: Number(inv.total) || 0,
    'Categoría': inv.categoria,
    Estado: inv.estado,
    Origen: inv.origen
  };
}

function styleSheet(ws, widths) {
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

/** Libro de 3 hojas: Resumen Fiscal · Facturas Emitidas · Facturas Recibidas. */
function buildWorkbook(invoices, fiscal, year, settings) {
  const wb = XLSX.utils.book_new();
  const etiquetaPeriodo = year === 'all' ? 'Histórico completo' : `Ejercicio ${year}`;

  /* ---- Hoja 1: Resumen Fiscal ---- */
  const emitidas = invoices.filter((i) => i.tipo === 'INGRESO');
  const recibidas = invoices.filter((i) => i.tipo === 'GASTO');

  const resumen = [
    ['MINI GESTORÍA INTELIGENTE — RESUMEN FISCAL'],
    ['Periodo', etiquetaPeriodo],
    ['Generado', new Date().toLocaleString('es-ES')],
    ['Entidad', settings.empresaNombre || '(sin configurar)'],
    ['NIF', settings.empresaNif || '—'],
    [],
    ['INDICADOR', 'IMPORTE (€)'],
    ['Ingresos totales', round2(fiscal.ingresosTotales)],
    ['Gastos totales', round2(fiscal.gastosTotales)],
    ['Resultado neto', round2(fiscal.resultadoNeto)],
    ['Margen neto (%)', round2(fiscal.margenNeto)],
    [],
    ['IVA repercutido', round2(fiscal.ivaRepercutido)],
    ['IVA soportado', round2(fiscal.ivaSoportado)],
    ['LIQUIDACIÓN IVA (Modelo 303)', round2(fiscal.liquidacion303)],
    [],
    ['Base imponible ingresos', round2(fiscal.baseIngresos)],
    ['Base imponible gastos', round2(fiscal.baseGastos)],
    ['Rendimiento neto', round2(fiscal.rendimientoNeto)],
    [`ESTIMACIÓN IRPF (Modelo 130 · ${settings.tipoIrpf130} %)`, round2(fiscal.estimacion130)],
    ['Retenciones soportadas (clientes)', round2(fiscal.retencionesSoportadas)],
    ['Presión fiscal acumulada (%)', round2(fiscal.presionFiscal)],
    [],
    ['Facturas registradas', fiscal.totalFacturas],
    ['Facturas emitidas', emitidas.length],
    ['Facturas recibidas', recibidas.length],
    ['Incidencias de cuadre', fiscal.incidencias],
    [],
    ['TRIMESTRE', 'INGRESOS', 'GASTOS', 'IVA A LIQUIDAR', 'IRPF ESTIMADO', 'CARGA TOTAL', 'PRESIÓN (%)'],
    ...fiscal.quarters.map((q) => [
      q.id,
      round2(q.ingresos),
      round2(q.gastos),
      round2(q.ivaLiquidado),
      round2(q.irpfEstimado),
      round2(q.carga),
      round2(q.presion)
    ]),
    [],
    ['CATEGORÍA DE GASTOS', 'BASE IMPONIBLE (€)', 'Nº FACTURAS'],
    ...fiscal.gastosPorCategoria.map((c) => [c.name, round2(c.value), c.count])
  ];

  const wsResumen = styleSheet(XLSX.utils.aoa_to_sheet(resumen), [38, 22, 16, 18, 18, 18, 16]);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen Fiscal');

  /* ---- Hojas 2 y 3: Emitidas / Recibidas ---- */
  const buildDetail = (list) => {
    const rows = [...list].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map(invoiceToExcelRow);
    const ws = XLSX.utils.json_to_sheet(rows, { header: EXCEL_HEADERS });
    styleSheet(ws, [12, 14, 10, 30, 14, 30, 14, 14, 9, 12, 9, 12, 13, 22, 20, 12]);
    // `!ref` es un rango en string ("A1:P8") y el autofilter lo espera como string.
    if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] };
    return ws;
  };

  XLSX.utils.book_append_sheet(wb, buildDetail(emitidas), 'Facturas Emitidas');
  XLSX.utils.book_append_sheet(wb, buildDetail(recibidas), 'Facturas Recibidas');

  return wb;
}

function exportExcel(invoices, fiscal, year, settings) {
  const wb = buildWorkbook(invoices, fiscal, year, settings);
  const stamp = todayISO().replace(/-/g, '');
  const period = year === 'all' ? 'historico' : String(year);
  XLSX.writeFile(wb, `MiniGestoria_${period}_${stamp}.xlsx`);
}

/* ---------- Gráficos en canvas para el PDF ------------------------------- */

function makeHiResCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx, width, height };
}

const shortEur = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} k€`;
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
};

/** Barras Ingresos vs Gastos listas para incrustar en el PDF. */
function renderBarChartCanvas(monthly) {
  const W = 840;
  const H = 300;
  const { canvas, ctx } = makeHiResCanvas(W, H);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const pad = { l: 66, r: 18, t: 34, b: 42 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = Math.max(1, ...monthly.map((m) => Math.max(m.ingresos, m.gastos)));

  // Leyenda
  ctx.font = '600 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#10b981';
  ctx.fillRect(pad.l, 8, 10, 10);
  ctx.fillStyle = '#0f172a';
  ctx.fillText('Ingresos', pad.l + 16, 17);
  ctx.fillStyle = '#f43f5e';
  ctx.fillRect(pad.l + 92, 8, 10, 10);
  ctx.fillStyle = '#0f172a';
  ctx.fillText('Gastos', pad.l + 108, 17);

  // Rejilla + eje Y
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i += 1) {
    const value = (max / 4) * i;
    const y = pad.t + plotH - (value / max) * plotH;
    ctx.strokeStyle = i === 0 ? '#cbd5e1' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(shortEur(value), pad.l - 8, y + 4);
  }

  const groupW = plotW / monthly.length;
  const barW = Math.max(6, Math.min(16, groupW * 0.3));

  monthly.forEach((m, i) => {
    const center = pad.l + groupW * i + groupW / 2;
    const hIng = (m.ingresos / max) * plotH;
    const hGas = (m.gastos / max) * plotH;

    ctx.fillStyle = '#10b981';
    ctx.fillRect(center - barW - 2, pad.t + plotH - hIng, barW, hIng);

    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(center + 2, pad.t + plotH - hGas, barW, hGas);

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    ctx.fillText(MESES[i], center, H - pad.b + 18);
  });

  return canvas.toDataURL('image/png');
}

/** Donut de gastos por categoría listo para incrustar en el PDF. */
function renderDonutCanvas(data) {
  if (!data?.length) return null;
  const W = 840;
  const H = 250;
  const { canvas, ctx } = makeHiResCanvas(W, H);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const cxp = 130;
  const cyp = H / 2;
  const radius = 92;
  const thickness = 34;

  let angle = -Math.PI / 2;
  data.forEach((d) => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = CATEGORIA_COLORS[d.name] || '#64748b';
    ctx.lineWidth = thickness;
    ctx.arc(cxp, cyp, radius, angle, angle + slice);
    ctx.stroke();
    angle += slice;
  });

  // Centro del donut
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = '600 20px sans-serif';
  ctx.fillText(shortEur(total), cxp, cyp + 4);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px sans-serif';
  ctx.fillText('Base gastos', cxp, cyp + 22);

  // Leyenda
  const legendX = 300;
  let legendY = 44;
  ctx.textAlign = 'left';
  data.forEach((d) => {
    const color = CATEGORIA_COLORS[d.name] || '#64748b';
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 9, 11, 11);

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 13px sans-serif';
    ctx.fillText(d.name, legendX + 20, legendY);

    const pct = ((d.value / total) * 100).toFixed(1).replace('.', ',');
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    const rightText = `${shortEur(d.value)} · ${pct} %`;
    ctx.textAlign = 'right';
    ctx.fillText(rightText, W - 24, legendY);
    ctx.textAlign = 'left';

    legendY += 34;
  });

  return canvas.toDataURL('image/png');
}

/** PDF formal con membrete, desglose de impuestos y gráficos incrustados. */
function exportPdf({ invoices, fiscal, year, settings, includeCharts = true, includeDetail = true }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const M = 14;
  const NAVY = [15, 23, 42];
  const EMERALD = [16, 185, 129];
  const MUTED = [100, 116, 139];
  const LINE = [226, 232, 240];

  const money = (n) => `${formatNum(n)} EUR`;
  const entidad = settings.empresaNombre || 'Entidad no configurada';
  const periodo = year === 'all' ? 'Histórico completo' : `Ejercicio ${year}`;
  let y = 0;

  const banner = (first) => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PAGE_W, first ? 32 : 18, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(first ? 16 : 12);
    doc.text(entidad, M, first ? 15 : 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(first ? 9 : 8);
    doc.text(
      first ? `${settings.empresaNif ? `NIF/CIF ${settings.empresaNif} · ` : ''}${settings.empresaDomicilio || ''}` : periodo,
      M,
      first ? 22 : 16
    );

    doc.setFontSize(first ? 10 : 8);
    doc.text('MINI GESTORÍA INTELIGENTE', PAGE_W - M, first ? 15 : 11, { align: 'right' });
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.text(periodo, PAGE_W - M, first ? 22 : 16, { align: 'right' });
  };

  const section = (label) => {
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(label.toUpperCase(), M, y);
    doc.setDrawColor(...EMERALD);
    doc.setLineWidth(0.7);
    doc.line(M, y + 1.6, PAGE_W - M, y + 1.6);
    y += 7;
  };

  const ensure = (needed) => {
    if (y + needed > PAGE_H - 20) {
      doc.addPage();
      y = 24;
      banner(false);
      y += 6;
    }
  };

  /* ---- Portada ---- */
  banner(true);
  y = 44;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Informe fiscal y de facturación', M, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const subtitle = `Documento generado el ${new Date().toLocaleDateString('es-ES')} · ${fiscal.totalFacturas} facturas registradas`;
  doc.text(doc.splitTextToSize(subtitle, PAGE_W - M * 2), M, y);
  y += 12;

  /* ---- KPIs ---- */
  section('Resumen del periodo');

  const kpis = [
    ['Ingresos totales', money(fiscal.ingresosTotales)],
    ['Gastos totales', money(fiscal.gastosTotales)],
    ['Resultado neto', money(fiscal.resultadoNeto)],
    ['Liquidación IVA (303)', money(fiscal.liquidacion303)],
    [`Estimación IRPF (130 · ${settings.tipoIrpf130} %)`, money(fiscal.estimacion130)],
    ['Presión fiscal', `${fiscal.presionFiscal.toFixed(1).replace('.', ',')} %`]
  ];

  const boxW = (PAGE_W - M * 2 - 8) / 3;
  const boxH = 20;

  kpis.forEach((kpi, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const bx = M + col * (boxW + 4);
    const by = y + row * (boxH + 4);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(bx, by, boxW, boxH, 2.5, 2.5, 'FD');

    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(doc.splitTextToSize(kpi[0], boxW - 6)[0], bx + 4, by + 7.5);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(kpi[1], bx + 4, by + 15);
  });

  y += (boxH + 4) * 2 + 8;

  /* ---- Liquidación de impuestos ---- */
  section('Liquidación de impuestos');

  const taxRows = [
    ['IVA repercutido (ingresos)', money(fiscal.ivaRepercutido)],
    ['IVA soportado (gastos)', money(fiscal.ivaSoportado)],
    ['A liquidar en el Modelo 303', money(fiscal.liquidacion303)],
    ['Rendimiento neto (base ingresos − gastos)', money(fiscal.rendimientoNeto)],
    [`Retención de IRPF estimada (Modelo 130 · ${settings.tipoIrpf130} %)`, money(fiscal.estimacion130)],
    ['Retenciones soportadas por clientes', money(fiscal.retencionesSoportadas)]
  ];

  taxRows.forEach((row, i) => {
    const highlight = i === 2 || i === 4;
    if (highlight) {
      doc.setFillColor(236, 253, 245);
      doc.setDrawColor(167, 243, 208);
      doc.rect(M, y - 4.5, PAGE_W - M * 2, 7, 'FD');
    }

    doc.setFont('helvetica', highlight ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...(highlight ? [6, 78, 59] : [51, 65, 85]));
    doc.text(row[0], M + 2, y);

    doc.text(row[1], PAGE_W - M - 2, y, { align: 'right' });
    y += 7;
  });

  y += 3;

  /* ---- Trimestres ---- */
  if (y + 52 > PAGE_H - 20) {
    doc.addPage();
    y = 24;
    banner(false);
    y += 6;
  }

  section('Desglose por trimestre');

  const colX = [M, M + 24, M + 62, M + 100, M + 138, PAGE_W - M];
  const headers = ['Periodo', 'Ingresos', 'IVA liquidar', 'IRPF est.', 'Carga'];

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y - 5, PAGE_W - M * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  headers.forEach((h, i) => {
    doc.text(h, i === headers.length - 1 ? colX[i] : colX[i] + 1, y, {
      align: i === headers.length - 1 ? 'right' : 'left'
    });
  });
  y += 7;

  fiscal.quarters.forEach((q) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, y - 4, PAGE_W - M, y - 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(q.id, colX[0] + 1, y);

    doc.setFont('helvetica', 'normal');
    doc.text(money(q.ingresos), colX[1] + 1, y);
    doc.text(money(q.ivaLiquidado), colX[2] + 1, y);
    doc.text(money(q.irpfEstimado), colX[3] + 1, y);
    doc.setFont('helvetica', 'bold');
    doc.text(money(q.carga), PAGE_W - M - 1, y, { align: 'right' });
    y += 7;
  });

  y += 6;

  /* ---- Gráficos incrustados ---- */
  if (includeCharts) {
    section('Evolución mensual y distribución de gastos');

    try {
      const barImg = renderBarChartCanvas(fiscal.monthly);
      const chartH = 64;
      doc.addImage(barImg, 'PNG', M, y, PAGE_W - M * 2, chartH);
      y += chartH + 6;

      const donutData = fiscal.gastosPorCategoria;
      if (donutData.length) {
        ensure(56);
        const donutImg = renderDonutCanvas(donutData);
        doc.addImage(donutImg, 'PNG', M, y, PAGE_W - M * 2, 48);
        y += 54;
      }
    } catch {
      y += 2;
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.text('(Gráficos no disponibles en este render)', M, y);
      y += 8;
    }
  }

  /* ---- Detalle de facturas ---- */
  if (includeDetail && invoices.length) {
    ensure(30);
    section(`Libro registro · ${invoices.length} facturas`);

    const detailHeader = ['Fecha', 'Nº', 'Tipo', 'Concepto / emisor', 'Base', 'IVA', 'IRPF', 'Total'];
    const widths = [17, 20, 15, 62, 20, 17, 17, 21];

    const drawDetailHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(M, y - 4.6, PAGE_W - M * 2, 6.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      let cx = M;
      detailHeader.forEach((h, i) => {
        const alignRight = i >= 4;
        doc.text(h, alignRight ? cx + widths[i] - 1.5 : cx + 1.5, y, { align: alignRight ? 'right' : 'left' });
        cx += widths[i];
      });
      y += 7;
    };

    drawDetailHeader();

    [...invoices]
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
      .forEach((inv, index) => {
        if (y > PAGE_H - 24) {
          doc.addPage();
          y = 24;
          banner(false);
          y += 6;
          drawDetailHeader();
        }

        if (index % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(M, y - 4.4, PAGE_W - M * 2, 6, 'F');
        }

        const cells = [
          inv.fecha,
          inv.numero_factura || '—',
          inv.tipo,
          `${inv.emisor_nombre || '—'}${inv.categoria ? ` · ${inv.categoria}` : ''}`,
          money(inv.base_imponible),
          money(inv.cuota_iva),
          money(inv.cuota_irpf),
          money(inv.total)
        ];

        doc.setTextColor(51, 65, 85);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);

        let cx = M;
        cells.forEach((cell, i) => {
          const alignRight = i >= 4;
          const maxWidth = widths[i] - 3;
          const text = Array.isArray(cell)
            ? cell
            : doc.splitTextToSize(String(cell), maxWidth)[0];
          doc.text(
            text,
            alignRight ? cx + widths[i] - 1.5 : cx + 1.5,
            y,
            { align: alignRight ? 'right' : 'left' }
          );
          cx += widths[i];
        });

        if (!isValid(inv.estado)) {
          doc.setTextColor(217, 119, 6);
          doc.setFont('helvetica', 'bold');
          doc.text('!', PAGE_W - M - 1.5, y, { align: 'right' });
        }

        y += 6;
      });

    y += 4;
  }

  /* ---- Nota legal ---- */
  ensure(24);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, PAGE_W - M, y);
  y += 6;

  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  const nota = doc.splitTextToSize(
    'Documento generado automáticamente por Mini Gestoría Inteligente a partir de los datos introducidos por el usuario. Las cantidades de IVA y de IRPF son estimaciones orientativas calculadas sobre el libro registro y no constituyen asesoramiento fiscal ni sustituyen la presentación oficial de los modelos 303 y 130.',
    PAGE_W - M * 2
  );
  doc.text(nota, M, y);

  /* ---- Pie de página en todas las hojas ---- */
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, PAGE_H - 14, PAGE_W - M, PAGE_H - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Mini Gestoría Inteligente · ${entidad}`, M, PAGE_H - 9);
    doc.text(`Página ${p} de ${pages}`, PAGE_W - M, PAGE_H - 9, { align: 'right' });
  }

  const stamp = todayISO().replace(/-/g, '');
  const period = year === 'all' ? 'historico' : String(year);
  doc.save(`MiniGestoria_Informe_${period}_${stamp}.pdf`);
}

const PREVIEW_TONES = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  rose: 'text-rose-600 dark:text-rose-400',
  blue: 'text-blue-700 dark:text-blue-400',
  amber: 'text-amber-600 dark:text-amber-400'
};

function ExportPage({ invoices, fiscal, year, years, onYearChange, settings, onImportJson, pushToast }) {
  /* Arranca con las opciones por defecto configuradas en Ajustes (overridables en cada descarga). */
  const [includeCharts, setIncludeCharts] = useState(settings?.exportIncluirGraficos !== false);
  const [includeDetail, setIncludeDetail] = useState(settings?.exportIncluirDetalle !== false);
  const [exporting, setExporting] = useState(null);
  const importInputRef = useRef(null);

  const onImportFile = async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed?.invoices;
      if (!Array.isArray(list)) throw new Error('El archivo no contiene una lista de facturas.');
      return list;
    } catch (error) {
      throw new Error(`Archivo no válido: ${error.message}`);
    }
  };

  const doExcel = async () => {
    if (!invoices.length) return pushToast('error', 'No hay facturas para exportar.');
    setExporting('xlsx');
    try {
      await new Promise((r) => setTimeout(r, 60));
      exportExcel(invoices, fiscal, year, settings);
      pushToast('success', 'Libro Excel generado con 3 hojas.');
    } catch (error) {
      pushToast('error', `Error al generar Excel: ${error.message}`);
    } finally {
      setExporting(null);
    }
  };

  const doPdf = async () => {
    if (!invoices.length) return pushToast('error', 'No hay facturas para exportar.');
    setExporting('pdf');
    try {
      await new Promise((r) => setTimeout(r, 60));
      exportPdf({ invoices, fiscal, year, settings, includeCharts, includeDetail });
      pushToast('success', 'Informe PDF descargado con membrete y gráficos.');
    } catch (error) {
      pushToast('error', `Error al generar PDF: ${error.message}`);
    } finally {
      setExporting(null);
    }
  };

  const doJson = () => {
    if (!invoices.length) return pushToast('error', 'No hay facturas para exportar.');
    const payload = { app: 'mini-gestoria', version: 1, exportedAt: new Date().toISOString(), settings, invoices };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `MiniGestoria_copia_${todayISO()}.json`);
    pushToast('success', 'Copia de seguridad JSON descargada.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de Exportación de Datos"
        subtitle="Entregables listos para la gestoría o para tu archivo fiscal"
        right={<PeriodSelector year={year} years={years} onChange={onYearChange} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Excel */}
        <Card
          title="Libro Excel (.xlsx)"
          subtitle="3 hojas: Resumen Fiscal · Facturas Emitidas · Facturas Recibidas"
          actions={<Badge tone="emerald" icon={FileSpreadsheet}>SheetJS</Badge>}
        >
          <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            {[
              'Resumen Fiscal: KPIs, liquidación 303/130, trimestres y categorías.',
              'Facturas Emitidas: tabla con autofiltro y 16 columnas.',
              'Facturas Recibidas: tabla con autofiltro y 16 columnas.'
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {invoices.length} facturas · {year === 'all' ? 'histórico' : year}
            </span>
            <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={doExcel} disabled={exporting === 'xlsx'}>
              {exporting === 'xlsx' ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
              Descargar .xlsx
            </button>
          </div>
        </Card>

        {/* PDF */}
        <Card
          title="Informe PDF oficial"
          subtitle="Membrete, desglose de impuestos, gráficos incrustados y detalle"
          actions={<Badge tone="blue" icon={Printer}>jsPDF</Badge>}
        >
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeCharts}
                onChange={(e) => setIncludeCharts(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600"
              />
              <span>
                Incluir gráficos
                <span className="block text-[11px] text-slate-400">Barras mensuales y donut de categorías</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeDetail}
                onChange={(e) => setIncludeDetail(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600"
              />
              <span>
                Incluir libro registro completo
                <span className="block text-[11px] text-slate-400">Detalle paginado de las {invoices.length} facturas</span>
              </span>
            </label>

            <InlineNotice tone="info" className="!text-[11px]">
              El membrete usa los <strong>Datos fiscales</strong> configurados en Ajustes
              {settings.empresaNombre ? ` (${settings.empresaNombre})` : ' — pendiente de configurar'}.
            </InlineNotice>
          </div>

          <div className="mt-4 flex items-center justify-end gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">A4 · con pie de página</span>
            <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={doPdf} disabled={exporting === 'pdf'}>
              {exporting === 'pdf' ? <Spinner /> : <FileDown className="h-3.5 w-3.5" />}
              Descargar PDF
            </button>
          </div>
        </Card>

        {/* JSON */}
        <Card
          title="Copia de seguridad"
          subtitle="JSON con facturas y ajustes para migrar o archivar"
          actions={<Badge tone="slate" icon={Braces}>JSON</Badge>}
        >
          <div className="space-y-2">
            <button type="button" className="btn-secondary w-full justify-start" onClick={doJson}>
              <Download className="h-4 w-4" />
              Exportar copia (.json)
            </button>

            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const list = await onImportFile(file);
                  onImportJson(list);
                } catch (error) {
                  pushToast('error', error.message);
                }
              }}
            />

            <button type="button" className="btn-secondary w-full justify-start" onClick={() => importInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Importar copia (.json)
            </button>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Todo se guarda primero en <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-white/10">localStorage</code>. La
            copia JSON permite trasladar el libro registro a otro equipo sin depender de ningún servicio externo.
          </p>
        </Card>
      </div>

      {/* Resumen exportable */}
      <Card title="Vista previa del resumen fiscal" subtitle="Exactamente lo que verá tu gestoría en la primera hoja del Excel">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Ingresos', formatEUR(fiscal.ingresosTotales), 'emerald'],
            ['Gastos', formatEUR(fiscal.gastosTotales), 'rose'],
            ['IVA a liquidar', formatEUR(fiscal.liquidacion303), 'blue'],
            ['IRPF estimado', formatEUR(fiscal.estimacion130), 'amber']
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-slate-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-950/40">
              <p className="section-title">{label}</p>
              <p className={cx('tabular mt-1 text-sm font-semibold', PREVIEW_TONES[tone])}>{value}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================================
 * 10.5 PÁGINA — AJUSTES Y CONFIGURACIÓN
 * ========================================================================== */

function SettingRow({ icon: Icon, title, description, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200/70 py-4 last:border-0 sm:flex-row sm:items-start sm:gap-6 dark:border-white/10">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      <div className="w-full shrink-0 sm:max-w-xs">{children}</div>
    </div>
  );
}

function SettingsPage({
  settings,
  onPatchSettings,
  theme,
  onThemeChange,
  invoices,
  onLoadDemo,
  onClearAll,
  onMergeInvoices,
  pushToast
}) {
  /* Exclusivamente configuración del cliente: sin campos de credenciales ni panel de integraciones. */
  const [confirmClear, setConfirmClear] = useState(false);

  const storageBytes = useMemo(() => {
    try {
      return (localStorage.getItem(STORAGE_KEYS.invoices) || '').length + (localStorage.getItem(STORAGE_KEYS.settings) || '').length;
    } catch {
      return 0;
    }
  }, [invoices, settings]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajustes y Configuración"
        subtitle="Datos fiscales del cliente, preferencias de tema y opciones de exportación"
        right={<Badge tone="slate" icon={Lock}>localStorage</Badge>}
      />

      {/* Datos fiscales del cliente */}
      <Card
        title="Datos fiscales del autónomo / empresa"
        subtitle="Nombre o razón social, NIF/CIF y domicilio: se usan en el membrete del PDF y en las exportaciones"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre fiscal / razón social" htmlFor="s-nombre">
            <TextInput
              id="s-nombre"
              value={settings.empresaNombre}
              onChange={(e) => onPatchSettings({ empresaNombre: e.target.value })}
              placeholder="Estudio Ribera S.L."
            />
          </Field>
          <Field label="NIF / CIF" htmlFor="s-nif">
            <TextInput
              id="s-nif"
              value={settings.empresaNif}
              onChange={(e) => onPatchSettings({ empresaNif: e.target.value })}
              placeholder="B-99887766"
            />
          </Field>
          <Field label="Domicilio fiscal" htmlFor="s-dom">
            <TextInput
              id="s-dom"
              value={settings.empresaDomicilio}
              onChange={(e) => onPatchSettings({ empresaDomicilio: e.target.value })}
              placeholder="C/ Mayor 12, 28013 Madrid"
            />
          </Field>
          <Field label="Email de contacto" htmlFor="s-email">
            <TextInput
              id="s-email"
              type="email"
              value={settings.empresaEmail}
              onChange={(e) => onPatchSettings({ empresaEmail: e.target.value })}
              placeholder="admin@estudioribera.es"
            />
          </Field>
        </div>
      </Card>

      {/* Opciones de exportación */}
      <Card
        title="Opciones de exportación"
        subtitle="Valores por defecto del Centro de Exportación; puedes cambiarlos en cada descarga"
      >
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={settings.exportIncluirGraficos !== false}
              onChange={(e) => onPatchSettings({ exportIncluirGraficos: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600"
            />
            <span>
              Incluir gráficos en el PDF
              <span className="block text-[11px] text-slate-400">Barras mensuales y donut de categorías</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={settings.exportIncluirDetalle !== false}
              onChange={(e) => onPatchSettings({ exportIncluirDetalle: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600"
            />
            <span>
              Incluir libro registro completo en el PDF
              <span className="block text-[11px] text-slate-400">Detalle paginado de todas las facturas</span>
            </span>
          </label>

          <InlineNotice tone="info" className="!text-[11px]">
            El membrete del informe usa los <strong>Datos fiscales</strong> de esta misma página.
          </InlineNotice>
        </div>
      </Card>

      {/* Preferencias fiscales */}
      <Card title="Preferencias fiscales" subtitle="Tipos aplicados a las estimaciones del 303 y del 130">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tipo de IVA general (%)" htmlFor="s-iva" hint="Valor por defecto del extractor IA">
            <TextInput
              id="s-iva"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={settings.tipoIva}
              onChange={(e) => onPatchSettings({ tipoIva: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Retención IRPF clientes (%)" htmlFor="s-irpf" hint="Habitual en servicios profesionales">
            <TextInput
              id="s-irpf"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={settings.tipoIrpfRetencion}
              onChange={(e) => onPatchSettings({ tipoIrpfRetencion: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Pago a cuenta IRPF 130 (%)" htmlFor="s-130" hint="15 % general · 7 % inicio de actividad">
            <TextInput
              id="s-130"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={settings.tipoIrpf130}
              onChange={(e) => onPatchSettings({ tipoIrpf130: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
      </Card>

      {/* Apariencia */}
      <Card title="Apariencia" subtitle="Tema claro u oscuro · se aplica en todo el siguiente arranque">
        <SegmentedControl
          ariaLabel="Tema de la aplicación"
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'system', label: 'Sistema', icon: Monitor },
            { value: 'light', label: 'Claro', icon: Sun },
            { value: 'dark', label: 'Oscuro', icon: Moon }
          ]}
        />
      </Card>

      {/* Datos */}
      <Card
        title="Datos y demostración"
        subtitle="Poblamiento inicial, copias de seguridad y reinicio"
        actions={<Badge tone="slate" icon={Layers}>{invoices.length} facturas · {(storageBytes / 1024).toFixed(1)} KB</Badge>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button type="button" className="btn-secondary justify-start" onClick={onLoadDemo}>
            <Play className="h-4 w-4 text-emerald-500" />
            Cargar datos demo
          </button>

          <button
            type="button"
            className="btn-secondary justify-start"
            onClick={() => {
              const payload = { app: 'mini-gestoria', version: 1, exportedAt: new Date().toISOString(), settings, invoices };
              downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `MiniGestoria_copia_${todayISO()}.json`);
              pushToast('success', 'Copia de seguridad descargada.');
            }}
          >
            <Download className="h-4 w-4" />
            Exportar copia JSON
          </button>

          <button
            type="button"
            className="btn justify-start border border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/15 dark:text-rose-400"
            onClick={() => setConfirmClear(true)}
            disabled={!invoices.length}
          >
            <Trash className="h-4 w-4" />
            Vaciar libro registro
          </button>
        </div>

        <InlineNotice tone="info" className="mt-4">
          <strong>Modo Demo</strong> crea 12 facturas ficticias de un ejercicio completo (con una incidencia de cuadre
          incluida a propósito) para probar gráficos, edición, validación y exportaciones sin tocar tus datos reales.
        </InlineNotice>
      </Card>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Vaciar el libro registro"
        description="Se eliminarán todas las facturas almacenadas en este navegador."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmClear(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn bg-rose-600 text-white hover:bg-rose-500"
              onClick={() => {
                onClearAll();
                setConfirmClear(false);
              }}
            >
              <Trash className="h-4 w-4" />
              Vaciar {invoices.length} facturas
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Esta acción no se puede deshacer. Si quieres conservar una copia, expórtala antes en JSON.
        </p>
      </Modal>
    </div>
  );
}

/* ============================================================================
 * 11. SHELL (navegación) Y COMPONENTE APP
 * ========================================================================== */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard Financiero', icon: LayoutDashboard },
  { id: 'processor', label: 'Procesador de Facturas', icon: ScanLine, badge: 'IA' },
  { id: 'ledger', label: 'Libro Registro', icon: Table2 },
  { id: 'export', label: 'Centro de Exportación', icon: FileSpreadsheet },
  { id: 'settings', label: 'Ajustes', icon: Settings }
];

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-blue-700 text-white shadow-[0_10px_20px_-10px_rgba(16,185,129,.9)]">
      <Landmark className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
    </span>
  );
}

function NavList({ route, onNavigate, dense = false }) {
  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = route === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
              dense ? 'py-2.5' : 'py-2.5',
              active
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-white/10'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100'
            )}
          >
            <span
              className={cx(
                'flex h-8 w-8 items-center justify-center rounded-lg transition',
                active
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'
              )}
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white dark:bg-emerald-500 dark:text-slate-950">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ isDark, onToggleTheme, settings, invoiceCount }) {
  const iniciales = (settings.empresaNombre || 'Mini Gestoría')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="mt-auto space-y-3 border-t border-slate-200/70 pt-4 dark:border-white/10">
      <div className="flex items-center gap-3 px-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-white dark:text-slate-900">
          {iniciales}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
            {settings.empresaNombre || 'Sin entidad configurada'}
          </p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {invoiceCount} facturas · Local-First
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleTheme}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
        aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      >
        <span className="flex items-center gap-2">
          {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          {isDark ? 'Tema oscuro' : 'Tema claro'}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">{isDark ? 'Dark' : 'Light'}</span>
      </button>
    </div>
  );
}

function App() {
  /* ---------- Estado persistente ---------- */
  const [settings, setSettings] = useState(() => sanitizeSettings(readLS(STORAGE_KEYS.settings, {})));
  const [invoices, setInvoices] = useState(() => {
    const stored = readLS(STORAGE_KEYS.invoices, []);
    return Array.isArray(stored) ? stored.map(normalizeInvoice) : [];
  });
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.theme) || 'system';
    } catch {
      return 'system';
    }
  });

  /* ---------- Estado de UI ---------- */
  const [route, setRoute] = useState('dashboard');
  const [year, setYear] = useState(new Date().getFullYear());
  const [menuOpen, setMenuOpen] = useState(false);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  const isDark = theme === 'system' ? systemDark : theme === 'dark';

  /* ---------- Efectos ---------- */
  useEffect(() => {
    if (!writeLS(STORAGE_KEYS.settings, settings)) {
      pushToast('error', 'No se pudieron guardar los ajustes: almacenamiento local lleno o bloqueado (modo privado).');
    }
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!writeLS(STORAGE_KEYS.invoices, invoices)) {
      pushToast('error', 'No se pudieron guardar las facturas: almacenamiento local lleno o bloqueado.');
    }
  }, [invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      /* modo privado */
    }
  }, [isDark, theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [route]);

  /* Si el ejercicio seleccionado queda sin datos, saltamos al más reciente. */
  useEffect(() => {
    if (year === 'all' || !invoices.length) return;
    const yearsWithData = invoices.map((i) => getYear(i.fecha));
    if (!yearsWithData.includes(year)) setYear(Math.max(...yearsWithData));
  }, [invoices, year]);

  /* ---------- Derivados ---------- */
  const years = useMemo(() => {
    const set = new Set(invoices.map((i) => getYear(i.fecha)));
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [invoices]);

  const fiscal = useMemo(() => computeFiscal(invoices, year, settings), [invoices, year, settings]);

  /* ---------- Callbacks ---------- */
  const pushToast = useCallback((type, message) => {
    const id = uid();
    setToasts((prev) => [...prev, prev.length > 3 ? prev[3] : null, { id, type, message }].filter(Boolean).slice(-4));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);

  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const patchSettings = useCallback((patch) => setSettings((prev) => ({ ...prev, ...patch })), []);

  const saveMany = useCallback(
    (list) => {
      setInvoices((prev) => {
        const map = new Map(prev.map((i) => [i.id, i]));
        list.forEach((i) => map.set(i.id, i));
        return Array.from(map.values());
      });
    },
    []
  );

  const updateInvoice = useCallback((id, next) => {
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...next, estado: next.estado || validateInvoice({ ...i, ...next }) } : i)));
  }, []);

  const deleteInvoice = useCallback((id) => setInvoices((prev) => prev.filter((i) => i.id !== id)), []);

  const mergeFromCloud = useCallback(
    (remote) => setInvoices((prev) => mergeInvoices(prev, remote)),
    []
  );

  const importJson = useCallback(
    (list) => {
      const normalized = list.map((raw) => normalizeInvoice({ ...raw, origen: raw.origen || 'import' }));
      saveMany(normalized);
      pushToast('success', `${normalized.length} facturas importadas en el libro registro.`);
    },
    [saveMany, pushToast]
  );

  const loadDemo = useCallback(() => {
    setInvoices((prev) => {
      if (prev.some((i) => i.origen === 'demo')) return prev;
      return [...buildDemoInvoices(), ...prev];
    });
    const already = invoices.some((i) => i.origen === 'demo');
    if (already) pushToast('info', 'Los datos de demostración ya estaban cargados.');
    else pushToast('success', '12 facturas de demostración cargadas. ¡Explora el dashboard!');
    setRoute('dashboard');
  }, [invoices, pushToast]);

  const clearAll = useCallback(() => {
    setInvoices([]);
    pushToast('success', 'Libro registro vaciado.');
  }, [pushToast]);

  const toggleTheme = useCallback(() => setTheme(isDark ? 'light' : 'dark'), [isDark]);

  const aiReady = Boolean(ENV.deepseekApiKey);
  const hasDemo = invoices.length > 0;

  /* ---------- Render ---------- */
  return (
    <div className="relative min-h-screen">
      {/* Fondo: degradado sutil Slate/Zinc con acentos */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 bg-slate-50 dark:bg-slate-950"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(55rem_35rem_at_10%_-8%,rgba(16,185,129,0.13),transparent_60%)] dark:bg-[radial-gradient(55rem_35rem_at_10%_-8%,rgba(16,185,129,0.10),transparent_60%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(45rem_30rem_at_95%_0%,rgba(30,64,175,0.12),transparent_55%)] dark:bg-[radial-gradient(45rem_30rem_at_95%_0%,rgba(59,94,254,0.12),transparent_55%)]"
      />

      {/* Sidebar fijo (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200/70 bg-white/70 p-4 backdrop-blur-xl lg:flex dark:border-white/10 dark:bg-slate-950/60">
        <div className="mb-6 flex items-center gap-3 px-1">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-white">Mini Gestoría</p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
              Inteligente B2B
            </p>
          </div>
        </div>

        <NavList route={route} onNavigate={setRoute} />

        <SidebarFooter isDark={isDark} onToggleTheme={toggleTheme} settings={settings} invoiceCount={invoices.length} />
      </aside>

      {/* Drawer móvil */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-[19rem] flex-col border-r border-slate-200 bg-white p-4 shadow-lift animate-fade-up dark:border-white/10 dark:bg-slate-950">
            <div className="mb-6 flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-3">
                <BrandMark />
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Mini Gestoría</p>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
                    Inteligente B2B
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar menú"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <NavList route={route} onNavigate={setRoute} />

            <SidebarFooter isDark={isDark} onToggleTheme={toggleTheme} settings={settings} invoiceCount={invoices.length} />
          </div>
        </div>
      )}

      {/* Contenido principal */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
          <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menú"
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 lg:hidden dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {NAV_ITEMS.find((n) => n.id === route)?.label}
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {settings.empresaNombre || 'Entidad sin configurar'} · {fiscal.totalFacturas} facturas · {year === 'all' ? 'histórico' : year}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {!hasDemo && (
                <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={loadDemo}>
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="hidden sm:inline">Cargar demo</span>
                </button>
              )}

              <span
                className={cx(
                  'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset md:inline-flex',
                  aiReady
                    ? 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400'
                    : 'bg-slate-500/12 text-slate-600 ring-slate-500/20 dark:text-slate-300'
                )}
              >
                {aiReady ? <CircleCheck className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                {aiReady ? 'IA activa' : 'IA no configurada'}
              </span>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => setNewInvoiceOpen(true)}
                aria-label="Crear factura manual"
                className="btn-primary !px-2.5 !py-2"
                title="Nueva factura"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden lg:inline">Nueva factura</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {route === 'dashboard' && (
            <DashboardPage
              invoices={invoices}
              fiscal={fiscal}
              year={year}
              years={years}
              onYearChange={setYear}
              settings={settings}
              aiReady={aiReady}
              onNavigate={setRoute}
              onLoadDemo={loadDemo}
            />
          )}

          {route === 'processor' && (
            <ProcessorPage settings={settings} onSaveMany={saveMany} pushToast={pushToast} onNavigate={setRoute} />
          )}

          {route === 'ledger' && (
            <LedgerPage
              invoices={invoices}
              year={year}
              years={years}
              onYearChange={setYear}
              onUpdate={updateInvoice}
              onDelete={deleteInvoice}
              onCreate={() => setNewInvoiceOpen(true)}
              pushToast={pushToast}
            />
          )}

          {route === 'export' && (
            <ExportPage
              invoices={invoices}
              fiscal={fiscal}
              year={year}
              years={years}
              onYearChange={setYear}
              settings={settings}
              onImportJson={importJson}
              pushToast={pushToast}
            />
          )}

          {route === 'settings' && (
            <SettingsPage
              settings={settings}
              onPatchSettings={patchSettings}
              theme={theme}
              onThemeChange={setTheme}
              invoices={invoices}
              onLoadDemo={loadDemo}
              onClearAll={clearAll}
              onMergeInvoices={mergeFromCloud}
              pushToast={pushToast}
            />
          )}
        </main>

        <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-5 text-[11px] text-slate-400 dark:border-white/10">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              Local-First · los datos permanecen en tu navegador salvo sincronización explícita
            </span>
            <span>
              Mini Gestoría Inteligente v1.0 · estimaciones fiscales orientativas (303 / 130) · no sustituye asesoramiento
            </span>
          </div>
        </footer>
      </div>

      {/* Alta manual global */}
      <InvoiceEditorModal
        open={newInvoiceOpen}
        title="Nueva factura manual"
        invoice={null}
        settings={settings}
        onClose={() => setNewInvoiceOpen(false)}
        onSave={(inv) => {
          saveMany([inv]);
          setNewInvoiceOpen(false);
          pushToast('success', 'Factura creada y añadida al libro registro.');
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;

/* ----------------------------------------------------------------------------
 * Exportaciones nombradas: dominio puro + páginas.
 * Permiten tests automatizados sin duplicar lógica ni romper el archivo unificado.
 * -------------------------------------------------------------------------- */
export {
  CATEGORIAS,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  MAX_FILE_SIZE,
  DEEPSEEK_TIMEOUT_MS,
  ACCEPTED_EXTENSIONS,
  validateFile,
  parseAmount,
  normalizeDate,
  normalizeInvoice,
  sanitizeSettings,
  recalcInvoice,
  validateInvoice,
  computeFiscal,
  buildDemoInvoices,
  buildWorkbook,
  exportPdf,
  extractFileText,
  extractInvoiceWithDeepSeek,
  mergeInvoices,
  DashboardPage,
  ProcessorPage,
  LedgerPage,
  ExportPage,
  SettingsPage
};
