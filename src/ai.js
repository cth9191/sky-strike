import * as THREE from 'three';
import { surfaceHeight } from './world.js';
import { clamp, rand } from './util.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

export class AIPilot {
  constructor(game, ac, opts = {}) {
    this.g = game;
    this.ac = ac;
    this.skill = opts.skill ?? 0.7;
    this.slot = opts.slot ?? null;
    this.target = null;
    this.retarget = 0;
    this.lockT = 0;
    this.missileCD = rand(3, 7);
    this.seed = Math.random() * 100;
    this.aim = new THREE.Vector3();
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.fire = false;
  }

  pickTarget() {
    const g = this.g, ac = this.ac;
    let best = null, bs = Infinity;
    const anchor = ac.team === 0 && g.player && g.player.alive ? g.player.pos : ac.pos;
    for (const o of g.aircraft) {
      if (!o.alive || o.team === ac.team) continue;
      let d = o.pos.distanceTo(ac.pos) * 0.6 + o.pos.distanceTo(anchor) * 0.4;
      if (ac.team === 1 && o.isPlayer) d *= 0.55;
      if (d < bs) { bs = d; best = o; }
    }
    this.target = best;
  }

  update(dt) {
    const g = this.g, ac = this.ac;
    if (!ac.alive) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || !this.target.alive) {
      this.pickTarget();
      this.retarget = rand(2, 4);
    }
    const f = ac.fwd(_f);
    const alt = ac.altitude();
    const look = _v.copy(ac.pos).addScaledVector(f, ac.speed * 4);
    const ahead = Math.max(surfaceHeight(look.x, look.z), surfaceHeight((look.x + ac.pos.x) / 2, (look.z + ac.pos.z) / 2));
    let throttle = 0.85, ab = false;
    this.fire = false;
    const threat = g.combat.missileThreat(ac);
    const aim = this.aim;
    const hd = Math.hypot(ac.pos.x, ac.pos.z);

    if (alt < 380 || look.y < ahead + 260) {
      aim.set(ac.pos.x + f.x * 1000, ac.pos.y + 900, ac.pos.z + f.z * 1000);
      ab = true;
    } else if (hd > 12500) {
      aim.set(0, 2000, 0);
    } else if (threat && threat.dist < 1700) {
      _v.copy(threat.m.pos).sub(ac.pos).normalize();
      _r.crossVectors(_v, new THREE.Vector3(0, 1, 0)).normalize();
      aim.copy(ac.pos).addScaledVector(_r, 1000).add(new THREE.Vector3(0, -150, 0));
      ab = true;
      if (threat.dist < 1300) g.combat.deployFlares(ac);
    } else if (this.target && (ac.team === 1 || this.target.pos.distanceTo(g.player?.alive ? g.player.pos : ac.pos) < 6500)) {
      const t = this.target;
      const d = ac.pos.distanceTo(t.pos);
      const tof = d / (ac.speed + 1000);
      aim.copy(t.pos).addScaledVector(t.vel, tof);
      const wob = (1 - this.skill) * d * 0.05;
      aim.x += Math.sin(g.time * 1.3 + this.seed) * wob;
      aim.y += Math.cos(g.time * 1.1 + this.seed) * wob;
      throttle = d > 2200 ? 1 : 0.8;
      ab = d > 3800;
      const ang = f.angleTo(_v.copy(aim).sub(ac.pos).normalize());
      if (ang < 0.06 + (1 - this.skill) * 0.03 && d < 1150) this.fire = true;
      if (ang < 0.26 && d > 650 && d < 3600) this.lockT += dt;
      else this.lockT = Math.max(0, this.lockT - dt * 2);
      this.missileCD -= dt;
      if (this.lockT > 1.6 && this.missileCD <= 0 && ac.missiles > 0) {
        g.combat.fireMissile(ac, t);
        this.missileCD = rand(7, 13) / (0.6 + this.skill);
        this.lockT = 0;
      }
    } else if (ac.team === 0 && g.player && g.player.alive && !g.player.onGround && g.player.altitude() > 120 && this.slot) {
      const p = g.player;
      const pf = p.fwd(new THREE.Vector3()), pr = p.right(new THREE.Vector3()), pu = p.up(new THREE.Vector3());
      const slot = new THREE.Vector3().copy(p.pos).addScaledVector(pr, this.slot.x).addScaledVector(pu, this.slot.y).addScaledVector(pf, this.slot.z);
      aim.copy(slot).addScaledVector(pf, 500);
      const along = _v.copy(slot).sub(ac.pos).dot(pf);
      throttle = clamp(p.throttle + along * 0.008, 0.3, 1);
      ab = along > 250;
    } else {
      const a = g.time * 0.05 + this.seed;
      const c = ac.team === 0 ? g.anchor : new THREE.Vector3(0, 0, -2500);
      aim.set(c.x + Math.cos(a) * 2500, 1500 + (this.seed % 5) * 120, c.z + Math.sin(a) * 2500);
    }

    ac.steer(aim, this.ctrl);
    const k = 0.55 + this.skill * 0.45;
    this.ctrl.pitch *= k;
    this.ctrl.roll *= Math.min(1, k + 0.15);
    ac.throttle += (throttle - ac.throttle) * Math.min(1, dt * 1.5);
    ac.ab = ab;
  }
}
