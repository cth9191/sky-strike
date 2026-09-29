import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Loads the Higgsfield-generated GLBs and normalizes them so every aircraft
// faces -Z (nose forward), is centered, and has a known length in meters.
export async function loadModels() {
  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej));
  let player, enemy;
  try {
    player = prepare(await load('/models/player.glb'), 20, 'paper');
  } catch (e) {
    console.warn('player.glb missing, using procedural paper plane', e);
    player = prepare(fallbackPaperPlane(), 20, 'paper');
  }
  try {
    enemy = prepare(await load('/models/enemy.glb'), 19, 'jet');
  } catch (e) {
    console.warn('enemy.glb missing, using procedural jet', e);
    enemy = prepare(fallbackJet(), 19, 'jet');
  }
  return { player, enemy };
}

function prepare(root, length, kind) {
  root.updateMatrixWorld(true);
  const pts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 5000));
    for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (kind === 'paper') {
        m.roughness = 0.9;
        m.metalness = 0;
        m.envMapIntensity = 0.7;
        if (m.color) m.color.multiplyScalar(0.88);
        m.side = THREE.DoubleSide;
      } else {
        m.envMapIntensity = 1.3;
        if (m.roughness !== undefined) m.roughness = Math.min(m.roughness, 0.55);
      }
    }
  });
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const alongX = size.x > size.z;
  const axis = alongX ? 'x' : 'z', other = alongX ? 'z' : 'x';
  const L = alongX ? size.x : size.z;
  const lo = box.min[axis];
  const wLo = [Infinity, -Infinity], wHi = [Infinity, -Infinity];
  for (const p of pts) {
    const t = (p[axis] - lo) / L;
    if (t < 0.14) { wLo[0] = Math.min(wLo[0], p[other]); wLo[1] = Math.max(wLo[1], p[other]); }
    else if (t > 0.86) { wHi[0] = Math.min(wHi[0], p[other]); wHi[1] = Math.max(wHi[1], p[other]); }
  }
  const noseAtMax = wHi[1] - wHi[0] < wLo[1] - wLo[0];
  let yaw;
  if (alongX) yaw = noseAtMax ? Math.PI / 2 : -Math.PI / 2;
  else yaw = noseAtMax ? Math.PI : 0;

  root.position.sub(center);
  const inner = new THREE.Group();
  inner.add(root);
  inner.rotation.y = yaw;
  const s = length / L;
  inner.scale.setScalar(s);
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  const info = { length, span: (alongX ? size.z : size.x) * s, height: size.y * s, kind };
  return { template: wrapper, info };
}

function fallbackPaperPlane() {
  const v = [
    0, 0, -8,   -1.2, 0.3, 6,   0, -0.6, 6,
    0, 0, -8,   0, -0.6, 6,     1.2, 0.3, 6,
    0, 0, -8,   -4.5, 0.1, 6,   -1.2, 0.3, 6,
    0, 0, -8,   1.2, 0.3, 6,    4.5, 0.1, 6,
    -1.0, 0.3, 3, -1.2, 0.3, 6, -1.0, 2.6, 6.5,
    1.0, 0.3, 3,  1.0, 2.6, 6.5, 1.2, 0.3, 6,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.8, side: THREE.DoubleSide, flatShading: true }));
  const grp = new THREE.Group();
  grp.add(m);
  return grp;
}

function fallbackJet() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.45, metalness: 0.5 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 16, 10).rotateX(Math.PI / 2), mat);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 10).rotateX(-Math.PI / 2), mat);
  nose.position.z = -10;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 5), mat);
  wing.position.z = 2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 2.5), mat);
  tail.position.z = 7;
  const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.5, 2.5), mat);
  fin1.position.set(-1.2, 1.8, 6.5);
  const fin2 = fin1.clone();
  fin2.position.x = 1.2;
  g.add(body, nose, wing, tail, fin1, fin2);
  return g;
}
