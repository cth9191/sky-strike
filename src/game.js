import * as THREE from 'three';
import { Aircraft } from './aircraft.js';
import { AIPilot } from './ai.js';
import { Combat } from './combat.js';
import { AIRBASE, groundHeight, surfaceHeight } from './world.js';
import { clamp, rand } from './util.js';

const BLUE = ['VIPER', 'FALCON', 'GHOST', 'RAVEN', 'SABER', 'LANCER', 'COBRA', 'HAWK'];
const SLOTS = [
  { x: -45, y: -5, z: 35 }, { x: 45, y: -5, z: 35 },
  { x: -90, y: -10, z: 70 }, { x: 90, y: -10, z: 70 },
];
const UP = new THREE.Vector3(0, 1, 0);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,220,180,0.8)');
  g.addColorStop(0.55, 'rgba(255,140,60,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Game {
  constructor(o) {
    Object.assign(this, o);
    this.state = 'title';
    this.time = 0;
    this.titleT = 0;
    this.aircraft = [];
    this.pilots = [];
    this.combat = new Combat(this);
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.camDir = new THREE.Vector3(0, 0, -1);
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.keys = new Set();
    this.pressed = new Set();
    this.lmb = false;
    this.camMode = 0;
    this.shake = 0;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.anchor = new THREE.Vector3(AIRBASE.x, 0, AIRBASE.z - 2600);
    this.focus = new THREE.Vector3(0, 0, -800);
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.8, 1.0, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.lockTarget = null;
    this.lockProgress = 0;
    this.locked = false;
    this.freeMouse = false;
    this._ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.bindInput();
  }

  bindInput() {
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || this.autopilot) return;
      if (document.pointerLockElement !== this.canvas && !this.freeMouse) return;
      this.aimYaw -= e.movementX * 0.0022;
      this.aimPitch = clamp(this.aimPitch - e.movementY * 0.0022, -1.45, 1.45);
    });
    addEventListener('mousedown', (e) => {
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.pressed.add('Mouse2');
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.lmb = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  clearAll() {
    for (const a of this.aircraft) a.remove();
    this.aircraft = [];
    this.pilots = [];
    this.combat.clear();
    this.lockTarget = null;
    this.locked = false;
    this.lockProgress = 0;
  }

  spawn(o) {
    const a = new Aircraft(this, o);
    this.aircraft.push(a);
    return a;
  }

  start(autopilot = false) {
    this.clearAll();
    this.autopilot = autopilot;
    this.state = 'playing';
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.waveTimer = 8;
    this.betweenWaves = false;
    this.deadTimer = 0;
    this.deathPos = null;
    const z0 = AIRBASE.z + AIRBASE.len / 2 - 160;
    const p = this.spawn({ team: 0, isPlayer: true, model: this.models.player, callsign: 'YOU', missiles: 16, flares: 30, perf: { pitch: 1.4, roll: 3.4, yaw: 0.4, thrust: 36, ab: 32 } });
    p.pos.set(AIRBASE.x, Math.max(3.3, groundHeight(AIRBASE.x, z0)) + Math.max(p.info.height * 0.5, 1) + 0.5, z0);
    p.quat.identity();
    p.speed = 25;
    p.throttle = 1;
    p.onGround = true;
    this.player = p;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.aimDir.set(0, 0, -1);
    this.camDir.set(0, 0, -1);
    if (autopilot) {
      this.playerPilot = new AIPilot(this, p, { skill: 0.95 });
      p.pos.set(AIRBASE.x, 900, AIRBASE.z - 2500);
      p.onGround = false;
      p.speed = 240;
      this.waveTimer = 2;
    }
    for (let i = 0; i < 4; i++) this.spawnWingman(i, true);
    this.camSnap = true;
    this.hud.message('SKY STRIKE', 'Take off — hostiles inbound from the north', 4);
    this.hud.radio('TOWER: Viper flight, cleared for takeoff.');
    this.audio.startFlight();
  }

  spawnWingman(i, initial) {
    const a = this.spawn({ team: 0, model: this.models.player, callsign: BLUE[i % BLUE.length], missiles: 6, flares: 10, perf: { pitch: 1.2, roll: 3.0, thrust: 34, ab: 30 } });
    if (initial || !this.player.alive) a.pos.set(AIRBASE.x + (i - 1.5) * 140, 700 + i * 40, AIRBASE.z - 1900 - i * 90);
    else a.pos.copy(this.player.pos).add(new THREE.Vector3(rand(-600, 600), 150, 900));
    a.quat.identity();
    a.speed = 215;
    this.pilots.push(new AIPilot(this, a, { skill: 0.82, slot: SLOTS[i % 4] }));
  }

  spawnWave() {
    this.wave++;
    const count = Math.min(3 + this.wave * 2, 16);
    for (let i = 0; i < count; i++) {
      const e = this.spawn({ team: 1, model: this.models.enemy, callsign: 'BANDIT', missiles: 2 + Math.floor(this.wave / 2), flares: 4, perf: { pitch: 1.05 + 0.03 * this.wave, roll: 2.8, thrust: 33, ab: 28 } });
      e.pos.set(rand(-3500, 3500), rand(1600, 3000), -8500 - rand(0, 2500));
      e.quat.setFromAxisAngle(UP, Math.PI);
      e.speed = 240;
      this.pilots.push(new AIPilot(this, e, { skill: Math.min(0.92, 0.5 + this.wave * 0.07) }));
    }
    this.hud.message(`WAVE ${this.wave}`, count >= 9 ? 'Massive raid inbound' : `${count} hostiles in the air`, 3, 'rgba(255,120,90,0.95)');
    this.hud.radio(`AWACS: ${count} bandits, bearing north. Engage.`);
  }

  hostiles() { return this.aircraft.filter((a) => a.alive && a.team === 1).length; }
  friendlies() { return this.aircraft.filter((a) => a.alive && a.team === 0 && !a.isPlayer).length; }

  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }

  onKilled(victim, attacker, crashed = false) {
    if (victim.team === 1) {
      if (attacker && attacker.isPlayer) {
        this.score += 100;
        this.kills++;
        this.hud.message('SPLASH ONE', '+100  target destroyed', 1.8);
      } else if (attacker && attacker.team === 0) {
        this.score += 25;
        this.hud.radio(`${attacker.callsign}: Splash one!`);
      } else if (crashed) {
        this.hud.radio('AWACS: Bandit went down.');
      }
    } else if (!victim.isPlayer) {
      this.hud.radio(`${victim.callsign} is down!`);
    }
    if (victim === this.lockTarget) { this.lockTarget = null; this.locked = false; }
    if (victim.isPlayer) {
      this.deathPos = victim.pos.clone();
      this.deadTimer = 0.001;
      this.audio.gunStop();
      this.hud.message(crashed && !attacker ? 'CRASHED' : 'SHOT DOWN', '', 3, 'rgba(255,90,70,0.95)');
    }
  }

  onPlayerHit(amount) {
    this.hud.damage(amount);
    this.shake = Math.max(this.shake, Math.min(1.2, amount * 0.04));
  }

  shakeAt(pos, s) {
    const d = pos.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, s * clamp(1 - d / 1500, 0, 1));
  }

  playerControls(dt) {
    const k = this.keys, p = this.player;
    if (k.has('KeyW')) p.throttle = Math.min(1, p.throttle + dt * 0.6);
    if (k.has('KeyS')) p.throttle = Math.max(0, p.throttle - dt * 0.6);
    p.ab = k.has('ShiftLeft') || k.has('ShiftRight');
    const manual = k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight');
    let ctrl = this._ctrl;
    if (manual) {
      ctrl.pitch = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
      ctrl.roll = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
      ctrl.yaw = 0;
      const f = p.fwd();
      this.aimYaw = Math.atan2(-f.x, -f.z);
      this.aimPitch = Math.asin(clamp(f.y, -1, 1));
    }
    this.aimDir.set(-Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    if (!manual) p.steer(p.pos.clone().addScaledVector(this.aimDir, 1500), ctrl);
    ctrl.roll = clamp(ctrl.roll + (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), -1, 1);
    ctrl.yaw = clamp(ctrl.yaw + (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0), -1, 1);
    return ctrl;
  }

  updateLock(dt, dir) {
    const p = this.player;
    const ang = (a) => dir.angleTo(new THREE.Vector3().subVectors(a.pos, p.pos).normalize());
    const cur = this.lockTarget;
    if (cur && cur.alive && ang(cur) < 0.3 && cur.pos.distanceTo(p.pos) < 5500) {
      this.lockProgress = Math.min(1, this.lockProgress + dt / 0.9);
      this.locked = this.lockProgress >= 1;
      return;
    }
    let best = null, ba = 0.2;
    for (const a of this.aircraft) {
      if (!a.alive || a.team !== 1 || a.pos.distanceTo(p.pos) > 5000) continue;
      const an = ang(a);
      if (an < ba) { ba = an; best = a; }
    }
    this.lockTarget = best;
    this.lockProgress = 0;
    this.locked = false;
  }

  update(dt) {
    if (this.state === 'title') {
      this.titleT += dt;
      this.titleCamera();
      return;
    }
    if (this.state === 'paused') return;
    this.time += dt;
    const p = this.player;

    if (p.alive) {
      let ctrl, fire = false;
      if (this.autopilot) {
        this.playerPilot.update(dt);
        ctrl = this.playerPilot.ctrl;
        fire = this.playerPilot.fire;
      } else {
        ctrl = this.playerControls(dt);
        fire = this.lmb || this.keys.has('ControlLeft');
      }
      p.update(dt, ctrl);
      if (p.alive) {
        if (fire && !p.onGround) {
          if (this.combat.fireGun(p, dt)) this.audio.gunStart();
          else this.audio.gunStop();
        } else {
          this.audio.gunStop();
          p.gunTimer = 0;
        }
        this.updateLock(dt, this.autopilot ? p.fwd() : this.aimDir);
        if (!this.autopilot) {
          if (this.pressed.has('Mouse2') || this.pressed.has('Space')) {
            if (!p.onGround) this.combat.fireMissile(p, this.locked ? this.lockTarget : null);
          }
          if (this.pressed.has('KeyF')) this.combat.deployFlares(p);
        } else if (this.locked && Math.random() < dt * 0.3) {
          this.combat.fireMissile(p, this.lockTarget);
        }
      }
    } else if (p.wreck) {
      p.update(dt);
    }
    if (this.pressed.has('KeyC')) this.camMode = 1 - this.camMode;
    this.pressed.clear();

    for (const pl of this.pilots) {
      const a = pl.ac;
      if (a.alive) {
        pl.update(dt);
        a.update(dt, pl.ctrl);
        if (pl.fire && a.alive) this.combat.fireGun(a, dt);
        else a.gunTimer = 0;
      } else if (a.wreck) a.update(dt);
    }
    this.pilots = this.pilots.filter((pl) => !pl.ac.removed);
    for (const a of this.aircraft) {
      a.gunHeat = Math.max(0, a.gunHeat - dt * 0.22);
      if (a.overheat && a.gunHeat < 0.35) a.overheat = false;
    }
    this.combat.update(dt);
    this.aircraft = this.aircraft.filter((a) => !a.removed || a === this.player);

    // waves
    if (this.hostiles() === 0) {
      if (!this.betweenWaves) {
        this.betweenWaves = true;
        if (this.wave > 0) {
          this.waveTimer = 7;
          const bonus = 250 * this.wave;
          this.score += bonus;
          this.hud.message('WAVE CLEARED', `+${bonus} bonus`, 3);
          let added = 0;
          for (let i = 0; this.friendlies() < 4 && i < 8; i++) { this.spawnWingman(this.friendlies() + added, false); added++; }
          if (added) this.hud.radio('AWACS: Reinforcements joined the flight.');
        }
      }
      this.waveTimer -= dt;
      if (this.waveTimer <= 0 && (p.alive || this.state === 'dead')) {
        this.spawnWave();
        this.betweenWaves = false;
      }
    }

    if (this.deadTimer > 0) {
      this.deadTimer += dt;
      if (this.deadTimer > 3.5 && this.state === 'playing') {
        this.state = 'dead';
        this.onDead?.({ title: 'SHOT DOWN', score: this.score, kills: this.kills, wave: this.wave });
      }
    }

    this.updateCamera(dt);
    this.audio.listener = this.camera.position;
    this.audio.update(p, this, dt);
  }

  titleCamera() {
    const t = this.titleT * 0.035 + 0.6;
    const cam = this.camera;
    cam.position.set(Math.cos(t) * 4600 - 300, 620 + Math.sin(t * 0.7) * 160, Math.sin(t) * 4600 - 900);
    cam.up.copy(UP);
    cam.lookAt(-250, 170, -950);
    cam.fov = 58;
    cam.updateProjectionMatrix();
    this.focus.set(-250, 0, -950);
  }

  updateCamera(dt) {
    const cam = this.camera, p = this.player;
    let targetFov = 62;
    if (p.alive) {
      const L = p.info.length;
      if (this.autopilot) this.camDir.lerp(p.fwd(), Math.min(1, dt * 2.5)).normalize();
      else this.camDir.copy(this.aimDir);
      if (this.camMode === 0) {
        const dist = L * 1.5 + 4, h = L * 0.62;
        const desired = p.pos.clone().addScaledVector(this.camDir, -dist).addScaledVector(UP, h);
        if (this.camSnap) { cam.position.copy(desired); this.camSnap = false; }
        else cam.position.lerp(desired, 1 - Math.exp(-dt * 14));
        cam.up.copy(UP);
        cam.lookAt(p.pos.clone().addScaledVector(this.camDir, 320).addScaledVector(UP, -h * 0.35));
      } else {
        cam.position.copy(p.pos).addScaledVector(p.up(), p.info.height * 0.9 + 0.6).addScaledVector(p.fwd(), -L * 0.12);
        cam.quaternion.copy(p.quat);
      }
      targetFov = 60 + clamp((p.speed - 150) / 300, 0, 1) * 14 + p.abLevel * 5;
      this.focus.copy(p.pos);
    } else if (this.deathPos) {
      const c = p.wreck ? p.pos : this.deathPos;
      const t = this.deadTimer * 0.35;
      cam.position.set(c.x + Math.cos(t) * 160, c.y + 60, c.z + Math.sin(t) * 160);
      cam.up.copy(UP);
      cam.lookAt(c);
      this.focus.copy(c);
    }
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3);
    if (this.shake > 0.01) {
      const s = this.shake;
      cam.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(s * 1.6));
      this.shake *= Math.exp(-dt * 5);
    }
    const floor = surfaceHeight(cam.position.x, cam.position.z) + 3;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.updateProjectionMatrix();
  }
}
