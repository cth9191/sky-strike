import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep, fbm, hash2, mulberry32 } from './util.js';

// ---------------------------------------------------------------------------
// World layout (meters). Sea to the west, mountains far north/east, the city in
// the middle split by a river, and an airbase to the south.
// ---------------------------------------------------------------------------
export const SUN_DIR = new THREE.Vector3(-0.9, 0.12, 0.42).normalize();
export const FOG_COLOR = new THREE.Color(0xc2a896);
export const FOG_DENSITY = 0.000034;
export const CITY_R = 5200;
export const AIRBASE = { x: 2400, z: 6700, len: 3200, w: 60 };

const CELL = 170, STREET = 30, BLOCK = CELL - STREET;
const EXT = 6400; // half-size of the city ground texture
const HWY_X = 1190, HWY_Z = -2720, RING = 3950;
const DOWNTOWNS = [
  [-250, -1150, 1350, 1.0],
  [2350, 1500, 850, 0.62],
];

export function riverZ(x) {
  return 700 * Math.sin(x * 0.00042 + 0.6) + 260 * Math.sin(x * 0.0011 + 2.0) - 400;
}

export function forestMask(x, z) {
  return fbm(x * 0.0006 + 9.0, z * 0.0006 - 4.0, 3);
}

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 45 + fbm(x * 0.00021 + 3.1, z * 0.00021 - 7.7, 4) * 110;
  const coast = -7400 + fbm(z * 0.00028, 11.3, 3) * 1100;
  const land = smoothstep(coast - 1600, coast + 200, x);
  const m = smoothstep(8500, 17000, r) * smoothstep(coast + 2500, coast + 6000, x);
  const ridge = 1 - Math.abs(fbm(x * 0.00011 + 40, z * 0.00011 + 17, 5));
  h += m * (Math.pow(ridge, 2.4) * 2800 + 120 * fbm(x * 0.0011, z * 0.0011, 3));
  const flatCity = 1 - smoothstep(CITY_R + 300, CITY_R + 2800, r);
  const bx = (x - AIRBASE.x) / 950, bz = (z - AIRBASE.z) / 2200;
  const flatBase = 1 - smoothstep(1.0, 1.7, Math.hypot(bx, bz));
  h = lerp(h, 2.0, Math.max(flatCity, flatBase));
  h = lerp(-80, h, land);
  // river
  const rd = Math.abs(z - riverZ(x));
  const carve = smoothstep(11000, 8500, x);
  const bank = smoothstep(115, 235, rd);
  h = lerp(h, Math.min(h, lerp(-8, h, bank)), carve);
  return h;
}

const GRID = new Map();
export function buildingTop(x, z) {
  const list = GRID.get(Math.round(x / CELL) + ',' + Math.round(z / CELL));
  if (!list) return 0;
  let top = 0;
  for (const b of list) if (x > b[0] && x < b[1] && z > b[2] && z < b[3] && b[4] > top) top = b[4];
  return top;
}
export function surfaceHeight(x, z) {
  return Math.max(groundHeight(x, z), 0, buildingTop(x, z));
}

export function onRunway(x, z) {
  return Math.abs(x - AIRBASE.x) < AIRBASE.w / 2 + 10 && Math.abs(z - AIRBASE.z) < AIRBASE.len / 2 + 40;
}

