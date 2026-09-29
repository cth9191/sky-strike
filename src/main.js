import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { loadModels } from './models.js';
import { FX, Trails } from './fx.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';
import { Game } from './game.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 2, 90000);
camera.position.set(0, 900, 6000);

const world = new World(renderer, scene);
await world.build((m) => ($('loadmsg').textContent = `${m}…`));
$('loadmsg').textContent = 'AIRCRAFT…';
const models = await loadModels();
world.decorate(models);

const fx = new FX(scene);
const trails = new Trails(scene);
const hud = new HUD($('hud'));
const audio = new GameAudio();
const game = new Game({ renderer, scene, camera, world, models, fx, trails, hud, audio, canvas: renderer.domElement });
window.game = game;

const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

const show = (id) => {
  for (const o of ['title', 'pause', 'dead']) $(o).classList.toggle('hidden', o !== id);
};
const lock = () => {
  try {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => (game.freeMouse = true));
  } catch {
    game.freeMouse = true;
  }
  setTimeout(() => { if (!document.pointerLockElement) game.freeMouse = true; }, 600);
};

$('title').onclick = async () => {
  show(null);
  await audio.init();
  audio.resume();
  game.start(false);
  lock();
};
$('pause').onclick = () => {
  show(null);
  game.resume();
  audio.resume();
  lock();
};
$('dead').onclick = () => {
  show(null);
  audio.resume();
  game.start(false);
  lock();
};
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { game.freeMouse = false; return; }
  if (game.state === 'playing' && !game.autopilot && game.player?.alive) {
    game.pause();
    audio.suspend();
    show('pause');
  }
});
game.onDead = (s) => {
  $('deadTitle').textContent = s.title;
  $('deadStats').textContent = `SCORE ${s.score}  ·  KILLS ${s.kills}  ·  WAVE ${s.wave}`;
  if (!game.autopilot) {
    document.exitPointerLock?.();
    show('dead');
  } else {
    setTimeout(() => game.start(true), 1500);
  }
};

$('loading').classList.add('hidden');
if (params.has('demo')) {
  show(null);
  audio.init().then(() => game.audio.startFlight()).catch(() => {});
  game.start(true);
} else {
  show('title');
}

const clock = new THREE.Clock();
let fpsT = 0, frames = 0;
window.fps = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const simDt = game.state === 'paused' ? 0 : dt;
  game.update(simDt);
  world.update(simDt, camera, game.focus);
  fx.update(simDt);
  trails.update(camera.position, game.time);
  composer.render();
  hud.draw(game, simDt);
  frames++;
  fpsT += dt;
  if (fpsT > 1) { window.fps = frames / fpsT; frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
frame();
