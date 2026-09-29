import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceHeight } from './world.js';
import { rand } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);
const MAX_BULLETS = 1600;

// distance from sphere center c to segment a-b, squared
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3();
function segDist2(a, b, c) {
  _sa.subVectors(b, a);
  const len2 = _sa.lengthSq();
  let t = len2 > 0 ? _sb.subVectors(c, a).dot(_sa) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return _sb.copy(a).addScaledVector(_sa, t).distanceToSquared(c);
}

export class Combat {
  constructor(game) {
    this.g = game;
    this.bullets = [];
    this.missiles = [];
    this.flares = [];
    this.flak = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.1, 1.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(tg, tm, MAX_BULLETS);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    game.scene.add(this.tracers);
    const body = new THREE.CylinderGeometry(0.2, 0.2, 3.4, 8).rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.2, 0.8, 8).rotateX(-Math.PI / 2).translate(0, 0, -2.1);
    const f1 = new THREE.BoxGeometry(1.1, 0.05, 0.5).translate(0, 0, 1.4);
    const f2 = new THREE.BoxGeometry(0.05, 1.1, 0.5).translate(0, 0, 1.4);
    this.missileGeo = mergeGeometries([body, nose, f1, f2]);
    this.missileMat = new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.35, roughness: 0.4 });
  }

  clear() {
    for (const m of this.missiles) { this.g.scene.remove(m.mesh); m.trail.alive = false; }
    this.bullets.length = 0;
    this.missiles.length = 0;
    this.flares.length = 0;
    this.flak.length = 0;
    this.tracers.count = 0;
  }

  fireGun(ac, dt) {
    if (ac.overheat) return false;
    ac.gunTimer -= dt;
    let fired = false;
    const rate = ac.isPlayer ? 24 : 12;
    while (ac.gunTimer <= 0) {
      ac.gunTimer += 1 / rate;
      const f = ac.fwd(_v);
      const spread = ac.isPlayer ? 0.004 : 0.012;
      const dir = f.clone().add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
      const pos = ac.pos.clone().addScaledVector(f, ac.info.length * 0.55);
      if (this.bullets.length < MAX_BULLETS) {
        this.bullets.push({ pos, prev: pos.clone(), vel: dir.multiplyScalar(1050).add(ac.vel), life: 1.7, team: ac.team, owner: ac, dmg: ac.isPlayer ? 9 : 3.2, visual: false });
      }
      this.g.fx.muzzle(pos);
      fired = true;
      if (ac.isPlayer) {
        ac.gunHeat += 0.011;
        if (ac.gunHeat >= 1) { ac.overheat = true; this.g.hud.radio('GUN OVERHEAT'); }
      }
    }
    return fired;
  }

  fireMissile(ac, target) {
    if (ac.missiles <= 0) return false;
    ac.missiles--;
    const f = ac.fwd(new THREE.Vector3());
    const pos = ac.pos.clone().addScaledVector(ac.up(_v), -1.5).addScaledVector(f, 2);
    const mesh = new THREE.Mesh(this.missileGeo, this.missileMat);
    mesh.scale.setScalar(1.5);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    this.g.scene.add(mesh);
    this.missiles.push({
      pos: mesh.position, mesh, dir: f.clone(), speed: ac.speed + 20, target, decoy: null, owner: ac, team: ac.team,
      life: 11, age: 0, turn: ac.isPlayer ? 2.6 : 1.75, smokeT: 0, trail: this.g.trails.create(2.2, 4.5, 0.6, 2.5),
    });
    this.g.audio.playAt('missile', pos, ac.isPlayer ? 0.9 : 0.6);
    if (target && target.isPlayer) this.g.hud.radio('MISSILE LAUNCH!');
    return true;
  }

  deployFlares(ac) {
    if (ac.flares <= 0 || (ac.flareCD && this.g.time < ac.flareCD)) return false;
    ac.flares--;
    ac.flareCD = this.g.time + 0.7;
    const r = ac.right(new THREE.Vector3()), u = ac.up(new THREE.Vector3());
    const made = [];
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const vel = ac.vel.clone().multiplyScalar(0.55).addScaledVector(r, side * rand(25, 55)).addScaledVector(u, rand(-40, -10));
      const fl = { pos: ac.pos.clone(), vel, life: 3.6 + Math.random() };
      this.flares.push(fl);
      made.push(fl);
    }
    for (const m of this.missiles) {
      if (m.target === ac && !m.decoy && m.pos.distanceTo(ac.pos) < 3200 && Math.random() < (ac.isPlayer ? 0.85 : 0.5)) {
        m.decoy = made[Math.floor(Math.random() * made.length)];
      }
    }
    return true;
  }

  missileThreat(ac) {
    let best = null, bd = Infinity;
    for (const m of this.missiles) {
      if (m.target !== ac || m.decoy) continue;
      const d = m.pos.distanceTo(ac.pos);
      if (d < bd) { bd = d; best = m; }
    }
    return best ? { m: best, dist: bd } : null;
  }

  explodeMissile(m, big = 1) {
    this.g.fx.explosion(m.pos, 0.45 * big, null);
    this.g.audio.explosionAt(m.pos, 0.6);
    this.g.scene.remove(m.mesh);
    m.trail.alive = false;
    m.dead = true;
  }

  update(dt) {
    const g = this.g;
    const craft = g.aircraft;
    // bullets
    let n = 0;
    for (const b of this.bullets) {
      b.prev.copy(b.pos);
      b.vel.y -= 9.8 * dt * 0.35;
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && !b.visual) {
        for (const ac of craft) {
          if (!ac.alive || ac.team === b.team) continue;
          if (segDist2(b.prev, b.pos, ac.pos) < ac.radius * ac.radius) {
            ac.damage(b.dmg, b.owner);
            g.fx.hit(b.pos);
            if (b.owner && b.owner.isPlayer) g.hud.hitMarker();
            dead = true;
            break;
          }
        }
      }
      if (!dead && b.pos.y < surfaceHeight(b.pos.x, b.pos.z)) {
        if (Math.random() < 0.3) g.fx.dust(b.pos, 0.12);
        dead = true;
      }
      if (!dead) this.bullets[n++] = b;
    }
    this.bullets.length = n;
    const ts = this.tracers;
    for (let i = 0; i < n; i++) {
      const b = this.bullets[i];
      _v.copy(b.vel).normalize();
      _q.setFromUnitVectors(FWD, _v);
      _v2.copy(b.pos).addScaledVector(_v, 14);
      _m.compose(_v2, _q, b.visual ? _s.set(0.5, 0.5, 14) : _s.set(0.8, 0.8, 26));
      ts.setMatrixAt(i, _m);
    }
    ts.count = n;
    ts.instanceMatrix.needsUpdate = true;

    // missiles
    for (const m of this.missiles) {
      m.age += dt;
      m.life -= dt;
      m.speed = Math.min(m.speed + 190 * dt, 760);
      let tp = null, tv = null;
      if (m.decoy) { tp = m.decoy.pos; tv = m.decoy.vel; }
      else if (m.target && m.target.alive) { tp = m.target.pos; tv = m.target.vel; }
      if (tp && m.age > 0.25) {
        const d = m.pos.distanceTo(tp);
        const tgo = d / Math.max(m.speed, 200);
        _v.copy(tp).addScaledVector(tv, tgo * 0.85).sub(m.pos).normalize();
        const ang = m.dir.angleTo(_v);
        if (ang > 1.7 && !m.decoy) m.target = null;
        else {
          const mt = m.turn * dt;
          if (ang <= mt) m.dir.copy(_v);
          else {
            _q.setFromUnitVectors(m.dir, _v);
            const full = new THREE.Quaternion();
            full.slerp(_q, mt / ang);
            m.dir.applyQuaternion(full).normalize();
          }
        }
      }
      const prev = _v2.copy(m.pos);
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.mesh.quaternion.setFromUnitVectors(FWD, m.dir);
      _v3.copy(m.pos).addScaledVector(m.dir, -3);
      g.trails.push(m.trail, _v3, g.time, 1);
      m.smokeT -= dt;
      if (m.smokeT <= 0) {
        m.smokeT = 0.06;
        g.fx.trailSmoke(_v3, 5, 3.5);
      }
      _v3.copy(m.pos).addScaledVector(m.dir, -3.2);
      g.fx.flame(_v3, 4.5);
      if (m.decoy && m.pos.distanceTo(m.decoy.pos) < 25) { this.explodeMissile(m, 0.6); continue; }
      let hit = null;
      for (const ac of craft) {
        if (!ac.alive || ac.team === m.team) continue;
        const r = ac === m.target ? 22 : 14;
        if (segDist2(prev, m.pos, ac.pos) < r * r) { hit = ac; break; }
      }
      if (hit) {
        hit.damage(hit.isPlayer ? 55 : 100, m.owner);
        this.explodeMissile(m, 1);
        g.shakeAt(m.pos, 1.2);
        continue;
      }
      if (m.pos.y < surfaceHeight(m.pos.x, m.pos.z) + 1) { this.explodeMissile(m, 1); g.fx.dust(m.pos, 0.8); continue; }
      if (m.life <= 0) { this.explodeMissile(m, 0.6); continue; }
    }
    this.missiles = this.missiles.filter((m) => !m.dead);

    // flares
    for (const f of this.flares) {
      f.vel.multiplyScalar(1 - 0.9 * dt);
      f.vel.y -= 9.8 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.life -= dt;
      g.fx.flareGlow(f.pos);
      if (Math.random() < 0.7) g.fx.trailSmoke(f.pos, 3, 2.2);
    }
    this.flares = this.flares.filter((f) => f.life > 0);

    // anti-aircraft fire from the city
    const blue = craft.filter((a) => a.alive && a.team === 0);
    for (const site of g.world.aaSites) {
      site.cd -= dt;
      if (site.cd > 0 || !blue.length) continue;
      let tgt = null, td = Infinity;
      for (const a of blue) {
        const hd = Math.hypot(a.pos.x - site.pos.x, a.pos.z - site.pos.z);
        const alt = a.pos.y - site.pos.y;
        if (hd < 3400 && alt > 60 && alt < 3200 && hd < td) { td = hd; tgt = a; }
      }
      if (!tgt) { site.cd = 1; continue; }
      site.cd = rand(0.9, 1.7);
      const dist = site.pos.distanceTo(tgt.pos);
      const tof = 0.6 + dist / 1400;
      const err = 55 + dist * 0.02;
      const bp = tgt.pos.clone().addScaledVector(tgt.vel, tof).add(new THREE.Vector3(rand(-err, err), rand(-err, err), rand(-err, err)));
      this.flak.push({ pos: bp, t: tof });
      for (let k = 0; k < 3; k++) {
        const dir = bp.clone().sub(site.pos).normalize();
        dir.x += rand(-0.02, 0.02); dir.z += rand(-0.02, 0.02);
        this.bullets.push({ pos: site.pos.clone(), prev: site.pos.clone(), vel: dir.normalize().multiplyScalar(dist / tof), life: tof, team: 1, owner: null, dmg: 0, visual: true });
      }
    }
    for (const f of this.flak) {
      f.t -= dt;
      if (f.t > 0) continue;
      g.fx.flak(f.pos);
      g.audio.playAt('explosion', f.pos, 0.35, 1.6);
      for (const a of blue) {
        const d = a.pos.distanceTo(f.pos);
        if (d < 45) a.damage(14 * (1 - d / 45) + 4, null);
      }
      if (g.player && g.player.alive) g.shakeAt(f.pos, 0.5);
      f.done = true;
    }
    this.flak = this.flak.filter((f) => !f.done);
  }
}