function downtownFactor(x, z) {
  let t = 0;
  for (const [cx, cz, r, w] of DOWNTOWNS) t = Math.max(t, w * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r)));
  return t;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function glowTexture(size = 256, inner = 'rgba(255,255,255,1)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.2, 'rgba(255,240,220,0.7)');
  g.addColorStop(0.5, 'rgba(255,200,150,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function ringTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.7, 'rgba(255,220,180,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function waterNormalTexture() {
  const S = 512;
  const hgt = new Float32Array(S * S);
  const waves = [];
  const rng = mulberry32(77);
  for (let i = 0; i < 16; i++) {
    const kx = Math.round((rng() - 0.5) * 2 * (3 + i * 2.2));
    const ky = Math.round((rng() - 0.5) * 2 * (3 + i * 2.2)) || 1;
    waves.push([kx, ky, 1 / (1 + i * 0.6), rng() * Math.PI * 2]);
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let h = 0;
      for (const [kx, ky, a, p] of waves) h += a * Math.sin((2 * Math.PI * (kx * x + ky * y)) / S + p);
      hgt[y * S + x] = h;
    }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const l = hgt[y * S + ((x - 1 + S) % S)], r = hgt[y * S + ((x + 1) % S)];
      const d = hgt[((y - 1 + S) % S) * S + x], u = hgt[((y + 1) % S) * S + x];
      let nx = (l - r) * 0.9, ny = (d - u) * 0.9, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function cloudTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const rng = mulberry32(5);
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * S * 0.27;
    const px = S / 2 + Math.cos(a) * rr, py = S / 2 + Math.sin(a) * rr * 0.8;
    const s = S * (0.08 + rng() * 0.17);
    const g = x.createRadialGradient(px, py, 0, px, py, s);
    const al = 0.16 + rng() * 0.2;
    g.addColorStop(0, `rgba(255,255,255,${al})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

// ---------------------------------------------------------------------------
export class World {
  constructor(renderer, scene) {
    this.r = renderer;
    this.scene = scene;
    this.time = 0;
    this.aaSites = [];
    this.uTime = { value: 0 };
    this.cloudSortT = 0;
  }

  async build(progress = () => {}) {
    progress('SKY & LIGHT');
    this.buildSky();
    await tick();
    progress('TERRAIN');
    this.buildTerrain();
    this.buildWater();
    await tick();
    progress('CITY');
    this.buildCity();
    await tick();
    progress('FORESTS');
    this.buildTrees();
    await tick();
    progress('AIRBASE');
    this.buildAirbase();
    this.buildClouds();
    this.buildTraffic();
  }

  // -------------------------------------------------------------------------
  buildSky() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    const setupSky = (sky) => {
      const u = sky.material.uniforms;
      u.turbidity.value = 6.0;
      u.rayleigh.value = 2.3;
      u.mieCoefficient.value = 0.0055;
      u.mieDirectionalG.value = 0.86;
      u.sunPosition.value.copy(SUN_DIR);
    };
    const sky = new Sky();
    sky.scale.setScalar(60000);
    setupSky(sky);
    sky.frustumCulled = false;
    sky.material.fragmentShader = sky.material.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      'float lumS = dot(texColor, vec3(0.2126, 0.7152, 0.0722)); texColor *= min(1.0, 1.45 / max(lumS, 1e-4)); gl_FragColor = vec4( texColor, 1.0 );'
    );
    scene.add(sky);
    this.sky = sky;
    const sunMat = new THREE.SpriteMaterial({ map: glowTexture(256), color: new THREE.Color(38, 27, 17), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.setScalar(3200);
    this.sunSprite.frustumCulled = false;
    scene.add(this.sunSprite);

    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    setupSky(sky2);
    envScene.add(sky2);
    const pm = new THREE.PMREMGenerator(this.r);
    this.envRT = pm.fromScene(envScene, 0.02, 0.1, 5000);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.7;
    pm.dispose();

    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.78, 0.58), 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -1700; sc.right = 1700; sc.top = 1700; sc.bottom = -1700;
    sc.near = 10; sc.far = 16000;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 2.5;
    scene.add(sun, sun.target);
    this.sun = sun;
    scene.add(new THREE.HemisphereLight(0x9fb4d6, 0x4d3f33, 0.35));

  }

  // -------------------------------------------------------------------------
  buildTerrain() {
    const C = {
      seabed: new THREE.Color(0x384a4a), sand: new THREE.Color(0xb7a37c),
      grass1: new THREE.Color(0x5b6a33), grass2: new THREE.Color(0x7c7542),
      forest: new THREE.Color(0x2b3d20), rock: new THREE.Color(0x6c635a),
      rock2: new THREE.Color(0x8c8178), snow: new THREE.Color(0xf1f3f8),
      city: new THREE.Color(0x6b6863), wheat: new THREE.Color(0xa99550),
      plowed: new THREE.Color(0x6b5843), crop: new THREE.Color(0x4f6c2c),
    };
    const fields = [C.wheat, C.plowed, C.crop, C.grass2, C.crop, C.wheat];
    const col = new THREE.Color();
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
    this.terrainMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPt;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPt = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPt;
          float th(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
          float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float dn = tn(vWPt.xz*0.045)*0.55 + tn(vWPt.xz*0.19)*0.3 + tn(vWPt.xz*0.8)*0.15;
          diffuseColor.rgb *= 0.78 + 0.42*dn;`);
    };
    const INNER = 8000;
    const make = (size, seg, hideInner) => {
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        let h = groundHeight(x, z);
        if (hideInner && Math.abs(x) < INNER - 1 && Math.abs(z) < INNER - 1) h -= 60;
        p.setY(i, h);
      }
      g.computeVertexNormals();
      const n = g.attributes.normal;
      const cols = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), h = groundHeight(x, z);
        const slope = 1 - n.getY(i);
        const r = Math.hypot(x, z);
        const n1 = fbm(x * 0.002, z * 0.002, 2) * 0.5 + 0.5;
        if (h < -3) col.copy(C.seabed).lerp(C.sand, smoothstep(-25, -3, h));
        else if (h < 1.6 && r > CITY_R + 200) col.copy(C.sand);
        else if (r < CITY_R + 350) col.copy(C.city).lerp(C.grass1, smoothstep(CITY_R - 200, CITY_R + 350, r));
        else {
          col.copy(C.grass1).lerp(C.grass2, n1);
          const farmZone = smoothstep(CITY_R + 300, CITY_R + 1200, r) * (1 - smoothstep(10000, 13000, r));
          if (farmZone > 0.3 && h < 260) {
            const fx = Math.floor((x + 0.37 * z) / 420), fz = Math.floor((z - 0.21 * x) / 330);
            const f = fields[Math.floor(hash2(fx, fz) * fields.length)];
            col.lerp(f, 0.85 * farmZone);
          }
          if (forestMask(x, z) > 0.12 && h < 1150) col.lerp(C.forest, 0.85);
          const rockAmt = Math.max(smoothstep(0.28, 0.5, slope), smoothstep(950, 1300, h));
          col.lerp(n1 > 0.5 ? C.rock : C.rock2, rockAmt);
          const snowLine = 1750 + fbm(x * 0.001, z * 0.001, 2) * 260;
          if (h > snowLine && slope < 0.62) col.lerp(C.snow, smoothstep(snowLine, snowLine + 180, h));
        }
        cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const mesh = new THREE.Mesh(g, this.terrainMat);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    make(16000, 440, false);
    make(64000, 256, true);
  }

  buildWater() {
    const tex = waterNormalTexture();
    tex.repeat.set(1100, 1100);
    const g = new THREE.PlaneGeometry(130000, 130000);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x16323d, roughness: 0.07, metalness: 0.02, normalMap: tex,
      normalScale: new THREE.Vector2(0.42, 0.42), envMapIntensity: 1.25,
    });
    const w = new THREE.Mesh(g, mat);
    w.receiveShadow = true;
    this.scene.add(w);
    this.waterTex = tex;
  }

  // -------------------------------------------------------------------------
  buildCity() {
    const rng = mulberry32(20260928);
    const S = 4096, px = S / (2 * EXT);
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const MS = 2048, mpx = MS / (2 * EXT);
    const mc = document.createElement('canvas');
    mc.width = mc.height = MS;
    const mctx = mc.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, MS, MS);
    const X = (x) => (x + EXT) * px, Z = (z) => (z + EXT) * px;
    const MX = (x) => (x + EXT) * mpx, MZ = (z) => (z + EXT) * mpx;

    const concrete = [0xb8b0a4, 0xa39a8e, 0x8c8781, 0xc9bfae, 0x9a6f5a, 0x7d5a48, 0xd6d0c4, 0xa89f8a, 0x8f8a7d];
    const glassCols = [0x5d7383, 0x3f5566, 0x6b7f86, 0x4a5a58, 0x7a6a58, 0x55646f];
    const bld = [];
    const beacons = [];
    this.parks = [];
    const aaCandidates = [];
    const N = Math.floor(EXT / CELL);
    const tmp = new THREE.Color();

    for (let gx = -N; gx <= N; gx++) {
      for (let gz = -N; gz <= N; gz++) {
        const cx = gx * CELL, cz = gz * CELL;
        const r = Math.hypot(cx, cz);
        const edge = CITY_R * (0.86 + 0.28 * (fbm(cx * 0.00035 + 5, cz * 0.00035 - 2, 3) * 0.5 + 0.5));
        if (r > edge) continue;
        if (Math.abs(cz - riverZ(cx)) < 245) continue;
        const gh = groundHeight(cx, cz);
        if (gh < 1 || gh > 14) continue;
        if (Math.abs(cx - AIRBASE.x) < 950 && Math.abs(cz - AIRBASE.z) < 2100) continue;

        ctx.fillStyle = '#323438';
        ctx.fillRect(X(cx - CELL / 2), Z(cz - CELL / 2), CELL * px + 1, CELL * px + 1);
        mctx.fillStyle = '#fff';
        mctx.fillRect(MX(cx - CELL / 2), MZ(cz - CELL / 2), CELL * mpx + 1, CELL * mpx + 1);

        const isHwy = Math.abs(cx - HWY_X) < 10 || Math.abs(cz - HWY_Z) < 10 || Math.abs(r - RING) < 100;
        if (isHwy) continue;

        const tall = downtownFactor(cx, cz);
        const park = tall < 0.45 && rng() < (r > 2800 ? 0.1 : 0.05);
        ctx.fillStyle = '#7b766f';
        ctx.fillRect(X(cx - BLOCK / 2), Z(cz - BLOCK / 2), BLOCK * px, BLOCK * px);
        mctx.fillStyle = '#000';
        mctx.fillRect(MX(cx - BLOCK / 2), MZ(cz - BLOCK / 2), BLOCK * mpx, BLOCK * mpx);
        const inset = 5;
        if (park) {
          ctx.fillStyle = '#46632f';
        } else {
          const v = 120 + Math.floor(rng() * 40);
          ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
        }
        ctx.fillRect(X(cx - BLOCK / 2 + inset), Z(cz - BLOCK / 2 + inset), (BLOCK - inset * 2) * px, (BLOCK - inset * 2) * px);
        if (park) {
          this.parks.push([cx, cz]);
          continue;
        }

        const suburb = r > 3700 && tall < 0.2;
        const lotsN = tall > 0.5 ? (rng() < 0.55 ? 1 : 2) : suburb ? 3 : 2;
        const lot = BLOCK / lotsN;
        if (!suburb && tall < 0.5 && rng() < 0.05) aaCandidates.push([cx + BLOCK / 2 + STREET / 2, cz + BLOCK / 2 + STREET / 2]);
        for (let i = 0; i < lotsN; i++) {
          for (let j = 0; j < lotsN; j++) {
            if (tall > 0.5 && lotsN === 2 && rng() < 0.22) continue;
            const lx = cx - BLOCK / 2 + lot * (i + 0.5), lz = cz - BLOCK / 2 + lot * (j + 0.5);
            const fill = tall > 0.5 ? 0.62 + rng() * 0.26 : suburb ? 0.5 + rng() * 0.25 : 0.7 + rng() * 0.22;
            const w = lot * fill, d = Math.min(lot * 0.95, lot * fill * (0.8 + rng() * 0.3));
            let h;
            if (tall > 0.5) h = 70 + Math.pow(rng(), 1.5) * 430 * tall;
            else if (suburb) h = 6 + rng() * 9 + (rng() < 0.06 ? 22 : 0);
            else h = 14 + Math.pow(rng(), 2) * (38 + 190 * tall);
            const glass = rng() < 0.1 + 0.85 * tall ? 1 : 0;
            const c = glass ? glassCols[Math.floor(rng() * glassCols.length)] : concrete[Math.floor(rng() * concrete.length)];
            tmp.setHex(c);
            const col = [tmp.r, tmp.g, tmp.b];
            bld.push({ x: lx, z: lz, y: 0, w, d, h, glass, col, seed: rng() });
            let top = h;
            if (h > 110 && rng() < 0.6) {
              const s = 0.55 + rng() * 0.25;
              const h2 = h * (0.12 + rng() * 0.3);
              bld.push({ x: lx, z: lz, y: h, w: w * s, d: d * s, h: h2, glass, col, seed: rng() });
              top = h + h2;
              if (rng() < 0.45) {
                const h3 = h2 * 0.6;
                bld.push({ x: lx, z: lz, y: top, w: w * s * 0.6, d: d * s * 0.6, h: h3, glass, col, seed: rng() });
                top += h3;
              }
            }
            if (top > 230 && rng() < 0.55) {
              const sh = 30 + rng() * 60;
              tmp.setHex(0x9a9a9a);
              bld.push({ x: lx, z: lz, y: top, w: 2.6, d: 2.6, h: sh, glass: 0, col: [tmp.r, tmp.g, tmp.b], seed: rng(), plain: 1 });
              beacons.push(lx, top + sh + 3, lz);
            } else if (top > 70 && rng() < 0.35) {
              beacons.push(lx + w * 0.45, top + 3 + 3, lz + d * 0.45);
            }
            if (h < 140 && rng() < 0.55 && !suburb) {
              tmp.setHex(0x8d8a86);
              bld.push({ x: lx + (rng() - 0.5) * w * 0.4, z: lz + (rng() - 0.5) * d * 0.4, y: h, w: 5 + rng() * 9, d: 5 + rng() * 9, h: 2.5 + rng() * 3.5, glass: 0, col: [tmp.r, tmp.g, tmp.b], seed: rng(), plain: 1 });
            }
          }
        }
      }
    }

    // Highways (ring + cross) with lane markings
    const road = (drawFn, width) => {
      ctx.strokeStyle = '#2b2d31';
      ctx.lineWidth = width * px;
      ctx.setLineDash([]);
      ctx.beginPath(); drawFn(ctx, X, Z, px); ctx.stroke();
      ctx.strokeStyle = 'rgba(230,230,220,0.55)';
      ctx.lineWidth = 0.6 * px * 2;
      ctx.setLineDash([12 * px, 18 * px]);
      ctx.beginPath(); drawFn(ctx, X, Z, px); ctx.stroke();
      mctx.strokeStyle = '#fff';
      mctx.lineWidth = width * mpx;
      mctx.setLineDash([]);
      mctx.beginPath(); drawFn(mctx, MX, MZ, mpx); mctx.stroke();
    };
    road((c, fx, fz, s) => c.arc(fx(0), fz(0), RING * s, 0, Math.PI * 2), 48);
    road((c, fx, fz) => { c.moveTo(fx(HWY_X), fz(-RING)); c.lineTo(fx(HWY_X), fz(RING)); }, 48);
    road((c, fx, fz) => { c.moveTo(fx(-RING), fz(HWY_Z)); c.lineTo(fx(RING), fz(HWY_Z)); }, 48);

    // Bridges where highways cross the river
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.8 });
    const addBridge = (x, z, ang) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(56, 5, 560), bridgeMat);
      b.position.set(x, 2.2, z);
      b.rotation.y = ang;
      b.castShadow = b.receiveShadow = true;
      this.scene.add(b);
    };
    addBridge(HWY_X, riverZ(HWY_X), 0);
    let prev = null;
    for (let i = 0; i <= 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      const x = Math.cos(a) * RING, z = Math.sin(a) * RING;
      const f = z - riverZ(x);
      if (prev !== null && Math.sign(f) !== Math.sign(prev)) addBridge(x, z, -a);
      prev = f;
    }

    // City ground
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.r.capabilities.getMaxAnisotropy();
    const gg = new THREE.PlaneGeometry(EXT * 2, EXT * 2);
    gg.rotateX(-Math.PI / 2);
    const gm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ground = new THREE.Mesh(gg, gm);
    ground.position.y = 3.15;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.maskTex = new THREE.CanvasTexture(mc);
    this.maskTex.generateMipmaps = false;
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.colorSpace = THREE.NoColorSpace;

    // Buildings: one instanced mesh with a procedural window shader
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const n = bld.length;
    const info = new Float32Array(n * 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.65 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aInfo;
          varying vec3 vWP; varying vec3 vONrm; varying vec2 vInfo; varying float vTop;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 wpB = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vWP = wpB.xyz; vONrm = normal; vInfo = aInfo;
          vTop = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWP; varying vec3 vONrm; varying vec2 vInfo; varying float vTop;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float win = 0.0; float lit = 0.0; float glass = vInfo.y; vec3 litCol = vec3(0.0);
          if (vInfo.x < 0.0) {
            diffuseColor.rgb *= 0.9;
          } else if (abs(vONrm.y) < 0.5) {
            float u = abs(vONrm.x) > 0.5 ? vWP.z : vWP.x;
            float fh = 3.7; float bw = mix(3.4, 1.9, glass);
            vec2 cell = vec2(u / bw, (vWP.y - 1.0) / fh);
            vec2 f = fract(cell); vec2 id = floor(cell);
            float wx = mix(0.17, 0.05, glass);
            float wy0 = mix(0.26, 0.1, glass), wy1 = mix(0.84, 0.97, glass);
            win = step(wx, f.x) * step(f.x, 1.0 - wx) * step(wy0, f.y) * step(f.y, wy1);
            float band = step(vWP.y, vTop - 2.8) * step(1.0, id.y);
            vec2 fw = fwidth(cell);
            float aa = 1.0 - smoothstep(0.22, 0.6, max(fw.x, fw.y));
            float cover = (1.0 - 2.0 * wx) * (wy1 - wy0);
            float rr = h21(id + vInfo.x * 91.7 + abs(vONrm.x) * 13.0 + vONrm.z * 7.0);
            float litP = 0.26 + 0.12 * glass;
            lit = mix(cover * litP * 0.7, win * step(1.0 - litP, rr), aa) * band;
            win = mix(cover, win, aa) * band;
            litCol = mix(mix(vec3(1.0, 0.7, 0.4), vec3(0.8, 0.88, 1.0), step(0.82, h21(id * 1.7 + vInfo.x))) * (0.5 + 1.3 * h21(id + 3.1)), vec3(0.95, 0.72, 0.48), 1.0 - aa);
            vec3 glassCol = mix(vec3(0.05, 0.07, 0.09), vec3(0.09, 0.14, 0.18), glass);
            diffuseColor.rgb *= 0.86 + 0.14 * h21(vec2(id.y, vInfo.x));
            diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, win);
            diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 28.0, vWP.y - 3.0));
          } else {
            diffuseColor.rgb *= 0.55;
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.12, win);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 0.12 + 0.4 * glass, win);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += litCol * lit * 1.05;`);
    };
    for (const b of bld) {
      if (b.w < 4) continue;
      const k = Math.round(b.x / CELL) + ',' + Math.round(b.z / CELL);
      if (!GRID.has(k)) GRID.set(k, []);
      GRID.get(k).push([b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 3 + b.y + b.h]);
    }
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const b = bld[i];
      pos.set(b.x, 3 + b.y, b.z);
      scl.set(b.w, b.h, b.d);
      m4.compose(pos, q, scl);
      mesh.setMatrixAt(i, m4);
      c.setRGB(b.col[0], b.col[1], b.col[2]);
      mesh.setColorAt(i, c);
      info[i * 2] = b.plain ? -1 : b.seed * 100;
      info[i * 2 + 1] = b.glass;
    }
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    this.buildings = mesh;
    this.buildingCount = n;

    // Aviation beacons on tall roofs
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
    const bph = new Float32Array(beacons.length / 3).map(() => Math.random() * 6.28);
    bg.setAttribute('aPh', new THREE.BufferAttribute(bph, 1));
    const bm = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uPx: { value: 800 } },
      vertexShader: `attribute float aPh; uniform float uTime; uniform float uPx; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          vA = step(0.55, fract(uTime*0.55 + aPh)); gl_PointSize = clamp(uPx * 6.0 / -mv.z, 2.0, 10.0); }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA;
          gl_FragColor = vec4(vec3(6.0, 0.4, 0.2) * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.beaconMat = bm;
    const bp = new THREE.Points(bg, bm);
    bp.frustumCulled = false;
    this.scene.add(bp);

    // Anti-aircraft sites (hostile)
    const aaMat = new THREE.MeshStandardMaterial({ color: 0x4b5040, roughness: 0.7, metalness: 0.3 });
    for (let i = aaCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [aaCandidates[i], aaCandidates[j]] = [aaCandidates[j], aaCandidates[i]];
    }
    for (const [x, z] of aaCandidates.slice(0, 12)) {
      const grp = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 3, 10), aaMat);
      base.position.y = 1.5;
      const turret = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 7), aaMat);
      turret.position.y = 4.5;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 6), aaMat);
      barrel.position.set(0, 7.5, -3);
      barrel.rotation.x = -0.9;
      grp.add(base, turret, barrel);
      grp.position.set(x, 3, z);
      grp.traverse((o) => { o.castShadow = true; });
      this.scene.add(grp);
      this.aaSites.push({ pos: new THREE.Vector3(x, 12, z), cd: 2 + rng() * 3, group: grp });
    }
  }

  // -------------------------------------------------------------------------
  buildTrees() {
    const rng = mulberry32(99);
    const cone = new THREE.ConeGeometry(0.5, 1, 7);
    cone.translate(0, 0.5, 0);
    const round = new THREE.IcosahedronGeometry(0.5, 1);
    round.translate(0, 0.62, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const conifers = [], broad = [];
    for (let i = 0; i < 160000 && conifers.length < 42000; i++) {
      const x = (rng() - 0.5) * 30000, z = (rng() - 0.5) * 30000;
      const r = Math.hypot(x, z);
      if (r < CITY_R + 350) continue;
      if (Math.abs(x - AIRBASE.x) < 1100 && Math.abs(z - AIRBASE.z) < 2300) continue;
      if (forestMask(x, z) < 0.14) continue;
      const h = groundHeight(x, z);
      if (h < 6 || h > 1150) continue;
      conifers.push([x, h, z, 13 + rng() * 12, 4 + rng() * 3]);
    }
    for (const [cx, cz] of this.parks) {
      for (let k = 0; k < 26; k++) {
        const x = cx + (rng() - 0.5) * (BLOCK - 20), z = cz + (rng() - 0.5) * (BLOCK - 20);
        broad.push([x, 3, z, 10 + rng() * 7, 8 + rng() * 5]);
      }
    }
    for (let i = 0; i < 9000; i++) {
      const x = (rng() - 0.5) * 2 * (CITY_R + 1800), z = (rng() - 0.5) * 2 * (CITY_R + 1800);
      const r = Math.hypot(x, z);
      if (r < CITY_R * 0.92 || r > CITY_R + 1800) continue;
      const h = groundHeight(x, z);
      if (h < 3 || h > 60) continue;
      if (Math.abs(x - AIRBASE.x) < 1100 && Math.abs(z - AIRBASE.z) < 2300) continue;
      broad.push([x, h, z, 9 + rng() * 8, 7 + rng() * 6]);
    }
    const place = (geo, list, colA, colB) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const a = new THREE.Color(colA), b = new THREE.Color(colB), c = new THREE.Color();
      list.forEach(([x, y, z, h, w], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
        m4.compose(p.set(x, y - 1, z), q, s.set(w, h, w));
        m.setMatrixAt(i, m4);
        m.setColorAt(i, c.copy(a).lerp(b, rng()));
      });
      m.receiveShadow = true;
      m.castShadow = true;
      m.computeBoundingSphere();
      this.scene.add(m);
    };
    place(cone, conifers, 0x1f3319, 0x3a4d24);
    place(round, broad, 0x31501f, 0x6a7a31);
  }

  // -------------------------------------------------------------------------
  buildAirbase() {
    const A = AIRBASE;
    const rc = document.createElement('canvas');
    rc.width = 256; rc.height = 4096;
    const x = rc.getContext('2d');
    x.fillStyle = '#2f3134';
    x.fillRect(0, 0, 256, 4096);
    for (let i = 0; i < 9000; i++) {
      const v = 40 + Math.random() * 25;
      x.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
      x.fillRect(Math.random() * 256, Math.random() * 4096, 2, 3);
    }
    x.fillStyle = '#e8e8e2';
    x.fillRect(8, 0, 5, 4096); x.fillRect(243, 0, 5, 4096);
    for (let y = 300; y < 3800; y += 90) x.fillRect(125, y, 6, 48);
    for (const y0 of [30, 3946]) for (let k = 0; k < 8; k++) { x.fillRect(22 + k * 14, y0, 8, 120); x.fillRect(234 - (k + 1) * 14, y0, 8, 120); }
    for (const y0 of [520, 760, 3246, 3486]) { x.fillRect(60, y0, 30, 90); x.fillRect(166, y0, 30, 90); }
    const rt = new THREE.CanvasTexture(rc);
    rt.colorSpace = THREE.SRGBColorSpace;
    rt.anisotropy = this.r.capabilities.getMaxAnisotropy();
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(A.w, A.len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9 }));
    rw.position.set(A.x, 3.3, A.z);
    rw.receiveShadow = true;
    this.scene.add(rw);
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 });
    const conc = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.92 });
    const addPlane = (w, l, px, pz, mat, y = 3.25) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), mat);
      m.position.set(px, y, pz);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    addPlane(24, A.len - 200, A.x + 170, A.z, asphalt);
    for (const dz of [-1300, -400, 500, 1300]) addPlane(124, 22, A.x + 95, A.z + dz, asphalt, 3.22);
    addPlane(420, 900, A.x + 420, A.z, conc);
    const hangarMat = new THREE.MeshStandardMaterial({ color: 0x6f756f, roughness: 0.6, metalness: 0.35 });
    for (let i = 0; i < 5; i++) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(62, 22, 58), hangarMat);
      h.position.set(A.x + 600, 3 + 11, A.z - 300 + i * 140);
      h.castShadow = h.receiveShadow = true;
      this.scene.add(h);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(31, 31, 58, 16, 1, false, 0, Math.PI), hangarMat);
      roof.rotation.x = Math.PI / 2;
      roof.rotation.z = Math.PI / 2;
      roof.position.copy(h.position).add(new THREE.Vector3(0, 11, 0));
      roof.scale.set(1, 1, 0.35);
      roof.castShadow = true;
      this.scene.add(roof);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 6.5, 44, 12), conc);
    tower.position.set(A.x + 420, 25, A.z - 560);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(10, 8, 8, 12), new THREE.MeshStandardMaterial({ color: 0x1a2a33, roughness: 0.05, metalness: 0.8 }));
    cab.position.set(A.x + 420, 51, A.z - 560);
    tower.castShadow = cab.castShadow = true;
    this.scene.add(tower, cab);

    // Runway edge + threshold lights
    const pts = [], cols = [];
    for (let z = -A.len / 2; z <= A.len / 2; z += 60) {
      for (const sx of [-1, 1]) { pts.push(A.x + sx * (A.w / 2 + 2), 3.8, A.z + z); cols.push(3.5, 3.0, 2.2); }
    }
    for (let k = -12; k <= 12; k++) {
      pts.push(A.x + k * 2.4, 3.8, A.z + A.len / 2 + 4); cols.push(0.3, 4, 0.8);
      pts.push(A.x + k * 2.4, 3.8, A.z - A.len / 2 - 4); cols.push(4, 0.4, 0.3);
    }
    for (let d = 60; d < 900; d += 60) for (const sx of [-6, 0, 6]) { pts.push(A.x + sx, 3.8, A.z + A.len / 2 + d); cols.push(4, 3.6, 3); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lg.setAttribute('aCol', new THREE.Float32BufferAttribute(cols, 3));
    const lm = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 800 } },
      vertexShader: `attribute vec3 aCol; uniform float uPx; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; vC = aCol;
          gl_PointSize = clamp(uPx * 2.2 / -mv.z, 1.5, 7.0); }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vC * smoothstep(0.5,0.05,d), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.runwayLightMat = lm;
    const lp = new THREE.Points(lg, lm);
    lp.frustumCulled = false;
    this.scene.add(lp);
  }

  decorate(models) {
    const A = AIRBASE;
    for (let i = 0; i < 4; i++) {
      const p = models.player.template.clone(true);
      p.position.set(A.x + 330, 3 + models.player.info.height * 0.5 + 0.4, A.z - 200 + i * 60);
      p.rotation.y = -Math.PI / 2;
      this.scene.add(p);
    }
  }

  // -------------------------------------------------------------------------
  buildClouds() {
    const rng = mulberry32(4242);
    const tex = cloudTexture();
    const puffs = [];
    for (let c = 0; c < 85; c++) {
      const a = rng() * Math.PI * 2, rr = 1500 + Math.sqrt(rng()) * 22000;
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
      const cy = 1300 + rng() * 1300 + (rng() < 0.2 ? 1200 : 0);
      const count = 12 + Math.floor(rng() * 18);
      const sx = 500 + rng() * 900, sz = 400 + rng() * 800;
      for (let k = 0; k < count; k++) {
        const ox = (rng() + rng() + rng() - 1.5) * sx, oz = (rng() + rng() + rng() - 1.5) * sz, oy = (rng() + rng() - 1) * 140;
        const dir = new THREE.Vector3(ox / sx, oy / 140 + 0.6, oz / sz).normalize();
        const light = clamp(0.55 + 0.45 * dir.dot(SUN_DIR) + (oy > 0 ? 0.15 : -0.1), 0, 1);
        puffs.push([cx + ox, cy + oy, cz + oz, 230 + rng() * 420, light, rng() * 6.28]);
      }
    }
    this.puffs = puffs;
    const n = puffs.length;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.cPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.cData = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('iPos', this.cPos);
    g.setAttribute('iData', this.cData);
    g.instanceCount = n;
    this.writeClouds(puffs);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex }, uFogColor: { value: FOG_COLOR }, uFogDensity: { value: FOG_DENSITY * 0.6 },
        uLit: { value: new THREE.Color(1.05, 0.86, 0.7) }, uShade: { value: new THREE.Color(0.42, 0.41, 0.5) },
      },
      vertexShader: `attribute vec3 iPos; attribute vec3 iData; varying vec2 vUv; varying float vLight; varying float vFog; varying float vNear;
        uniform float uFogDensity;
        void main(){
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          float c = cos(iData.z), s = sin(iData.z);
          vec2 p = position.xy; p = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
          mv.xy += p * iData.x;
          gl_Position = projectionMatrix * mv;
          vUv = uv; vLight = iData.y;
          float d = -mv.z; vFog = 1.0 - exp(-uFogDensity*uFogDensity*d*d);
          vNear = smoothstep(40.0, 320.0, d);
        }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uFogColor; uniform vec3 uLit; uniform vec3 uShade;
        varying vec2 vUv; varying float vLight; varying float vFog; varying float vNear;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          float a = t.a * 0.95 * vNear;
          if (a < 0.01) discard;
          vec3 col = mix(uShade, uLit, clamp(vLight * (0.75 + 0.5*t.a), 0.0, 1.0));
          col = mix(col, uFogColor, vFog);
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.clouds = mesh;
  }

  writeClouds(list) {
    const p = this.cPos.array, d = this.cData.array;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      p[i * 3] = c[0]; p[i * 3 + 1] = c[1]; p[i * 3 + 2] = c[2];
      d[i * 3] = c[3]; d[i * 3 + 1] = c[4]; d[i * 3 + 2] = c[5];
    }
    this.cPos.needsUpdate = true;
    this.cData.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  buildTraffic() {
    const data = [], lane = [], col = [];
    const N = Math.floor(EXT / CELL);
    const addCar = (axis, coord, speed, laneOff, heavy) => {
      data.push(axis, coord, Math.random() * 20000, speed);
      lane.push(laneOff);
      if (speed > 0) col.push(2.6, 2.3, 1.7);
      else col.push(2.6, 0.25, 0.12);
      if (heavy) col.splice(col.length - 3, 3, speed > 0 ? 3.0 : 3.0, speed > 0 ? 2.6 : 0.3, speed > 0 ? 2.0 : 0.15);
    };
    for (let g = -N - 1; g <= N; g++) {
      const c = (g + 0.5) * CELL;
      for (let k = 0; k < 14; k++) {
        const s = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8);
        addCar(0, c, s, s > 0 ? 6 : -6);
        const s2 = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8);
        addCar(1, c, s2, s2 > 0 ? -6 : 6);
      }
    }
    for (let k = 0; k < 180; k++) {
      const s = (k % 2 ? -1 : 1) * (28 + Math.random() * 10);
      const off = (s > 0 ? 1 : -1) * (6 + (k % 3) * 5);
      addCar(1, HWY_X, s, off, true);
      addCar(0, HWY_Z, s, -off, true);
      addCar(2, RING, s, off, true);
      addCar(2, RING, -s, -off, true);
    }
    const n = lane.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aData', new THREE.Float32BufferAttribute(data, 4));
    g.setAttribute('aLane', new THREE.Float32BufferAttribute(lane, 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uMask: { value: this.maskTex }, uPx: { value: 800 }, uExt: { value: EXT }, uFogDensity: { value: FOG_DENSITY } },
      vertexShader: `attribute vec4 aData; attribute float aLane; attribute vec3 aCol;
        uniform float uTime; uniform sampler2D uMask; uniform float uPx; uniform float uExt; uniform float uFogDensity;
        varying vec3 vC; varying float vFog;
        void main(){
          float axis = aData.x, coord = aData.y;
          float L = axis > 1.5 ? 6.2831853 * coord : 2.0 * uExt;
          float t = mod(aData.z + uTime * aData.w, L);
          vec3 p;
          if (axis < 0.5) p = vec3(-uExt + t, 3.9, coord + aLane);
          else if (axis < 1.5) p = vec3(coord + aLane, 3.9, -uExt + t);
          else { float a = t / coord; float rr = coord + aLane; p = vec3(cos(a) * rr, 3.9, sin(a) * rr); }
          vec2 uv = vec2((p.x + uExt) / (2.0 * uExt), 1.0 - (p.z + uExt) / (2.0 * uExt));
          float m = texture2D(uMask, uv).r;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = m > 0.5 ? clamp(uPx * 3.2 / d, 1.2, 6.0) : 0.0;
          vC = aCol; vFog = 1.0 - exp(-uFogDensity*uFogDensity*d*d);
        }`,
      fragmentShader: `varying vec3 vC; varying float vFog;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vC * a * (1.0 - vFog), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.trafficMat = mat;
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  // -------------------------------------------------------------------------
  update(dt, camera, focus) {
    this.time += dt;
    this.uTime.value = this.time;
    this.sky.position.copy(camera.position);
    this.sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 40000);
    const snap = 20;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, Math.max(0, focus.y * 0.3), fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 7000);
    this.waterTex.offset.x += dt * 0.0035;
    this.waterTex.offset.y += dt * 0.0022;
    const px = (window.innerHeight * this.r.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.trafficMat.uniforms.uPx.value = px;
    this.beaconMat.uniforms.uPx.value = px;
    this.runwayLightMat.uniforms.uPx.value = px;
    this.cloudSortT -= dt;
    if (this.cloudSortT <= 0) {
      this.cloudSortT = 0.25;
      const cp = camera.position;
      this.puffs.sort((a, b) => ((b[0] - cp.x) ** 2 + (b[1] - cp.y) ** 2 + (b[2] - cp.z) ** 2) - ((a[0] - cp.x) ** 2 + (a[1] - cp.y) ** 2 + (a[2] - cp.z) ** 2));
      this.writeClouds(this.puffs);
    }
  }
}
