# Visor 3D — IBERO

Visor y optimizador de archivos STL binarios o ASCII. Funciona como sitio estático,
sin backend, instalación ni subida de modelos a servidores. Incluye sus dependencias
locales y se puede alojar en GitHub Pages, Nginx o un servidor HTTP de Python.

## Ejecutar

```bash
python -m http.server 8080
```

Abrir http://localhost:8080. No abrir `index.html` mediante `file://`: los módulos,
workers y WebAssembly necesitan HTTP/HTTPS. `index2.html` redirige al visor actualizado.
Para desplegar, subir **todos** los archivos, incluyendo `vendor/`, `mesh-utils.js`
y `mesh-worker.js`. El servidor debe permitir JavaScript y WebAssembly del mismo
origen; no se requieren COOP/COEP, SharedArrayBuffer ni servicios externos.

## Inspeccionar y transformar

- Cargar un STL o arrastrarlo al visor/panel. “Abrir ejemplo” crea una malla de prueba.
- Rotar arrastrando, acercar con rueda/pellizco y desplazar con botón derecho o dos dedos.
- Encuadrar con el botón o la tecla **F**. Vistas 3D, frontal, superior y derecha,
  todas en perspectiva. Pantalla completa y captura PNG.
- Luz de cámara, cuadrícula/ejes, color, malla de triángulos y calidad de renderizado.
- Rotación y traslación por pasos, con reinicio independiente. Las dimensiones y el
  centro de la caja envolvente se actualizan en coordenadas transformadas.
- “Centrar al cargar” es opcional y modifica las coordenadas del modelo cargado.
  Por defecto se preservan las coordenadas del archivo.
- STL no almacena unidades; se asumen mm. No hay conversión automática de unidades.

## Reducir triángulos y tamaño

1. Elegir la **reducción solicitada** con el deslizador o escribir los **triángulos
   objetivo**. El mínimo es 4 y debe ser menor que el número original.
2. Pulsar **Optimizar modelo**. La malla sigue siendo navegable durante el proceso;
   **Cancelar** detiene el trabajador y conserva el último modelo válido.
3. Alternar **Original / Optimizado** para revisar el resultado desde la misma
   cámara, con las mismas transformaciones. Se muestran los conteos reales y los
   tamaños de ambos STL binarios. **Restaurar original** descarta la versión reducida.
4. **Descargar STL original/optimizado** exporta la geometría que esté visible,
   con rotación y traslación aplicadas. El archivo de entrada nunca se sobrescribe.

Cada optimización parte del original, incluso si ya hay una previsualización reducida.
El objetivo es aproximado: las restricciones del algoritmo pueden impedir alcanzarlo,
o dejar una cara por debajo. Revisar bordes, paredes delgadas y detalles pequeños antes
de fabricar: la reducción es geométrica y no garantiza una tolerancia dimensional,
la topología ni la estanqueidad del resultado. Las caras de área cero se omiten antes
de simplificar; se informa si las había. No es una herramienta de reparación de mallas.

El tamaño exacto de un STL binario es **84 + 50 × número de triángulos** bytes.
La estimación no equivale al tamaño del STL ASCII original ni a compresión ZIP;
los valores reales de descarga incluyen la cabecera.

## Rendimiento

- Lectura/validación STL, simplificación y exportación en un **Web Worker**.
- **Fast Quadric Mesh Simplification** C++ mediante WebAssembly: distribución local
  del port de neurolabusc, con intercambio **MZ3 binario** en memoria (sin OBJ de texto).
- Unión exacta de vértices mediante tabla hash tipada antes del algoritmo: los STL
  suelen repetir los tres vértices de cada cara. No se fusionan puntos por tolerancia.
- Normalización temporal de escala para que los umbrales del algoritmo no dependan
  de las unidades; se restauran escala y desplazamiento al recibir el resultado.
- Geometría indexada en la versión optimizada; sin copias redundantes de normales
  o colores en la visualización monocromática. El STL exportado incluye normales.
- Renderizado bajo demanda con amortiguación de cámara y pausa en pestaña oculta.
- Liberación del trabajador/heap WASM tras cada operación y de geometrías GPU al
  reemplazar/restaurar. Una carga fallida conserva el último modelo válido.
- Calidad ajustable limita la densidad de píxeles para pantallas de alta resolución.

La memoria disponible del navegador sigue siendo el límite para archivos muy grandes:
se conserva el original para poder comparar y restaurar, además de la versión reducida.
No hay límite artificial de tamaño ni promesa de rendimiento idéntico entre equipos.

## Archivos

```text
index.html / index2.html     Entradas al visor
styles.css                  Interfaz adaptable a escritorio y móvil
app.js                      Escena, cámara, interfaz y gestión de trabajos
mesh-worker.js              Carga, optimización y exportación en segundo plano
mesh-utils.js               Geometría binaria, validación y unión de vértices
vendor/three/               Three.js 0.160.0 y addons locales
vendor/fast-quadric/         Runtime JS, WASM, procedencia y licencias
assets/                     Identidad IBERO
tests/mesh-utils.test.mjs    Pruebas de geometría y exportación
```

## Pruebas

Opcional, para desarrollo: `npm test` (Node.js moderno, sin dependencias adicionales).
Comprueba unión exacta, vértices con cero negativo, descarte de caras degeneradas,
intercambio MZ3 a distintas escalas, exportación indexada/no indexada con transformaciones,
reapertura en STLLoader y rechazo de datos inválidos. Node.js no es necesario para usar
ni desplegar el visor.

Prueba integral opcional en Chromium (requiere Python y Playwright solo para desarrollo):

```bash
npm install --no-save playwright
npx playwright install chromium
node tests/browser-smoke.mjs
```

Verifica también la reducción de un STL sintético de 819,200 triángulos (40,960,084 bytes),
comparación/restauración, cancelación, exportación y reapertura con transformaciones,
actividad de la interfaz durante la simplificación, reposo del render y ancho móvil de 360 px.
Si el navegador ya está instalado en otra ubicación, se puede indicar mediante
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; `PYTHON` permite cambiar el ejecutable de Python.

## Créditos y licencias

- [Three.js](https://github.com/mrdoob/three), MIT, versión 0.160.0 (misma base del visor original).
- [Fast Quadric Mesh Simplification](https://github.com/sp4cerat/Fast-Quadric-Mesh-Simplification),
  Sven Forstmann y colaboradores, MIT.
- [simplifyjs](https://github.com/neurolabusc/simplifyjs), distribución del port WebAssembly
  de Chris Rorden / MyMiniFactory, MIT. Commit y licencias en
  [vendor/fast-quadric/NOTICE.md](vendor/fast-quadric/NOTICE.md).
