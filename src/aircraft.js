import * as THREE from 'three';
import { groundHeight, surfaceHeight, onRunway } from './world.js';
import { clamp, lerp, rand } from './util.js';

const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
let SERIAL = 0;

export class Aircraft {
  constructor(game, o) {
    this.g = game;
    this.id = SERIAL++;
    this.team = o.team;
    this.isPlayer = !!o.isPlayer;
    this.callsign = o.callsign || '';
    this.info = o.model.info;
    this.radius = this.info.length * 0.62;
    this.group = new THREE.Group();
    this.model = o.model.template.clone(true);
    this.group.add(this.model);
    game.scene.add(this.group);
    this.pos = this.group.position;
    this.quat = this.group.quaternion;
    this.vel = new THREE.Vector3();
    this.speed = 200;
    this.throttle = 0.8;
    this.ab = false;
    this.abLevel = 0;
    this.rp = 0; this.rr = 0; this.ry = 0;
    this.G = 1;
    const perf = o.perf || {};
    this.maxP = perf.pitch ?? 1.25;
    this.maxR = perf.roll ?? 3.2;
    this.maxY = perf.yaw ?? 0.35;
    this.thrust = perf.thrust ?? 34;
    this.abThrust = perf.ab ?? 30;
    this.health = 100;
    this.alive = true;
    this.wreck = false;
    this.removed = false;
    this.onGround = false;
    this.missiles = o.missiles ?? 4;
    this.flares = o.flares ?? 8;
    this.gunHeat = 0;
    this.overheat = false;
    this.gunTimer = 0;
    this.lastAttacker = null;
    this.lastHit = -10;
    this.smokeT = 0;
    const L = this.info.length, span = this.info.span;
    this.nozzle = new THREE.Vector3(0, 0, L * 0.52);
    this.glow = new THREE.Sprite(game.glowMat);
    this.glow.position.copy(this.nozzle);
    this.group.add(this.glow);
    this.tipL = new THREE.Vector3(-span * 0.48, 0, L * 0.28);
    this.tipR = new THREE.Vector3(span * 0.48, 0, L * 0.28);
    this.trailL = game.trails.create(0.4, 0.9, 0.38, 1.2);
    this.trailR = game.trails.create(0.4, 0.9, 0.38, 1.2);
    this.contrail = game.trails.create(1.1, 5, 0.18, 1.3);
    this.wreckSpin = new THREE.Vector3();
  }

