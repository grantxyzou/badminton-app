import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * The studio the racket model was balanced against — lifted from the design's
 * `three-d-stage.js` `_boot()`. The handoff is explicit that the materials look
 * like plastic without it: ACES filmic tone mapping at 1.15 exposure, a soft
 * sky-to-floor gradient as the environment (a broad sheen rather than one
 * specular pinpoint), a hemisphere wash, a shadow-casting key and a dim warm
 * fill. One module so the live viewer and the pre-rendered list images light
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Filmic rolloff: highlights bloom off instead of clipping to a hard white
  // dot, which is most of what makes a render look plastic.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();

  const envCanvas = document.createElement('canvas');
  envCanvas.width = 16;
  envCanvas.height = 128;
  const ectx = envCanvas.getContext('2d');
  if (ectx) {
    const grad = ectx.createLinearGradient(0, 0, 0, 128);
    // eslint-disable-next-line no-restricted-syntax -- environment-map pixels, not UI colour; balanced against the model's materials.
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.44, '#ece9e2'); grad.addColorStop(0.52, '#c9c5bc'); grad.addColorStop(1, '#7e7b74');
    ectx.fillStyle = grad;
    ectx.fillRect(0, 0, 16, 128);
  }
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(envTex);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();
  envTex.dispose();

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
