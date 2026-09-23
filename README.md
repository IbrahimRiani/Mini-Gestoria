# Mini Gestoría Inteligente B2B

SPA **React + Vite + Tailwind CSS** para autónomos y gestorías: lectura de facturas con IA (DeepSeek), libro registro, liquidaciones de IVA (Modelo 303) e IRPF (Modelo 130), gráficos interactivos (Recharts) y exportación a **Excel (.xlsx)** y **PDF**.

> **Local-First por defecto.** Sin claves API la aplicación funciona al 100 % con `localStorage`. Supabase y DeepSeek son opcionales.

---

## Arranque rápido

```bash
npm install
cp .env.example .env   # opcional: sin clave, la app avisa y funciona en modo local
npm run dev      # http://localhost:5173
npm run build    # producción en ./dist
npm run preview
```

**Primer uso:** pulsa **«Cargar datos de demostración»** (12 facturas de prueba) para explorar dashboard, gráficos, libro registro y exportaciones **sin configurar ninguna clave**.

---

## Estructura

Toda la lógica de la aplicación vive en un **archivo unificado**:

| Archivo | Contenido |
|---|---|
| `src/App.jsx` | **Aplicación completa**: servicios (DeepSeek/OCR/Supabase), motor fiscal, UI, gráficos, páginas y shell. |
| `src/index.css` | Sistema de diseño Tailwind (tokens, glass-card, botones, foco accesible). |
| `index.html` | Arranque + prevención de parpadeo de tema (FOUC). |
| `supabase/schema.sql` | Esquema opcional para sincronización en la nube. |

### Módulos

1. **Dashboard Financiero** — KPIs (Ingresos, Gastos, Resultado Neto, liquidación IVA 303, estimación IRPF 130), barras mensuales Ingresos vs Gastos, donut de gastos por categoría y presión fiscal por trimestre.
2. **Procesador de Facturas** — drag & drop de PDF/PNG/JPG, **validación previa** (tipo admitido y máx. 10 MB por archivo), extracción de texto (pdfjs / OCR Tesseract), envío a DeepSeek en *JSON Mode* con **timeout de 60 s**, validación matemática local, bandeja de revisión editable y **botón «Reintentar»** en caso de fallo.
3. **Libro Registro** — búsqueda, ordenación, filtros por trimestre/categoría/tipo y **edición in-line** de cualquier campo.
4. **Centro de Exportación** — Excel de 3 hojas (Resumen Fiscal, Emitidas, Recibidas), PDF con membrete y gráficos incrustados, copia de seguridad JSON.
5. **Ajustes** — centrado exclusivamente en el cliente: datos fiscales (nombre/razón social, NIF/CIF, domicilio), preferencias de IVA/IRPF, **opciones de exportación**, tema claro/oscuro y gestión de datos/demo. **No contiene campos de credenciales ni panel de integraciones**: las claves se resuelven internamente desde `.env` y la interfaz usa terminología genérica («motor de IA») en lugar del proveedor.

---

## Credenciales y configuración de integraciones

> 🔑 **Las claves nunca las introduce el cliente ni aparecen en la interfaz.** La aplicación las carga internamente de variables de entorno (`.env`, excluido de git). Si falta una variable, se muestra un **aviso de desarrollo** y la app sigue en modo local (alta manual, demo, exportaciones) sin pedir ninguna clave.

### Variables de entorno

Copia `.env.example` a `.env` y rellena los valores:

| Variable | Uso |
|---|---|
| `VITE_DEEPSEEK_API_KEY` | Lectura de facturas con IA → `POST https://api.deepseek.com/v1/chat/completions` (`response_format: json_object`, `temperature: 0`) |
| `VITE_SUPABASE_URL` | *(opcional)* Project URL de Supabase |
| `VITE_SUPABASE_ANON_KEY` | *(opcional)* anon public key — nunca la `sb_secret_...` |

Tras cualquier cambio, reinicia `npm run dev`. La clave **nunca se muestra ni se pide en la interfaz**: si falta, el Dashboard y el Procesador muestran un aviso de desarrollo («falta la clave del motor de IA…») y la app sigue en modo local.

