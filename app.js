import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// Debug global
window.addEventListener('error', (e)=>{
  console.error('[GLOBAL ERROR]', e.message, e.filename, e.lineno, e.colno);
});

// ---------- UI ----------
const fileInput = document.getElementById('file');
const drop = document.getElementById('drop');
const fName = document.getElementById('fName');
const fSize = document.getElementById('fSize');
const fTris = document.getElementById('fTris');
const fDims = document.getElementById('fDims');
const fCenter = document.getElementById('fCenter');
const chkCenterLoad = document.getElementById('chkCenterLoad');

// ---------- Three.js ----------
const container = document.getElementById('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f1a);

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 10000);
camera.position.set(180, 140, 200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1;
controls.maxDistance = 5000;

// Luces
const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.55); scene.add(hemi);
const dir1 = new THREE.DirectionalLight(0xffffff, 0.85); dir1.position.set(1,1,1); scene.add(dir1);
const dir2 = new THREE.DirectionalLight(0xffffff, 0.40); dir2.position.set(-1,0.5,-0.5); scene.add(dir2);

// Headlight (ligada a la cámara)
const headlight = new THREE.DirectionalLight(0xffffff, 1.0);
headlight.visible = false;
scene.add(headlight);
scene.add(headlight.target);

// Helpers
const grid = new THREE.GridHelper(1000, 50, 0x334155, 0x233042);
grid.material.opacity = 0.35; grid.material.transparent = true;
scene.add(grid);
const axes = new THREE.AxesHelper(80); axes.position.y = 0.01; scene.add(axes);

let currentMesh = null;

function clearModel() {
  if (currentMesh) {
    currentMesh.geometry.dispose();
    if (Array.isArray(currentMesh.material)) currentMesh.material.forEach(m=>m.dispose()); else currentMesh.material.dispose();
    scene.remove(currentMesh);
    currentMesh = null;
  }
}

const fmt = n => Number.parseFloat(n).toFixed(3);
const formatMB = b => (b/(1024*1024)).toFixed(2)+' MB';

function fitCameraToObject(object, offset = 1.35) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  cameraZ *= offset;

  camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.5, center.z + cameraZ);
  camera.near = Math.max(0.1, cameraZ / 1000);
  camera.far = cameraZ * 10000;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function centerGeometry(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  return { box, center };
}

