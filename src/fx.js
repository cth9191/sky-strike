import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY } from './world.js';

// 2x2 atlas: 0 soft glow, 1 smoke puff, 2 ring, 3 hot core
function makeAtlas() {
  const S = 512, T = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const tile = (f) => [(f % 2) * T, (1 - Math.floor(f / 2)) * T];
  const radial = (f, stops, r0 = 0) => {
    const [tx, ty] = tile(f);
    const g = x.createRadialGradient(tx + T / 2, ty + T / 2, r0, tx + T / 2, ty + T / 2, T / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g;
    x.fillRect(tx, ty, T, T);
  };
  radial(0, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [0.6, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]);
  {
    const [tx, ty] = tile(1);
    x.save();
    x.beginPath();
    x.rect(tx, ty, T, T);
    x.clip();
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * T * 0.24;
      const px = tx + T / 2 + Math.cos(a) * rr, py = ty + T / 2 + Math.sin(a) * rr;
      const s = T * (0.1 + Math.random() * 0.18);
      const g = x.createRadialGradient(px, py, 0, px, py, s);
      g.addColorStop(0, `rgba(255,255,255,${0.12 + Math.random() * 0.14})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(tx, ty, T, T);
    }
    x.restore();
  }
  radial(2, [[0, 'rgba(255,255,255,0)'], [0.65, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']], T * 0.28);
  radial(3, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]);
  return new THREE.CanvasTexture(c);
}

const VS = `
attribute vec3 iPos; attribute float iSize; attribute vec4 iColor; attribute vec2 iMisc;
uniform float uFogDensity;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iMisc.x), s = sin(iMisc.x);
  vec2 p = position.xy; p = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  mv.xy += p * iSize;
  gl_Position = projectionMatrix * mv;
  float fr = iMisc.y;
  vUv = (uv + vec2(mod(fr, 2.0), floor(fr / 2.0))) * 0.5;
  vCol = iColor;
  float d = -mv.z; vFog = 1.0 - exp(-uFogDensity*uFogDensity*d*d);
  vCol.a *= smoothstep(2.0, 18.0, d);
}`;
const FS = `
uniform sampler2D uTex; uniform vec3 uFogColor; uniform float uAdd;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){
  vec4 t = texture2D(uTex, vUv);
  float a = vCol.a * t.a;
  if (a < 0.002) discard;
  if (uAdd > 0.5) gl_FragColor = vec4(vCol.rgb * a * (1.0 - vFog), 1.0);
  else gl_FragColor = vec4(mix(vCol.rgb, uFogColor, vFog), a);
}`;

export class Particles {
  constructor(scene, max, tex, additive) {
    this.max = max;
    this.n = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const mk = (size) => new THREE.InstancedBufferAttribute(new Float32Array(max * size), size).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(3); this.aSize = mk(1); this.aCol = mk(4); this.aMisc = mk(2);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iMisc', this.aMisc);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uFogColor: { value: FOG_COLOR }, uFogDensity: { value: FOG_DENSITY }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 4 : 3;
    scene.add(this.mesh);
    const F = Float32Array;
    this.p = new F(max * 3); this.v = new F(max * 3); this.age = new F(max); this.life = new F(max);
    this.s0 = new F(max); this.s1 = new F(max); this.c0 = new F(max * 3); this.c1 = new F(max * 3);
    this.a0 = new F(max); this.drag = new F(max); this.grav = new F(max); this.rot = new F(max);
    this.rotv = new F(max); this.frame = new F(max); this.fin = new F(max);
    this.arrays3 = [this.p, this.v, this.c0, this.c1];
    this.arrays1 = [this.age, this.life, this.s0, this.s1, this.a0, this.drag, this.grav, this.rot, this.rotv, this.frame, this.fin];
  }

  spawn(o) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    const i3 = i * 3;
    this.p[i3] = o.pos.x; this.p[i3 + 1] = o.pos.y; this.p[i3 + 2] = o.pos.z;
    const v = o.vel;
    this.v[i3] = v ? v.x : 0; this.v[i3 + 1] = v ? v.y : 0; this.v[i3 + 2] = v ? v.z : 0;
    this.age[i] = 0;
    this.life[i] = o.life ?? 1;
    this.s0[i] = o.size0 ?? 5;
    this.s1[i] = o.size1 ?? this.s0[i];
    const c0 = o.color0 || [1, 1, 1], c1 = o.color1 || c0;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.grav ?? 0;
    this.rot[i] = Math.random() * 6.283;
    this.rotv[i] = o.spin ?? 0;
    this.frame[i] = o.frame ?? 0;
    this.fin[i] = o.fadeIn ?? 0;
  }

  copy(s, d) {
    for (const a of this.arrays3) { a[d * 3] = a[s * 3]; a[d * 3 + 1] = a[s * 3 + 1]; a[d * 3 + 2] = a[s * 3 + 2]; }
    for (const a of this.arrays1) a[d] = a[s];
  }

  update(dt) {
    const P = this.aPos.array, Sz = this.aSize.array, C = this.aCol.array, M = this.aMisc.array;
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.n--;
        if (i !== this.n) this.copy(this.n, i);
        continue;
      }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= d;
      this.v[i3 + 1] = this.v[i3 + 1] * d - this.grav[i] * dt;
      this.v[i3 + 2] *= d;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.rotv[i] * dt;
      const t = this.age[i] / this.life[i];
      const e = 1 - (1 - t) * (1 - t);
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      Sz[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      const fi = this.fin[i] > 0 ? Math.min(1, this.age[i] / this.fin[i]) : 1;
      const i4 = i * 4;
      C[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      C[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      C[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      C[i4 + 3] = this.a0[i] * fi * Math.pow(1 - t, 1.25);
      M[i * 2] = this.rot[i];
      M[i * 2 + 1] = this.frame[i];
      i++;
    }
    this.geo.instanceCount = this.n;
    for (const [a, s] of [[this.aPos, 3], [this.aSize, 1], [this.aCol, 4], [this.aMisc, 2]]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n * s));
      a.needsUpdate = true;
    }
  }
}

const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
function randDir(out) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(Math.cos(a) * s, u, Math.sin(a) * s);
}

export class FX {
  constructor(scene) {
    const tex = makeAtlas();
    this.add = new Particles(scene, 9000, tex, true);
    this.smoke = new Particles(scene, 16000, tex, false);
    this.tex = tex;
  }

  update(dt) {
    this.add.update(dt);
    this.smoke.update(dt);
  }

  explosion(pos, s = 1, vel = null) {
    const V = vel ? _v.copy(vel).multiplyScalar(0.25) : _v.set(0, 0, 0);
    this.add.spawn({ pos, life: 0.25, size0: 50 * s, size1: 190 * s, color0: [7, 5.5, 4], color1: [3, 1.4, 0.5], frame: 3 });
    this.add.spawn({ pos, life: 0.6, size0: 12 * s, size1: 300 * s, color0: [2.2, 1.6, 1.1], color1: [0.5, 0.35, 0.25], alpha: 0.8, frame: 2 });
    for (let i = 0; i < 28; i++) {
      randDir(_d);
      const sp = (18 + Math.random() * 75) * s;
      this.add.spawn({
        pos: _p.copy(pos).addScaledVector(_d, Math.random() * 6 * s), vel: _d.clone().multiplyScalar(sp).add(V),
        life: 0.7 + Math.random() * 1.0, size0: (10 + Math.random() * 16) * s, size1: (36 + Math.random() * 44) * s,
        color0: [4.5, 2.3, 0.7], color1: [1.1, 0.22, 0.04], drag: 1.8, grav: -5, frame: Math.random() < 0.5 ? 0 : 1, spin: (Math.random() - 0.5) * 2,
      });
    }
    for (let i = 0; i < 24; i++) {
      randDir(_d);
      this.smoke.spawn({
        pos: _p.copy(pos).addScaledVector(_d, Math.random() * 10 * s), vel: _d.clone().multiplyScalar((8 + Math.random() * 34) * s).addScaledVector(V, 0.6),
        life: 4 + Math.random() * 5, size0: 26 * s, size1: (95 + Math.random() * 90) * s,
        color0: [0.1, 0.09, 0.085], color1: [0.34, 0.32, 0.31], alpha: 0.85, drag: 0.9, grav: -3, frame: 1, fadeIn: 0.2, spin: (Math.random() - 0.5) * 0.6,
      });
    }
    for (let i = 0; i < 34; i++) {
      randDir(_d);
      this.add.spawn({
        pos, vel: _d.clone().multiplyScalar((60 + Math.random() * 150) * s).add(V), life: 1 + Math.random() * 1.6,
        size0: 3.5 * s, size1: 1.2 * s, color0: [5, 3, 1.2], color1: [1.2, 0.3, 0.05], drag: 0.5, grav: 32, frame: 3,
      });
    }
  }

  hit(pos) {
    for (let i = 0; i < 10; i++) {
      randDir(_d);
      this.add.spawn({ pos, vel: _d.clone().multiplyScalar(40 + Math.random() * 90), life: 0.3 + Math.random() * 0.4, size0: 2.2, size1: 0.6, color0: [6, 4, 1.8], color1: [2, 0.6, 0.1], grav: 20, frame: 3 });
    }
    this.add.spawn({ pos, life: 0.12, size0: 8, size1: 22, color0: [5, 3.5, 2], frame: 3 });
    this.smoke.spawn({ pos, vel: randDir(_d).multiplyScalar(5), life: 1.8, size0: 5, size1: 22, color0: [0.2, 0.19, 0.18], color1: [0.4, 0.38, 0.36], alpha: 0.6, drag: 1, frame: 1 });
  }

  muzzle(pos) {
    this.add.spawn({ pos, life: 0.05, size0: 3.5, size1: 6, color0: [7, 4.5, 1.8], frame: 3 });
  }

  trailSmoke(pos, size = 6, life = 3, dark = false) {
    this.smoke.spawn({
      pos, vel: randDir(_d).multiplyScalar(1.5), life, size0: size * 0.6, size1: size * 3.2,
      color0: dark ? [0.08, 0.08, 0.08] : [0.92, 0.9, 0.87], color1: dark ? [0.25, 0.24, 0.24] : [0.72, 0.7, 0.68],
      alpha: dark ? 0.75 : 0.55, drag: 0.5, grav: -1, frame: 1, fadeIn: 0.05, spin: (Math.random() - 0.5),
    });
  }

  flame(pos, size = 3, vel = null) {
    this.add.spawn({ pos, vel, life: 0.1, size0: size, size1: size * 0.3, color0: [6, 3.4, 1.3], color1: [2.2, 0.6, 0.1], frame: 3 });
  }

  fire(pos, s = 1) {
    this.add.spawn({ pos: _p.copy(pos).add(randDir(_d).multiplyScalar(3 * s)), vel: randDir(_d).multiplyScalar(6), life: 0.35 + Math.random() * 0.3, size0: 9 * s, size1: 22 * s, color0: [4.5, 2.2, 0.6], color1: [1.2, 0.25, 0.05], drag: 1, grav: -8, frame: 0 });
    this.smoke.spawn({ pos, vel: randDir(_d).multiplyScalar(4), life: 3.5, size0: 10 * s, size1: 45 * s, color0: [0.06, 0.06, 0.06], color1: [0.26, 0.25, 0.25], alpha: 0.8, drag: 0.6, grav: -4, frame: 1, fadeIn: 0.1 });
  }

  flak(pos) {
    this.add.spawn({ pos, life: 0.16, size0: 14, size1: 40, color0: [6, 4, 2], color1: [2, 0.8, 0.2], frame: 3 });
    for (let i = 0; i < 6; i++) {
      this.smoke.spawn({ pos: _p.copy(pos).add(randDir(_d).multiplyScalar(6)), vel: randDir(_d).multiplyScalar(6), life: 5 + Math.random() * 3, size0: 14, size1: 55 + Math.random() * 25, color0: [0.07, 0.07, 0.07], color1: [0.22, 0.22, 0.22], alpha: 0.85, drag: 0.8, frame: 1, fadeIn: 0.08 });
    }
    for (let i = 0; i < 8; i++) {
      randDir(_d);
      this.add.spawn({ pos, vel: _d.clone().multiplyScalar(80 + Math.random() * 60), life: 0.4, size0: 2, size1: 0.6, color0: [5, 3, 1], grav: 20, frame: 3 });
    }
  }

  dust(pos, s = 1) {
    for (let i = 0; i < 10; i++) {
      randDir(_d); _d.y = Math.abs(_d.y);
      this.smoke.spawn({ pos, vel: _d.clone().multiplyScalar(20 * s), life: 4, size0: 12 * s, size1: 70 * s, color0: [0.45, 0.38, 0.3], color1: [0.55, 0.5, 0.45], alpha: 0.6, drag: 1, grav: -1, frame: 1, fadeIn: 0.1 });
    }
  }

  flareGlow(pos) {
    this.add.spawn({ pos, life: 0.07, size0: 16, size1: 10, color0: [9, 7.5, 5], frame: 3 });
  }
}

// ---------------------------------------------------------------------------
// Camera-facing ribbon trails (wingtip vapor, contrails)
// ---------------------------------------------------------------------------
export class Trails {
  constructor(scene, maxTrails = 90, maxPts = 44) {
    this.maxPts = maxPts;
    this.list = [];
    const maxV = maxTrails * maxPts * 2;
    this.maxV = maxV;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(maxV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.BufferAttribute(new Float32Array(maxV), 1).setUsage(THREE.DynamicDrawUsage);
    this.index = new THREE.BufferAttribute(new Uint32Array(maxTrails * (maxPts - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('aAlpha', this.alpha);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFogColor: { value: FOG_COLOR }, uFogDensity: { value: FOG_DENSITY } },
      vertexShader: `attribute float aAlpha; varying float vA; varying float vFog; uniform float uFogDensity;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float d = -mv.z; vA = aAlpha * smoothstep(25.0, 110.0, d); vFog = 1.0 - exp(-uFogDensity*uFogDensity*d*d); }`,
      fragmentShader: `varying float vA; varying float vFog; uniform vec3 uFogColor;
        void main(){ gl_FragColor = vec4(mix(vec3(1.0, 0.97, 0.94), uFogColor, vFog), vA); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  create(width, life, maxAlpha, grow = 2.2) {
    const t = { pts: [], width, life, maxAlpha, grow, alive: true };
    this.list.push(t);
    return t;
  }

  push(t, pos, time, intensity) {
    const pts = t.pts;
    const last = pts[pts.length - 1];
    if (last && time - last.t < 0.045 && pts.length > 1) {
      last.p.copy(pos);
      last.a = intensity;
      return;
    }
    pts.push({ p: pos.clone(), t: time, a: intensity });
    if (pts.length > this.maxPts) pts.shift();
  }

  update(camPos, time) {
    const P = this.pos.array, A = this.alpha.array, I = this.index.array;
    let v = 0, ix = 0;
    const tan = new THREE.Vector3(), toC = new THREE.Vector3(), side = new THREE.Vector3();
    this.list = this.list.filter((t) => t.alive || t.pts.length > 1);
    for (const t of this.list) {
      while (t.pts.length && time - t.pts[0].t > t.life) t.pts.shift();
      const n = t.pts.length;
      if (n < 2 || v + n * 2 > this.maxV) continue;
      const v0 = v;
      for (let i = 0; i < n; i++) {
        const pt = t.pts[i];
        const a = t.pts[Math.min(n - 1, i + 1)].p, b = t.pts[Math.max(0, i - 1)].p;
        tan.subVectors(a, b);
        if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1);
        toC.subVectors(camPos, pt.p);
        side.crossVectors(tan, toC);
        if (side.lengthSq() < 1e-6) side.set(0, 1, 0); else side.normalize();
        const age = (time - pt.t) / t.life;
        const w = t.width * (1 + age * t.grow) * 0.5;
        const head = Math.min(1, (n - 1 - i) / 3);
        const alpha = t.maxAlpha * pt.a * (1 - age) * (1 - age) * head;
        P[v * 3] = pt.p.x + side.x * w; P[v * 3 + 1] = pt.p.y + side.y * w; P[v * 3 + 2] = pt.p.z + side.z * w;
        P[v * 3 + 3] = pt.p.x - side.x * w; P[v * 3 + 4] = pt.p.y - side.y * w; P[v * 3 + 5] = pt.p.z - side.z * w;
        A[v] = alpha; A[v + 1] = alpha;
        v += 2;
      }
      for (let i = 0; i < n - 1; i++) {
        const a = v0 + i * 2;
        I[ix++] = a; I[ix++] = a + 1; I[ix++] = a + 2;
        I[ix++] = a + 1; I[ix++] = a + 3; I[ix++] = a + 2;
      }
    }
    this.geo.setDrawRange(0, ix);
    this.pos.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.index.needsUpdate = true;
  }
}