### Credenciales y proxy seguro (producción)

⚠️ Las variables prefijadas con `VITE_` se **incrustan en el bundle JS público**: cualquier visitante puede leerlas desde las herramientas del desarrollador. Para producción se recomienda:

1. **Proxy de servidor** (recomendado): un endpoint propio (p. ej. `/api/extract`) añade la cabecera `Authorization` en el servidor y el navegador solo ve tu proxy. Toda la llamada a la IA está centralizada en `extractInvoiceWithDeepSeek`, así que basta con apuntar `DEEPSEEK_ENDPOINT` a la ruta relativa.
2. Mientras tanto, restringe cuota/uso de la clave en el panel de DeepSeek. El `.env` local no se sube a git (`.gitignore`).

### Supabase (opcional)

1. Crea un proyecto y ejecuta `supabase/schema.sql` en el SQL Editor.
2. Copia **Project URL** y **anon public key** en `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. De momento la app trabaja en **modo local**: los servicios de sincronización y `supabase/schema.sql` quedan preparados en el código, pero no se exponen en la interfaz.

Sin configurar, la app opera íntegramente en `localStorage`.

> **Aviso `EBADENGINE`**: `@supabase/supabase-js` declara `node>=22`; el aviso solo afecta al requisito de Node del gestor de paquetes — el SDK se ejecuta en el navegador y no condiciona el proyecto (desarrollado y probado en Node 20).

---

## Modelo fiscal (estimaciones)

Cálculos sobre el ejercicio seleccionado. Son **estimaciones orientativas**, no sustituyen al asesoramiento de tu gestoría:

```
Liquidación IVA 303  = Σ IVA repercutido (ingresos) − Σ IVA soportado (gastos)
Rendimiento neto      = Σ Base imponible ingresos − Σ Base imponible gastos
Estimación IRPF 130   = rendimiento neto × % 130 (por defecto 15 %)
Retenciones soportadas= Σ cuota IRPF de facturas emitidas (se deducen en la Declaración Anual)
Presión fiscal (Tn)   = (IVA a liquidar + IRPF estimado) ÷ Ingresos del trimestre
```

**Validación de cada factura:** `base_imponible + cuota_iva − cuota_irpf ≈ total` (tolerancia 0,01 €) → estado **Verificada** / **Inconsistente (Revisar)**.

---

## Testing

```bash
npm run qa          # QA estático: ids duplicados, clases Tailwind inválidas, imports sin usar, secretos
npm test            # 71 comprobaciones: motor fiscal, demo, SSR de páginas, Ajustes sin credenciales, anonimización de marca en la interfaz, Excel (3 hojas), PDF real, validación de archivos, timeout del motor de IA, sin credenciales, esquema Supabase (RLS, orden FOR/TO, ASCII)
npm run test:e2e    # E2E real: PDF → pdfjs → DeepSeek (requiere DEEPSEEK_KEY en el entorno)
npm run build       # build de producción
```

El E2E genera un PDF de prueba, lo extrae con `pdfjs-dist` y lo envía a DeepSeek en JSON Mode, verificando el esquema fiscal devuelto, el manejo de HTTP 401 y la detección de textos que no son facturas.

---

## Notas técnicas

- **Stack**: React 18, Vite 6, Tailwind 3, Recharts 3, SheetJS, jsPDF, lucide-react, `pdfjs-dist` (texto de PDF), `tesseract.js` (OCR de imágenes, se descarga bajo demanda), `@supabase/supabase-js`.
- **OCR de imágenes**: DeepSeek **no admite entrada visual**, así que las PNG/JPG se convierten a texto con OCR local en el navegador. Si falla (p. ej. sin red), la app ofrece pegar el texto manualmente.
- **`xlsx` 0.18.5** es la última versión publicada en npm por SheetJS (posteriores se distribuyen en su CDN oficial). `npm audit` puede alertar sobre avisos conocidos; afectan a archivos de entrada no confiables, no al uso de exportación de esta app.
- **Accesibilidad**: foco visible (`ring`), `aria-label` en controles, contraste alto, soporte `prefers-reduced-motion` y navegación por teclado (Esc cierra modales).