function updateStats(geometry, file){
  let triangles = geometry.index ? geometry.index.count/3 : geometry.attributes.position.count/3;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());

  fName.textContent = file ? file.name : '—';
  fSize.textContent = file ? `${formatMB(file.size)} (${file.size.toLocaleString('es-MX')} bytes)` : '—';
  fTris.textContent = triangles.toLocaleString('es-MX');
  fDims.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)}`;
  fCenter.textContent = `${fmt(center.x)} , ${fmt(center.y)} , ${fmt(center.z)}`;

  console.log('[STATS]', { triangles, size_mm: size, center_mm: center });
}

async function loadSTLFromFile(file){
  if (!file) return;
  clearModel();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loader = new STLLoader();
    const geometry = loader.parse(arrayBuffer);

    // Centrar solo si está habilitado
    if (chkCenterLoad.checked) centerGeometry(geometry);

    const material = new THREE.MeshStandardMaterial({ color: 0x9bdcff, metalness: 0.1, roughness: 0.7, flatShading: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    currentMesh = mesh;

    updateStats(geometry, file);
    fitCameraToObject(mesh, 1.6);
    console.log('[LOAD OK]', file.name);
  } catch (err) {
    console.error('[LOAD ERROR]', err);
    drop.textContent = 'Error al cargar el STL: ' + (err?.message || err);
  }
}

// Resize
function onResize(){
  const w = container.clientWidth; const h = container.clientHeight || (window.innerHeight * 0.65);
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// Render loop
function animate(){
  requestAnimationFrame(animate);
  if (headlight.visible) {
    headlight.position.copy(camera.position);
    headlight.target.position.copy(controls.target);
    headlight.target.updateMatrixWorld();
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Headlight toggle
const chkHeadlight = document.getElementById('chkHeadlight');
chkHeadlight.addEventListener('change', ()=>{
  const on = chkHeadlight.checked;
  headlight.visible = on;
  dir1.visible = !on; dir2.visible = !on; hemi.intensity = on ? 0.2 : 0.55;
  console.log('[HEADLIGHT]', on ? 'ON' : 'OFF');
});

// Rotación
function rotateModel(axis, degrees){
  if (!currentMesh) return;
  const rad = THREE.MathUtils.degToRad(degrees);
  currentMesh.rotation[axis] += rad;
}
function resetRotation(){ if (!currentMesh) return; currentMesh.rotation.set(0,0,0); }

const degStep = () => Number(document.getElementById('degStep').value) || 15;
document.getElementById('rotXm').addEventListener('click', ()=> rotateModel('x', -degStep()));
document.getElementById('rotXp').addEventListener('click', ()=> rotateModel('x',  degStep()));
document.getElementById('rotYm').addEventListener('click', ()=> rotateModel('y', -degStep()));
document.getElementById('rotYp').addEventListener('click', ()=> rotateModel('y',  degStep()));
document.getElementById('rotZm').addEventListener('click', ()=> rotateModel('z', -degStep()));
document.getElementById('rotZp').addEventListener('click', ()=> rotateModel('z',  degStep()));
document.getElementById('btnResetRot').addEventListener('click', resetRotation);

// Traslación
function translateModel(axis, mm){
  if (!currentMesh) return;
  currentMesh.position[axis] += mm;
  controls.target[axis] += mm; // mantener órbita centrada
}
function resetPosition(){ if (!currentMesh) return; currentMesh.position.set(0,0,0); }

const mmStep = () => Number(document.getElementById('mmStep').value) || 10;
document.getElementById('movXm').addEventListener('click', ()=> translateModel('x', -mmStep()));
document.getElementById('movXp').addEventListener('click', ()=> translateModel('x',  mmStep()));
document.getElementById('movYm').addEventListener('click', ()=> translateModel('y', -mmStep()));
document.getElementById('movYp').addEventListener('click', ()=> translateModel('y',  mmStep()));
document.getElementById('movZm').addEventListener('click', ()=> translateModel('z', -mmStep()));
document.getElementById('movZp').addEventListener('click', ()=> translateModel('z',  mmStep()));
document.getElementById('btnResetPos').addEventListener('click', resetPosition);

// Guardar STL horneando pos/rot/escala
document.getElementById('btnSave').addEventListener('click', ()=>{
  if (!currentMesh) return;
  try{
    currentMesh.updateMatrixWorld(true);
    const baked = currentMesh.geometry.clone();
    baked.applyMatrix4(currentMesh.matrixWorld);

    const tmpMesh = new THREE.Mesh(baked);
    const exporter = new STLExporter();
    const binary = exporter.parse(tmpMesh, { binary: true });

    const blob = new Blob([binary], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (document.getElementById('fName').textContent || 'modelo').replace(/\.stl$/i,'');
    a.download = base + '_editado.stl';
    a.href = url; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 1000);

    baked.dispose();
    tmpMesh.geometry.dispose();

    console.log('[SAVE] STL exportado con transformaciones aplicadas');
  }catch(err){
    console.error('[SAVE ERROR]', err);
    alert('No se pudo exportar el STL: ' + (err?.message || err));
  }
});

// File input
fileInput.addEventListener('change', (e)=>{
  const file = e.target.files?.[0];
  console.log('[FILE INPUT]', file?.name, file?.size);
  if (file) loadSTLFromFile(file);
});

// Drag & drop
['dragenter','dragover'].forEach(evt=>{
  drop.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover'); });
});
['dragleave','drop'].forEach(evt=>{
  drop.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover'); });
});
drop.addEventListener('drop', (e)=>{
  const file = e.dataTransfer?.files?.[0];
  console.log('[DROP]', file?.name, file?.size);
  if (file) loadSTLFromFile(file);
});

// Drop también sobre el viewer
['dragenter','dragover','dragleave','drop'].forEach(evt=>{
  container.addEventListener(evt, (e)=>{ e.preventDefault(); });
});
container.addEventListener('drop', (e)=>{
  const file = e.dataTransfer?.files?.[0];
  console.log('[DROP VIEWER]', file?.name, file?.size);
  if (file) loadSTLFromFile(file);
});

console.log('[BOOT] Visor STL iniciado');
