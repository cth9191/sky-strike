import * as THREE from 'three';
import { clamp } from './util.js';

const GREEN = 'rgba(140,255,160,0.95)';
const GREEN_DIM = 'rgba(140,255,160,0.45)';
const RED = 'rgba(255,90,70,0.95)';
const _p = new THREE.Vector3(), _v = new THREE.Vector3();

export class HUD {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.big = null;
    this.radios = [];
    this.hitT = 0;
    this.dmgFlash = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.c.width = this.w * dpr;
    this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  message(title, sub = '', dur = 2.6, color = GREEN) {
    this.big = { title, sub, t: dur, dur, color };
  }

  radio(text) {
    const last = this.radios[this.radios.length - 1];
    if (last && last.text === text) { last.t = 4.5; last.n = (last.n || 1) + 1; return; }
    this.radios.push({ text, t: 4.5 });
    if (this.radios.length > 5) this.radios.shift();
  }

  hitMarker() { this.hitT = 0.15; }
  damage(a) { this.dmgFlash = Math.min(1, this.dmgFlash + a / 40); }

  proj(v, cam) {
    _p.copy(v).project(cam);
    return { x: (_p.x + 1) * 0.5 * this.w, y: (1 - _p.y) * 0.5 * this.h, behind: _p.z > 1 };
  }

  clear() { this.ctx.clearRect(0, 0, this.w, this.h); }

  draw(g, dt) {
    const x = this.ctx, W = this.w, H = this.h;
    x.clearRect(0, 0, W, H);
    const p = g.player;
    const cam = g.camera;
    this.hitT -= dt;
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 0.8);

    if (this.dmgFlash > 0.01) {
      const grd = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
      grd.addColorStop(0, 'rgba(255,0,0,0)');
      grd.addColorStop(1, `rgba(200,0,0,${0.55 * this.dmgFlash})`);
      x.fillStyle = grd;
      x.fillRect(0, 0, W, H);
    }

    if (g.state === 'playing' && p && p.alive) this.drawFlight(g, p, cam, dt);

    // big center message
    if (this.big) {
      this.big.t -= dt;
      const b = this.big;
      if (b.t <= 0) this.big = null;
      else {
        const a = clamp(Math.min(b.t, b.dur - b.t) * 3, 0, 1);
        x.save();
        x.globalAlpha = a;
        x.textAlign = 'center';
        x.shadowColor = 'rgba(0,0,0,0.7)';
        x.shadowBlur = 10;
        x.fillStyle = b.color;
        x.font = '900 46px Orbitron, sans-serif';
        x.fillText(b.title, W / 2, H * 0.3);
        if (b.sub) {
          x.font = '700 20px Rajdhani, sans-serif';
          x.fillText(b.sub.toUpperCase(), W / 2, H * 0.3 + 34);
        }
        x.restore();
      }
    }

