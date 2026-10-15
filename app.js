import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { triangleCount, binarySTLSize } from "./mesh-utils.js";

const $ = (id) => document.getElementById(id);
const viewer = $("viewer");
const number = (n) => n.toLocaleString("es-MX");
const mm = (n) => n.toLocaleString("es-MX", { maximumFractionDigits: 3 });
const bytes = (n) =>
  n < 1024 * 1024
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1024 / 1024).toFixed(2)} MB`;
let original = null,
  optimized = null,
  mesh = null,
  file = null;
let activeJob = null,
  pendingFrame = 0,
  contextLost = false;

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
} catch {
  status(
    "No se pudo iniciar WebGL. Activa la aceleración gráfica del navegador y recarga.",
    true,
  );
  throw new Error("WebGL no disponible");
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio, Number($("quality").value)));
viewer.appendChild(renderer.domElement);
renderer.domElement.setAttribute("aria-label", "Modelo 3D interactivo");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c131f);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(180, 140, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
const hemi = new THREE.HemisphereLight(0xdcefff, 0x263548, 1.5);
const key = new THREE.DirectionalLight(0xffffff, 2.6);
const rim = new THREE.DirectionalLight(0x87c9ff, 1.3);
key.position.set(1, 2, 3);
rim.position.set(-2, 0.6, -1);
scene.add(hemi, key, rim, key.target);
const grid = new THREE.GridHelper(1000, 40, 0x384d65, 0x203044);
grid.material.opacity = 0.3;
grid.material.transparent = true;
const axes = new THREE.AxesHelper(80);
scene.add(grid, axes);
const material = new THREE.MeshStandardMaterial({
  color: $("modelColor").value,
  metalness: 0.12,
  roughness: 0.55,
  flatShading: true,
  side: THREE.DoubleSide,
});

// OrbitControls emits change during damping. Only request the next frame while
// something changes: no permanent animation loop while the viewer is idle.
function invalidate() {
  if (!pendingFrame && !document.hidden && !contextLost)
    pendingFrame = requestAnimationFrame(render);
}
function render() {
  pendingFrame = 0;
  controls.update();
  if ($("chkHeadlight").checked) {
    key.position.copy(camera.position);
    key.target.position.copy(controls.target);
  }
  renderer.render(scene, camera);
}
controls.addEventListener("change", invalidate);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  } else invalidate();
});
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  contextLost = true;
  cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  status(
    "La GPU perdió el contexto. Espera a que se restablezca o recarga el visor.",
    true,
  );
});
renderer.domElement.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  status("Visualización restablecida.");
  invalidate();
});
new ResizeObserver(() => {
  const width = viewer.clientWidth,
    height = viewer.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  invalidate();
}).observe(viewer);

function geometryFrom(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  if (data.indices)
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  // Flat-shaded surfaces derive normals in the fragment shader. No redundant
  // per-vertex normal/color buffers are kept for monochrome STL visualization.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
const tris = (geometry) =>
  triangleCount(geometry.attributes.position.array, geometry.index?.array);
function worldBox() {
  mesh.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(mesh, true);
}
function updateUI() {
  const hasModel = Boolean(mesh),
    busy = Boolean(activeJob);
  document.querySelectorAll("[data-model]").forEach((button) => {
    button.disabled = !hasModel || busy;
  });
  $("optimizationControls").disabled = !hasModel || busy || tris(original) <= 4;
  $("transformControls").disabled = !hasModel || busy;
  $("comparison").hidden = !optimized;
  for (const id of ["btnOriginal", "btnOptimized", "btnRestore"])
    $(id).disabled = busy;
  $("busy").hidden = !busy;
  $("emptyState").hidden = hasModel;
  if (!hasModel) return;
  const count = tris(mesh.geometry),
    box = worldBox();
  const size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  $("fTris").textContent = number(count);
  $("fEstimate").textContent = bytes(binarySTLSize(count));
  $("fName").textContent = file.name;
  $("fSize").textContent = `Archivo de entrada: ${bytes(file.size)}`;
  $("fDims").textContent = [size.x, size.y, size.z].map(mm).join(" × ");
  $("fCenter").textContent = [center.x, center.y, center.z].map(mm).join(" , ");
  const isOriginal = mesh.geometry === original;
  $("meshBadge").textContent =
    `${isOriginal ? "ORIGINAL" : "OPTIMIZADO"} · ${number(count)} TRIÁNGULOS`;
  $("btnSave").textContent =
    `Descargar ${isOriginal ? "original" : "optimizado"} ↓`;
  $("btnOriginal").classList.toggle("active", isOriginal);
  $("btnOptimized").classList.toggle("active", !isOriginal);
  $("btnOriginal").setAttribute("aria-pressed", String(isOriginal));
  $("btnOptimized").setAttribute("aria-pressed", String(!isOriginal));
  if (optimized) {
    const reduction = 100 * (1 - tris(optimized) / tris(original));
    $("reductionActual").textContent =
      `${reduction.toFixed(1)}% menos triángulos`;
    $("reductionDetail").textContent =
      `${number(tris(original))} → ${number(tris(optimized))} · STL binario: ${bytes(binarySTLSize(tris(original)))} → ${bytes(binarySTLSize(tris(optimized)))}`;
    $("reductionBar").style.width = `${reduction}%`;
  }
}

function updateTarget() {
  if (!original) return;
  const count = tris(original);
  $("targetTriangles").max = Math.max(4, count - 1);
  $("targetTriangles").value = Math.max(
    4,
    Math.round(count * (1 - Number($("reduction").value) / 100)),
  );
  $("reductionValue").textContent = `${$("reduction").value}%`;
}
$("reduction").addEventListener("input", updateTarget);
$("targetTriangles").addEventListener("input", () => {
  if (!original || !$("targetTriangles").checkValidity()) return;
  const percentage =
    100 * (1 - Number($("targetTriangles").value) / tris(original));
  $("reduction").value = percentage;
  $("reductionValue").textContent = `${percentage.toFixed(1)}%`;
});

function fit(view = "iso") {
  if (!mesh) return;
  const box = worldBox(),
    sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1e-6);
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.15;
  const directions = {
    iso: [1, 0.7, 1],
    front: [0, 0, 1],
    top: [0, 1, 0],
    right: [1, 0, 0],
  };
  // Drain outstanding damping before setting an exact view.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  camera.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);
  camera.position
    .copy(sphere.center)
    .add(
      new THREE.Vector3(...directions[view])
        .normalize()
        .multiplyScalar(distance),
    );
  camera.near = radius / 10000;
  camera.far = distance + radius * 200;
  controls.minDistance = radius / 1000;
  controls.maxDistance = radius * 100;
  controls.target.copy(sphere.center);
  camera.updateProjectionMatrix();
  controls.update();
  invalidate();
  $("viewLabel").textContent =
    `${{ iso: "3D", front: "FRENTE", top: "SUPERIOR", right: "DERECHA" }[view]} · PERSPECTIVA`;
}
function placeHelpers() {
  const box = worldBox(),
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1e-6);
  grid.scale.setScalar((span * 2) / 1000);
  grid.position.set(center.x, box.min.y - span * 0.01, center.z);
  axes.scale.setScalar(span / 320);
  axes.position.copy(grid.position);
}

function cancelJob(announce = true) {
  if (!activeJob) return;
  const job = activeJob;
  activeJob = null;
  job.worker.terminate();
  job.reject(new DOMException("Operación cancelada", "AbortError"));
  updateUI();
  if (announce)
    status("Operación cancelada. Se conserva el último modelo válido.");
}
function runJob(data, transfer = []) {
  cancelJob(false);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mesh-worker.js", import.meta.url));
    const job = { worker, reject };
    activeJob = job;
    updateUI();
    const finish = (result, error) => {
      if (activeJob !== job) return;
      activeJob = null;
      worker.terminate();
      updateUI();
      if (error) reject(error);
      else resolve(result);
    };
    worker.onmessage = ({ data }) => {
      if (activeJob !== job) return;
      if (data.stage) status(data.stage);
      else if (data.error) finish(null, new Error(data.error));
      else finish(data);
    };
    worker.onerror = () =>
      finish(
        null,
        new Error(
          "El procesamiento falló. Comprueba la memoria disponible y que se hayan subido todos los archivos del visor.",
        ),
      );
    worker.onmessageerror = () =>
      finish(null, new Error("No se pudo transferir el resultado."));
    try {
      worker.postMessage(data, transfer);
    } catch (error) {
      finish(null, error);
    }
  });
}
$("btnCancel").addEventListener("click", () => cancelJob());
function showError(error) {
  if (error.name !== "AbortError") status(error.message, true);
}

async function loadFile(nextFile, demo = false) {
  if (!demo && !/\.stl$/i.test(nextFile?.name || "")) {
    status("Selecciona un archivo con extensión .stl.", true);
    return;
  }
  status(
    demo ? "Preparando modelo de ejemplo…" : "Cargando STL en segundo plano…",
  );
  try {
    const result = await runJob({
      type: demo ? "demo" : "load",
      file: nextFile,
      center: $("chkCenterLoad").checked,
    });
    const geometry = geometryFrom(result);
    // Only replace a valid model after the next one has loaded successfully.
    if (mesh) scene.remove(mesh);
    original?.dispose();
    optimized?.dispose();
    optimized = null;
    original = geometry;
    file = demo
      ? { name: "ejemplo_nudo.stl", size: binarySTLSize(tris(geometry)) }
      : nextFile;
    mesh = new THREE.Mesh(original, material);
    scene.add(mesh);
    updateTarget();
    placeHelpers();
    updateUI();
    fit();
    status(
      `Modelo cargado: ${number(tris(original))} triángulos. ${tris(original) <= 4 ? "Esta malla ya es demasiado pequeña para reducirla." : "Puedes inspeccionarlo u optimizarlo."}`,
    );
  } catch (error) {
    showError(error);
  }
}
for (const id of ["btnOpen", "btnEmptyOpen"])
  $(id).addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) loadFile(file);
});
$("btnDemo").addEventListener("click", () => loadFile(null, true));
for (const zone of [viewer, $("drop")]) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
    const files = event.dataTransfer?.files;
    if (files?.length !== 1)
      status("Arrastra un solo archivo STL a la vez.", true);
    else loadFile(files[0]);
  });
}
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

$("btnSimplify").addEventListener("click", async () => {
  if (!original || activeJob) return;
  const input = $("targetTriangles");
  if (!input.reportValidity()) return;
  try {
    // Always simplify the original; repeated previews don't accumulate errors.
    const positions = original.attributes.position.array.slice();
    status("Preparando optimización…");
    const result = await runJob(
      { type: "simplify", positions, target: Number(input.value) },
      [positions.buffer],
    );
    const geometry = geometryFrom(result);
    if (optimized) optimized.dispose();
    optimized = geometry;
    mesh.geometry = optimized;
    updateUI();
    invalidate();
    const reached = tris(optimized) <= Number(input.value);
    status(
      `Optimización lista en ${(result.elapsed / 1000).toFixed(2)} s. ${reached ? "Compara ambas versiones." : "Se alcanzó el límite de reducción de esta malla antes del objetivo."}${result.removedDegenerate ? ` Se omitieron ${number(result.removedDegenerate)} caras degeneradas.` : ""}`,
    );
  } catch (error) {
    showError(error);
  }
});
function showGeometry(geometry) {
  if (!mesh || !geometry || activeJob) return;
  mesh.geometry = geometry;
  updateUI();
  invalidate();
}
$("btnOriginal").addEventListener("click", () => showGeometry(original));
$("btnOptimized").addEventListener("click", () => showGeometry(optimized));
$("btnRestore").addEventListener("click", () => {
  showGeometry(original);
  optimized?.dispose();
  optimized = null;
  updateUI();
  status("Geometría original restaurada. Se conservan tus transformaciones.");
});

function transformed() {
  placeHelpers();
  updateUI();
  invalidate();
}
function stepValue(id) {
  const input = $(id);
  return input.reportValidity() && Number.isFinite(input.valueAsNumber)
    ? input.valueAsNumber
    : null;
}
for (const button of document.querySelectorAll("[data-rotate]"))
  button.addEventListener("click", () => {
    const step = stepValue("degStep");
    if (!mesh || step === null) return;
    const [axis, sign] = button.dataset.rotate.split(",");
    mesh.rotation[axis] += THREE.MathUtils.degToRad(step * Number(sign));
    transformed();
  });
function followTranslation(delta) {
  controls.target.add(delta);
  camera.position.add(delta);
  controls.update();
}
for (const button of document.querySelectorAll("[data-move]"))
  button.addEventListener("click", () => {
    const step = stepValue("mmStep");
    if (!mesh || step === null) return;
    const [axis, sign] = button.dataset.move.split(",");
    const delta = new THREE.Vector3();
    delta[axis] = step * Number(sign);
    mesh.position.add(delta);
    followTranslation(delta);
    transformed();
  });
$("btnResetRot").addEventListener("click", () => {
  if (mesh) {
    mesh.rotation.set(0, 0, 0);
    transformed();
  }
});
$("btnResetPos").addEventListener("click", () => {
  if (!mesh) return;
  const delta = mesh.position.clone().negate();
  mesh.position.set(0, 0, 0);
  followTranslation(delta);
  transformed();
});
$("btnFit").addEventListener("click", () => fit());
for (const button of document.querySelectorAll("[data-view]"))
  button.addEventListener("click", () => fit(button.dataset.view));
window.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() === "f" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)
  )
    fit();
});
$("chkHeadlight").addEventListener("change", () => {
  if (!$("chkHeadlight").checked) {
    key.position.set(1, 2, 3);
    key.target.position.set(0, 0, 0);
  }
  invalidate();
});
$("chkGrid").addEventListener("change", () => {
  grid.visible = axes.visible = $("chkGrid").checked;
  invalidate();
});
$("chkWireframe").addEventListener("change", () => {
  material.wireframe = $("chkWireframe").checked;
  invalidate();
});
$("modelColor").addEventListener("input", () => {
  material.color.set($("modelColor").value);
  invalidate();
});
$("quality").addEventListener("change", () => {
  renderer.setPixelRatio(
    Math.min(devicePixelRatio, Number($("quality").value)),
  );
  invalidate();
});
$("btnFullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await viewer.requestFullscreen();
  } catch {
    status("El navegador no permite pantalla completa en este contexto.", true);
  }
});
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const baseName = () => file.name.replace(/\.stl$/i, "");
$("btnSave").addEventListener("click", async () => {
  if (!mesh || activeJob) return;
  try {
    mesh.updateMatrixWorld(true);
    const positions = mesh.geometry.attributes.position.array.slice(),
      indices = mesh.geometry.index?.array.slice() ?? null;
    const suffix = mesh.geometry === optimized ? "_optimizado" : "_editado";
    const format = $("exportFormat").value;
    const filename = baseName() + suffix + "." + format;
    const result = await runJob(
      {
        type: "export",
        format,
        positions,
        indices,
        matrix: mesh.matrixWorld.elements.slice(),
      },
      [positions.buffer, ...(indices ? [indices.buffer] : [])],
    );
    const blob =
      result.blob ?? new Blob([result.buffer], { type: "model/stl" });
    download(blob, filename);
    status(`Descarga lista: ${filename} · ${bytes(blob.size)}.`);
  } catch (error) {
    showError(error);
  }
});
$("btnCapture").addEventListener("click", () => {
  if (!mesh || contextLost) return;
  render();
  renderer.domElement.toBlob((blob) => {
    if (blob) download(blob, baseName() + "_vista.png");
  }, "image/png");
});
window.addEventListener("beforeunload", () => {
  activeJob?.worker.terminate();
  original?.dispose();
  optimized?.dispose();
  material.dispose();
  grid.geometry.dispose();
  grid.material.dispose();
  axes.dispose();
  controls.dispose();
  renderer.dispose();
});
updateUI();
invalidate();
