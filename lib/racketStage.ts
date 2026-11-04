import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * The studio the racket model was balanced against — lifted from the design's
 * `three-d-stage.js` `_boot()`. The handoff is explicit that the materials look
 * like plastic without it: ACES filmic tone mapping at 1.15 exposure, a soft
 * sky-to-floor gradient as the environment (a broad sheen rather than one
 * specular pinpoint), a hemisphere wash, a shadow-casting key and a dim warm
 * fill. Since the fidelity pass (2026-11-04) the environment is a softbox
 * room rather than the gradient, at exposure 1.0. One module so the live viewer and the pre-rendered list images light
 * the racket identically.
 *
 * Client-only: loaded through a dynamic `import()`.
 */

export interface RacketStageOptions {
  /** Orbit, zoom and pan by touch or mouse. */
  interactive?: boolean;
  /** A slow turntable until the viewer touches it. */
  autorotate?: boolean;
  /** Draw the soft ground shadow. Off for list images, which sit on a tile. */
  ground?: boolean;
}

export interface RacketStage {
  readonly canvas: HTMLCanvasElement;
  /** Show (and own) the object; frame the camera unless `keepCamera`. */
  setObject(object: THREE.Object3D, opts?: { keepCamera?: boolean; direction?: [number, number, number]; framing?: number }): void;
  resize(width: number, height: number): void;
  renderOnce(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createRacketStage(canvas: HTMLCanvasElement, opts: RacketStageOptions = {}): RacketStage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  // three r187 removed PCFSoftShadowMap and falls back to this with a console
  // warning; asking for it directly draws the same shadow, silently.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Filmic rolloff: highlights bloom off instead of clipping to a hard white
  // dot, which is most of what makes a render look plastic.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();

  // A softbox studio (three's RoomEnvironment) for the reflections: lacquer
  // and clear coat read as paint only when there are lights to catch. At full
  // strength it washes colours out, hence the low intensity and exposure.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.03);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
  room.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  camera.position.set(3, 2.2, 4);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff4e6, 0.28);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.visible = opts.ground !== false;
  scene.add(ground);

  const controls = opts.interactive ? new OrbitControls(camera, canvas) : null;
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = !!opts.autorotate;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
  }

  let object: THREE.Object3D | null = null;
  const target = new THREE.Vector3();

  function renderOnce() {
    controls?.update();
    renderer.render(scene, camera);
  }

  return {
    canvas,
    setObject(next, o = {}) {
      if (object) scene.remove(object);
      object = next;
      const box = new THREE.Box3().setFromObject(next);
      if (!box.isEmpty()) {
        ground.position.y = box.min.y;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist = (sphere.radius / Math.tan((camera.fov * Math.PI) / 360)) * (o.framing ?? 1.35);
        const dir = new THREE.Vector3(...(o.direction ?? [1, 0.55, 1.25])).normalize();
        if (!o.keepCamera) {
          camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
          target.copy(sphere.center);
          camera.lookAt(target);
          controls?.target.copy(sphere.center);
        }
        camera.near = Math.max(dist / 100, 0.01);
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        const span = sphere.radius * 3;
        key.shadow.camera.left = -span;
        key.shadow.camera.right = span;
        key.shadow.camera.top = span;
        key.shadow.camera.bottom = -span;
        key.shadow.camera.updateProjectionMatrix();
      }
      scene.add(next);
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    renderOnce,
    start() { renderer.setAnimationLoop(renderOnce); },
    stop() { renderer.setAnimationLoop(null); },
    dispose() {
      renderer.setAnimationLoop(null);
      controls?.dispose();
      envRT.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