    // radio chatter
    x.save();
    x.font = '700 17px Rajdhani, sans-serif';
    x.textAlign = 'left';
    x.shadowColor = 'rgba(0,0,0,0.8)';
    x.shadowBlur = 6;
    let ry = H - 200;
    for (const r of this.radios) {
      r.t -= dt;
      x.globalAlpha = clamp(r.t, 0, 1);
      x.fillStyle = 'rgba(255,230,170,1)';
      x.fillText(r.n > 1 ? `${r.text}  x${r.n}` : r.text, 24, ry);
      ry += 22;
    }
    this.radios = this.radios.filter((r) => r.t > 0);
    x.restore();
  }

  drawFlight(g, p, cam, dt) {
    const x = this.ctx, W = this.w, H = this.h;
    x.save();
    x.strokeStyle = GREEN;
    x.fillStyle = GREEN;
    x.lineWidth = 1.6;
    x.shadowColor = 'rgba(40,255,90,0.55)';
    x.shadowBlur = 5;
    x.font = '700 15px Rajdhani, monospace';

    const fwd = p.fwd(new THREE.Vector3());
    // horizon + pitch ladder (relative to camera heading)
    const camF = cam.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(camF.x, -camF.z);
    x.save();
    x.strokeStyle = GREEN_DIM;
    x.fillStyle = GREEN_DIM;
    x.lineWidth = 1.2;
    x.textAlign = 'center';
    for (let pitch = -60; pitch <= 60; pitch += 10) {
      const pr = THREE.MathUtils.degToRad(pitch);
      const pts = [-4, -1.5, 1.5, 4].map((dy) => {
        const yy = yaw + THREE.MathUtils.degToRad(dy);
        _v.set(Math.sin(yy) * Math.cos(pr), Math.sin(pr), -Math.cos(yy) * Math.cos(pr)).multiplyScalar(5000).add(cam.position);
        return this.proj(_v, cam);
      });
      if (pts.some((q) => q.behind)) continue;
      if (pitch === 0) {
        x.setLineDash([]);
        x.beginPath();
        x.moveTo(pts[0].x - (pts[3].x - pts[0].x), pts[0].y - (pts[3].y - pts[0].y));
        x.lineTo(pts[3].x + (pts[3].x - pts[0].x), pts[3].y + (pts[3].y - pts[0].y));
        x.stroke();
      } else {
        x.setLineDash(pitch < 0 ? [6, 5] : []);
        x.beginPath();
        x.moveTo(pts[0].x, pts[0].y); x.lineTo(pts[1].x, pts[1].y);
        x.moveTo(pts[2].x, pts[2].y); x.lineTo(pts[3].x, pts[3].y);
        x.stroke();
        x.fillText(String(pitch), pts[3].x + 18, pts[3].y + 5);
      }
    }
    x.setLineDash([]);
    x.restore();

    // boresight (where the nose points) and the aim circle (where the mouse points)
    const bs = this.proj(_v.copy(p.pos).addScaledVector(fwd, 2000), cam);
    if (!bs.behind) {
      x.beginPath();
      x.moveTo(bs.x - 16, bs.y); x.lineTo(bs.x - 5, bs.y);
      x.moveTo(bs.x + 5, bs.y); x.lineTo(bs.x + 16, bs.y);
      x.moveTo(bs.x, bs.y - 5); x.lineTo(bs.x, bs.y - 12);
      x.stroke();
      x.beginPath(); x.arc(bs.x, bs.y, 2, 0, Math.PI * 2); x.fill();
    }
    const ap = this.proj(_v.copy(p.pos).addScaledVector(g.aimDir, 2000), cam);
    if (!ap.behind) {
      x.beginPath(); x.arc(ap.x, ap.y, 9, 0, Math.PI * 2); x.stroke();
    }
    if (this.hitT > 0) {
      x.save(); x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2;
      const c = bs.behind ? { x: W / 2, y: H / 2 } : bs;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.beginPath(); x.moveTo(c.x + sx * 8, c.y + sy * 8); x.lineTo(c.x + sx * 15, c.y + sy * 15); x.stroke(); }
      x.restore();
    }

    // targets
    for (const a of g.aircraft) {
      if (!a.alive || a === p) continue;
      const s = this.proj(a.pos, cam);
      const d = a.pos.distanceTo(p.pos);
      if (a.team === 1) {
        if (s.behind || s.x < 0 || s.x > W || s.y < 0 || s.y > H) {
          if (d < 9000) this.edgeArrow(s, a, cam, RED);
          continue;
        }
        const sz = clamp(1600 / d * 10, 12, 38);
        x.save();
        x.strokeStyle = RED; x.fillStyle = RED; x.shadowColor = 'rgba(255,60,40,0.5)';
        x.strokeRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
        x.textAlign = 'center';
        x.font = '700 13px Rajdhani, monospace';
        x.fillText((d / 1000).toFixed(1) + ' km', s.x, s.y + sz + 14);
        if (g.lockTarget === a) {
          const k = g.locked ? 1 : g.lockProgress;
          const rr = sz + 30 * (1 - k) + 6;
          x.lineWidth = 2;
          x.beginPath();
          x.moveTo(s.x, s.y - rr); x.lineTo(s.x + rr, s.y); x.lineTo(s.x, s.y + rr); x.lineTo(s.x - rr, s.y); x.closePath();
          x.stroke();
          if (g.locked) { x.font = '900 14px Orbitron, sans-serif'; x.fillText('LOCK', s.x, s.y - rr - 8); }
          // gun lead pip
          const tof = d / 1050;
          const lp = this.proj(_v.copy(a.pos).addScaledVector(a.vel, tof), cam);
          if (!lp.behind && d < 1800) { x.beginPath(); x.arc(lp.x, lp.y, 5, 0, Math.PI * 2); x.stroke(); }
        }
        x.restore();
      } else if (!s.behind) {
        x.save();
        x.fillStyle = 'rgba(120,200,255,0.9)';
        x.shadowColor = 'rgba(0,0,0,0.6)';
        x.beginPath(); x.moveTo(s.x, s.y - 7); x.lineTo(s.x + 6, s.y + 4); x.lineTo(s.x - 6, s.y + 4); x.closePath(); x.fill();
        x.textAlign = 'center';
        x.font = '700 12px Rajdhani, monospace';
        x.fillText(a.callsign, s.x, s.y - 11);
        x.restore();
      }
    }

    // speed / altitude boxes
    const kmh = Math.round(p.speed * 3.6);
    const alt = Math.round(p.pos.y);
    x.textAlign = 'center';
    x.font = '700 22px Rajdhani, monospace';
    x.strokeRect(W / 2 - 300, H / 2 - 16, 92, 32);
    x.fillText(String(kmh), W / 2 - 254, H / 2 + 8);
    x.strokeRect(W / 2 + 208, H / 2 - 16, 92, 32);
    x.fillText(String(alt), W / 2 + 254, H / 2 + 8);
    x.font = '700 13px Rajdhani, monospace';
    x.fillText('KM/H', W / 2 - 254, H / 2 - 24);
    x.fillText('ALT M', W / 2 + 254, H / 2 - 24);
    x.textAlign = 'left';
    x.fillText(`G ${Math.min(11, 1 + (p.G - 1) * 0.5).toFixed(1)}`, W / 2 - 300, H / 2 + 40);
    x.fillText(`M ${(p.speed / 340).toFixed(2)}`, W / 2 - 300, H / 2 + 58);
    x.fillText(`AGL ${Math.round(p.altitude())}`, W / 2 + 208, H / 2 + 40);

    // heading tape
    const hdg = (THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z)) + 360) % 360;
    x.save();
    x.beginPath(); x.rect(W / 2 - 180, 18, 360, 40); x.clip();
    x.textAlign = 'center';
    for (let dgr = Math.floor(hdg / 10) * 10 - 40; dgr <= hdg + 40; dgr += 10) {
      const sx = W / 2 + (dgr - hdg) * 4.2;
      const lbl = ((dgr % 360) + 360) % 360;
      x.beginPath(); x.moveTo(sx, 44); x.lineTo(sx, lbl % 30 === 0 ? 32 : 38); x.stroke();
      if (lbl % 30 === 0) x.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[lbl] ?? String(lbl / 10), sx, 28);
    }
    x.restore();
    x.beginPath(); x.moveTo(W / 2, 48); x.lineTo(W / 2 - 6, 56); x.lineTo(W / 2 + 6, 56); x.closePath(); x.fill();

    // throttle
    const tx = 40, ty = H - 170;
    x.strokeRect(tx, ty, 14, 120);
    const th = p.throttle * 120;
    x.fillStyle = p.abLevel > 0.5 ? 'rgba(255,170,60,0.95)' : GREEN;
    x.fillRect(tx + 2, ty + 120 - th, 10, th);
    x.fillStyle = GREEN;
    x.fillText(p.abLevel > 0.5 ? 'AB' : 'THR', tx - 2, ty - 8);

    // weapons + health
    x.textAlign = 'center';
    x.font = '700 18px Rajdhani, monospace';
    x.fillText(`MSL ${p.missiles}    FLR ${p.flares}    GUN`, W / 2 - 10, H - 46);
    x.strokeRect(W / 2 + 92, H - 60, 60, 10);
    x.fillStyle = p.overheat ? RED : GREEN;
    x.fillRect(W / 2 + 93, H - 59, 58 * clamp(1 - p.gunHeat, 0, 1), 8);
    x.fillStyle = GREEN;
    x.strokeRect(W / 2 - 110, H - 30, 220, 8);
    x.fillStyle = p.health > 50 ? GREEN : p.health > 25 ? 'rgba(255,200,60,0.95)' : RED;
    x.fillRect(W / 2 - 109, H - 29, 218 * clamp(p.health / 100, 0, 1), 6);

    // score / wave
    x.fillStyle = GREEN;
    x.textAlign = 'left';
    x.font = '700 18px Rajdhani, monospace';
    x.fillText(`SCORE  ${g.score}`, 24, 34);
    x.fillText(`WAVE ${g.wave}   HOSTILES ${g.hostiles()}   FRIENDLIES ${g.friendlies()}`, 24, 58);

    // radar
    this.radar(g, p, fwd);

    // warnings
    const warns = [];
    if (g.combat.missileThreat(p)) warns.push('MISSILE WARNING');
    const vs = p.vel.y;
    if (!p.onGround && (p.altitude() < 140 || (vs < -20 && p.altitude() / -vs < 4))) warns.push('PULL UP');
    if (!p.onGround && p.speed < 80) warns.push('STALL');
    if (Math.hypot(p.pos.x, p.pos.z) > 13000) warns.push('RETURN TO COMBAT AREA');
    if (warns.length && Math.floor(g.time * 4) % 2 === 0) {
      x.fillStyle = RED;
      x.shadowColor = 'rgba(255,0,0,0.6)';
      x.textAlign = 'center';
      x.font = '900 22px Orbitron, sans-serif';
      warns.forEach((w, i) => x.fillText(w, W / 2, H * 0.62 + i * 30));
    }
    x.restore();
  }

  edgeArrow(s, a, cam, color) {
    const x = this.ctx, W = this.w, H = this.h;
    let dx = s.x - W / 2, dy = s.y - H / 2;
    if (s.behind) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx);
    const r = Math.min(W, H) * 0.42;
    const px = W / 2 + Math.cos(ang) * r, py = H / 2 + Math.sin(ang) * r;
    x.save();
    x.translate(px, py);
    x.rotate(ang);
    x.fillStyle = color;
    x.beginPath(); x.moveTo(12, 0); x.lineTo(-6, -8); x.lineTo(-6, 8); x.closePath(); x.fill();
    x.restore();
  }

  radar(g, p, fwd) {
    const x = this.ctx, W = this.w, H = this.h;
    const R = 88, cx = W - R - 30, cy = H - R - 30, range = 9000;
    x.save();
    x.fillStyle = 'rgba(0,20,8,0.35)';
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill(); x.stroke();
    x.strokeStyle = GREEN_DIM;
    x.beginPath(); x.arc(cx, cy, R / 2, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.stroke();
    const hd = Math.atan2(fwd.x, -fwd.z);
    const blip = (pos, col, size) => {
      const dx = pos.x - p.pos.x, dz = pos.z - p.pos.z;
      const rx = dx * Math.cos(hd) + dz * Math.sin(hd);
      const rz = -dx * Math.sin(hd) + dz * Math.cos(hd);
      const d = Math.hypot(rx, rz);
      if (d > range) return;
      x.fillStyle = col;
      x.fillRect(cx + (rx / range) * R - size / 2, cy + (rz / range) * R - size / 2, size, size);
    };
    for (const a of g.aircraft) if (a.alive && a !== p) blip(a.pos, a.team === 1 ? RED : 'rgba(120,200,255,0.95)', 5);
    for (const m of g.combat.missiles) blip(m.pos, 'rgba(255,230,120,0.95)', 3);
    blip({ x: 0, z: 0 }, 'rgba(255,255,255,0.35)', 4);
    x.fillStyle = GREEN;
    x.beginPath(); x.moveTo(cx, cy - 6); x.lineTo(cx + 4, cy + 4); x.lineTo(cx - 4, cy + 4); x.closePath(); x.fill();
    x.restore();
  }
}
