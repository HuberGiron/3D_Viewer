# Visor STL — IBERO

Pequeña aplicación web para **visualizar** archivos `.stl` con **rotación, zoom y pan**, mostrar **dimensiones**, **triángulos** y **tamaño**, además de **rotar/trasladar** el modelo y **guardar** un nuevo STL con las transformaciones aplicadas.

## Estructura
```
ibero-stl-viewer/
├─ index.html
├─ styles.css
├─ app.js
└─ assets/
   └─ logo-ibero.svg
```

## Requisitos
Solo un navegador moderno con soporte para **ES Modules** e **Import Maps** (Chrome/Edge/Firefox recientes).

> ⚠️ No abras `index.html` con `file://`. Usa un servidor local.

## Ejecutar localmente
1. **VS Code** → extensión *Live Server* → botón **Go Live** sobre `index.html`.
2. **npx**:
   ```bash
   npx serve .
   # o
   python -m http.server 8080
   ```
   Abre `http://localhost:3000` (o el puerto indicado).

## Despliegue en GitHub Pages
1. Sube todo el folder al repo.
2. En **Settings → Pages**, selecciona **Deploy from a branch** y `main` / `docs` según tu preferencia.
3. Espera a que publique la URL.

## Uso
- **Cargar STL** con el botón o **arrastrando** al panel lateral.
- Navegación: **rotar** (botón izq), **zoom** (rueda), **pan** (botón der o Ctrl+izq).
- Opciones:
  - **Luz ligada a la cámara**: ilumina siempre desde la vista.
  - **Centrar al cargar**: si está activo, el modelo se coloca en el origen al abrir.
- **Controles**: rotación (°) y traslación (mm) por pasos, con reset.
- **Guardar**: descarga un `.stl` con **pos/rot/escala** horneadas.

## Notas
- STL **no define unidades**; aquí se asume **mm**.
- Si tu archivo está en cm/m, ajusta el paso de traslación/rotación o reescálalo antes de exportar.
- El exportador usa **binario**. Puedes cambiar a ASCII modificando `STLExporter().parse(mesh, { binary:false })`.

## Créditos
- [Three.js](https://threejs.org) — Licencia MIT.
