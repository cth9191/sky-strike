// Web Audio mixer for the Higgsfield-generated sound effects + music.
const FILES = {
  engine: '/audio/engine.mp3',
  afterburner: '/audio/afterburner.mp3',
  cannon: '/audio/cannon.mp3',
  missile: '/audio/missile.mp3',
  explosion: '/audio/explosion.mp3',
  music: '/audio/music.m4a',
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.ready = false;
    this.listener = null;
  }

  async init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.2;
    this.musicBus.connect(this.master);
    await Promise.all(
      Object.entries(FILES).map(async ([k, url]) => {
        try {
          const r = await fetch(url);
          this.buf[k] = await ctx.decodeAudioData(await r.arrayBuffer());
        } catch (e) {
          console.warn('audio failed', k, e);
        }
      })
    );
    // synthesized wind + tones
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }
    this.noise = nb;
    this.ready = true;
  }

  loop(name, gain, rate = 1, trim = 0.35) {
    const b = this.buf[name];
    if (!b) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.loopStart = Math.min(trim, b.duration * 0.2);
    src.loopEnd = Math.max(src.loopStart + 0.2, b.duration - trim);
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfx);
    src.start(0, src.loopStart);
    return { src, g };
  }

  startFlight() {
    if (!this.ready) return;
    this.stopFlight();
    this.eng = this.loop('engine', 0.0);
    this.abSnd = this.loop('afterburner', 0.0);
    const w = this.ctx.createBufferSource();
    w.buffer = this.noise;
    w.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const wg = this.ctx.createGain();
    wg.gain.value = 0;
    w.connect(f).connect(wg).connect(this.sfx);
    w.start();
    this.wind = { src: w, g: wg, f };
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    const og = this.ctx.createGain();
    og.gain.value = 0;
    osc.connect(og).connect(this.sfx);
    osc.start();
    this.tone = { osc, g: og };
    const wo = this.ctx.createOscillator();
    wo.type = 'sawtooth';
    wo.frequency.value = 1450;
    const wog = this.ctx.createGain();
    wog.gain.value = 0;
    wo.connect(wog).connect(this.sfx);
    wo.start();
    this.warn = { osc: wo, g: wog };
    if (this.buf.music && !this.music) {
      const m = this.ctx.createBufferSource();
      m.buffer = this.buf.music;
      m.loop = true;
      m.connect(this.musicBus);
      m.start();
      this.music = m;
    }
  }

  stopFlight() {
    for (const k of ['eng', 'abSnd', 'wind', 'tone', 'warn']) {
      const s = this[k];
      if (!s) continue;
      try { (s.src || s.osc).stop(); } catch {}
      this[k] = null;
    }
    this.gunStop();
  }

  update(player, g, dt) {
    if (!this.ready || !this.eng) return;
    const t = this.ctx.currentTime;
    const alive = player && player.alive;
    const thr = alive ? player.throttle : 0;
    const ab = alive ? player.abLevel : 0;
    const spd = alive ? player.speed : 0;
    this.eng.g.gain.setTargetAtTime(alive ? 0.22 + thr * 0.3 : 0, t, 0.1);
    this.eng.src.playbackRate.setTargetAtTime(0.8 + thr * 0.45, t, 0.2);
    this.abSnd.g.gain.setTargetAtTime(ab * 0.6, t, 0.12);
    this.wind.g.gain.setTargetAtTime(alive ? Math.min(0.5, spd / 700) : 0, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(300 + spd * 3, t, 0.2);
    // lock tones: 0 none, 1 searching, 2 locked
    const mode = alive ? (g.locked ? 2 : g.lockTarget ? 1 : 0) : 0;
    let tg = 0;
    if (mode === 2) { this.tone.osc.frequency.value = 1300; tg = 0.05; }
    else if (mode === 1) { this.tone.osc.frequency.value = 850; tg = (g.time * 3) % 1 < 0.25 ? 0.04 : 0; }
    this.tone.g.gain.setTargetAtTime(tg, t, 0.01);
    const threat = alive && g.combat.missileThreat(player);
    this.warn.g.gain.setTargetAtTime(threat && (g.time * 8) % 1 < 0.5 ? 0.035 : 0, t, 0.01);
  }

  gunStart() {
    if (!this.ready || this.gun || !this.buf.cannon) return;
    this.gun = this.loop('cannon', 0.75, 1, 0.12);
  }

  gunStop() {
    if (!this.gun) return;
    const g = this.gun;
    g.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    setTimeout(() => { try { g.src.stop(); } catch {} }, 200);
    this.gun = null;
  }

  play(name, vol = 1, rate = 1) {
    if (!this.ready || !this.buf[name]) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buf[name];
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g).connect(this.sfx);
    s.start();
  }

  playAt(name, pos, vol = 1, rate = 1) {
    if (!this.listener) return this.play(name, vol, rate);
    const d = pos.distanceTo(this.listener);
    const v = vol * Math.pow(Math.max(0, 1 - d / 7000), 2);
    if (v < 0.01) return;
    this.play(name, v, rate * (d > 2000 ? 0.85 : 1));
  }

  explosionAt(pos, vol = 1) {
    this.playAt('explosion', pos, vol, 0.85 + Math.random() * 0.3);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