  fwd(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  altitude() { return this.pos.y - Math.max(0, groundHeight(this.pos.x, this.pos.z)); }

  // Mouse-aim style steering: returns stick inputs that fly the nose toward a point.
  steer(target, out = { pitch: 0, roll: 0, yaw: 0 }) {
    _qi.copy(this.quat).invert();
    const local = _v.copy(target).sub(this.pos).applyQuaternion(_qi).normalize();
    const ang = Math.acos(clamp(-local.z, -1, 1));
    const s = 4.5;
    let pitch = clamp(local.y * s, -1, 1);
    const yaw = clamp(local.x * s, -1, 1);
    const aggressive = clamp(local.x * s, -1, 1);
    const level = clamp(this.right(_v2).y * 2.5, -1, 1);
    const infl = clamp(ang / 0.16, 0, 1);
    let roll = lerp(level, aggressive, infl);
    if (local.z > 0.25) {
      pitch = 1;
      roll = Math.abs(local.x) > 0.04 ? Math.sign(local.x) : 0.6;
    }
    out.pitch = pitch;
    out.roll = roll;
    out.yaw = yaw * 0.6;
    return out;
  }

  update(dt, ctrl) {
    if (this.wreck) return this.updateWreck(dt);
    if (!this.alive) return;
    const auth = clamp((this.speed - 45) / 110, 0.12, 1) * (this.speed > 430 ? 0.8 : 1);
    let tp = ctrl.pitch * this.maxP * auth, tr = ctrl.roll * this.maxR * auth, ty = ctrl.yaw * this.maxY * auth;
    const stall = !this.onGround && this.speed < 72;
    if (stall) tp = Math.min(tp, 0.1) - 0.35;
    if (this.onGround) {
      tr = 0;
      tp = this.speed < 78 ? 0 : Math.max(tp, 0);
    }
    this.rp += (tp - this.rp) * Math.min(1, dt * 5);
    this.rr += (tr - this.rr) * Math.min(1, dt * 7);
    this.ry += (ty - this.ry) * Math.min(1, dt * 5);
    _q.setFromAxisAngle(AX, this.rp * dt); this.quat.multiply(_q);
    _q.setFromAxisAngle(AZ, -this.rr * dt); this.quat.multiply(_q);
    _q.setFromAxisAngle(AY, -this.ry * dt); this.quat.multiply(_q);
    this.quat.normalize();

    const f = this.fwd(_v3);
    this.abLevel = lerp(this.abLevel, this.ab ? 1 : 0, Math.min(1, dt * 4));
    const thrust = this.throttle * this.thrust + this.abLevel * this.abThrust;
    const drag = 0.00031 * this.speed * this.speed;
    this.G = lerp(this.G, 1 + (this.rp * this.speed) / 9.81, Math.min(1, dt * 6));
    const induced = 0.22 * Math.pow(Math.max(0, Math.abs(this.G) - 1), 1.6);
    this.speed += (thrust - drag - 9.81 * f.y - induced) * dt;
    if (this.onGround) this.speed -= 2 * dt;
    this.speed = Math.max(0, this.speed);
    this.vel.copy(f).multiplyScalar(this.speed);
    if (!this.onGround && this.speed < 115) this.vel.y -= (115 - this.speed) * 0.45;
    this.pos.addScaledVector(this.vel, dt);

    const rw = onRunway(this.pos.x, this.pos.z);
    const gh = rw ? Math.max(3.3, groundHeight(this.pos.x, this.pos.z)) : surfaceHeight(this.pos.x, this.pos.z);
    const gear = Math.max(this.info.height * 0.5, 1) + 0.5;
    if (this.pos.y - gear <= gh) {
      const pitchAng = Math.asin(clamp(f.y, -1, 1));
      const rightY = this.right(_v2).y;
      if (this.isPlayer && rw && this.speed < 150 && pitchAng > -0.14 && Math.abs(rightY) < 0.35) {
        this.pos.y = gh + gear;
        this.onGround = true;
        const yaw = Math.atan2(-f.x, -f.z);
        this.quat.setFromEuler(new THREE.Euler(Math.max(0, pitchAng), yaw, 0, 'YXZ'));
        this.rr = 0;
        if (this.rp < 0) this.rp = 0;
      } else {
        this.crash();
        return;
      }
    } else if (this.onGround && this.pos.y - gear > gh + 0.6) {
      this.onGround = false;
    }
    this.visuals(dt);
  }

  visuals(dt) {
    const t = this.g.time;
    const L = this.info.length;
    const flick = 0.85 + Math.random() * 0.3;
    const glow = (this.throttle * 0.08 + this.abLevel * 0.24) * L * flick;
    this.glow.scale.set(glow, glow, 1);
    this.glow.visible = glow > 0.2;
    if (this.abLevel > 0.3 && Math.random() < 0.35) {
      _v.copy(this.nozzle).applyQuaternion(this.quat).add(this.pos);
      this.g.fx.flame(_v, L * 0.08 * this.abLevel, this.vel.clone().multiplyScalar(0.6));
    }
    const vapor = clamp((Math.abs(this.G) - 3.5) / 3, 0, 1) * clamp((this.speed - 120) / 80, 0, 1);
    _v.copy(this.tipL).applyQuaternion(this.quat).add(this.pos);
    this.g.trails.push(this.trailL, _v, t, vapor);
    _v.copy(this.tipR).applyQuaternion(this.quat).add(this.pos);
    this.g.trails.push(this.trailR, _v, t, vapor);
    const contrail = clamp((this.pos.y - 1500) / 500, 0, 1) * clamp(this.throttle + this.abLevel, 0, 1);
    _v.copy(this.nozzle).applyQuaternion(this.quat).add(this.pos);
    this.g.trails.push(this.contrail, _v, t, contrail);
    if (this.health < 55) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.04;
        this.g.fx.trailSmoke(_v, L * 0.25, 3.5, true);
        if (this.health < 30) this.g.fx.fire(_v, L * 0.05);
      }
    }
  }

  damage(amount, attacker) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastAttacker = attacker;
    this.lastHit = this.g.time;
    if (this.isPlayer) this.g.onPlayerHit(amount);
    if (this.health <= 0) this.kill(attacker);
  }

  kill(attacker) {
    if (!this.alive) return;
    this.alive = false;
    this.wreck = true;
    this.wreckSpin.set(rand(-1.5, 1.5), rand(-0.6, 0.6), rand(-3, 3));
    this.glow.visible = false;
    this.stopTrails();
    this.g.fx.explosion(this.pos, 0.75, this.vel);
    this.g.audio.explosionAt(this.pos, 0.9);
    this.g.onKilled(this, attacker);
  }

  crash() {
    const wasAlive = this.alive;
    this.alive = false;
    this.wreck = false;
    this.g.fx.explosion(this.pos, 1.3);
    this.g.fx.dust(this.pos, 1.5);
    this.g.audio.explosionAt(this.pos, 1.2);
    this.g.shakeAt(this.pos, 2);
    this.remove();
    if (wasAlive) {
      const recent = this.lastAttacker && this.g.time - this.lastHit < 6 ? this.lastAttacker : null;
      this.g.onKilled(this, recent, true);
    }
  }

  updateWreck(dt) {
    this.vel.y -= 9.81 * dt * 1.6;
    this.vel.multiplyScalar(1 - 0.12 * dt);
    this.pos.addScaledVector(this.vel, dt);
    _q.setFromEuler(new THREE.Euler(this.wreckSpin.x * dt, this.wreckSpin.y * dt, this.wreckSpin.z * dt));
    this.quat.multiply(_q);
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.03;
      this.g.fx.fire(this.pos, this.info.length * 0.09);
    }
    if (this.pos.y <= surfaceHeight(this.pos.x, this.pos.z) + 2) {
      this.wreck = false;
      this.g.fx.explosion(this.pos, 1.2);
      this.g.fx.dust(this.pos, 1.3);
      this.g.audio.explosionAt(this.pos, 1.0);
      this.g.shakeAt(this.pos, 1.5);
      this.remove();
    }
  }

  stopTrails() {
    this.trailL.alive = this.trailR.alive = this.contrail.alive = false;
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.stopTrails();
    this.g.scene.remove(this.group);
  }
}
