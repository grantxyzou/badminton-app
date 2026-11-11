import * as THREE from 'three';
import { RACKET_LIVERIES, headColour, hexToRgb, sampleStops, shapeFromMeasure, type Livery, type LiveryFinish, type RGB } from './racketLivery';

/**
 * The 3D badminton racket — Grant's model from the claude.ai/design project
 * "Racket 3D" (`racket-build.js`).
 *
 * THE SILHOUETTE NUMBERS WERE TUNED AGAINST REFERENCE RACKETS over several
 * review rounds; changing one changes the outline (the handoff README records
 * which values read as an egg, a teardrop or a flat top). The fidelity pass
 * (`docs/plans/racket-fidelity.md`, 2026-11-04) kept them and changed the
 * surface: lacquered materials over a carbon weave, an octagonal grip, 22
 * mains with woven crosses, flush grommets, a finer frame — and, for a racket
 * with a livery (`lib/racketLivery.ts`), its real paint, a slimmer frame and
 * shaft, and a head outline measured from photos.
 *
 * Loaded only through a dynamic `import()` from a client component, so three.js
 * never reaches the main bundle.
 *
 * Geometry in metres, y-up, butt cap resting at y = 0: a 674 mm frame — 195 mm
 * grip, 190 mm shaft, a throat fillet, and a 249 mm head.
 */

const GRIP_TOP = 0.2005;
const SHAFT_TOP = 0.390;
const HEAD_BOTTOM = 0.4195;
const FRAME_R = 0.0055; // frame half-width across the bed (11 mm)
const FLAT = 0.85; // frame/handle squash out of plane

export interface HeadShape {
  label: string;
  rx: number;
  ryTop: number;
  ryBot: number;
  nTop: number;
  nBot: number;
  lift: number;
}

/**
 * Head silhouettes. Each is an asymmetric superellipse: `nTop` / `nBot` set how
 * square the crown and the lower lobe run, `ryTop` + `ryBot` always sum to
 * 0.249 so every shape keeps the same head length, and `lift` pushes the
 * widest line above centre.
 */
export const SHAPES = {
  isometric: { label: 'Isometric', rx: 0.0985, ryTop: 0.142, ryBot: 0.107, nTop: 2.5, nBot: 2.25, lift: 0.06 },
  oval: { label: 'Oval', rx: 0.0975, ryTop: 0.128, ryBot: 0.121, nTop: 2.05, nBot: 2.05, lift: 0.02 },
  boxy: { label: 'Boxy', rx: 0.1005, ryTop: 0.140, ryBot: 0.109, nTop: 3.2, nBot: 2.5, lift: 0.07 },
} as const satisfies Record<string, HeadShape>;
export type ShapeKey = keyof typeof SHAPES;

/** Where the accent paint sits on the frame, as arcs of the head curve.
 *  t = 0 is the right-hand widest point, t = π/2 the crown. */
export const PATTERNS = {
  shoulder: { label: 'Shoulder band', arcs: [[0.63, 2.51]] },
  tips: { label: 'Twin tips', arcs: [[0.72, 1.2], [1.94, 2.42]] },
  chevron: { label: 'Chevrons', arcs: [[0.3, 0.62], [0.8, 1.12], [1.3, 1.62], [1.8, 2.12], [2.3, 2.62]] },
  crown: { label: 'Full upper', arcs: [[0.1, 3.04]] },
  plain: { label: 'Plain', arcs: [] },
} as const satisfies Record<string, { label: string; arcs: ReadonlyArray<readonly [number, number]> }>;
export type PatternKey = keyof typeof PATTERNS;

/** The colours a racket is painted in. The same shape as `RacketLook`. */
export interface ModelLook {
  frame: string;
  accent: string;
  grip: string;
  /** The catalog id, to look up the racket's real paint (`RACKET_LIVERIES`).
   *  The table rides with three.js, so the main bundle never carries it. */
  liveryId?: string | null;
}

/** Overrides on top of a model's look. A null colour falls back to the look. */
export interface ModelTweaks {
  shape?: ShapeKey;
  pattern?: PatternKey;
  frame?: string | null;
  string?: string | null;
  wrap?: string | null;
}

export const DEFAULT_STRING = '#f2efe6';
const TRIM = '#b9c0c6';
/** A part a livery leaves unpainted: the near-black most makers use there. */
const INK = '#141414';

const darken = (hex: string, amt: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (sh: number) => Math.round(((n >> sh) & 255) * (1 - amt)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
};

/** The head curve: squarer across the top, widest just above centre, the lower
 *  lobe shorter and rounding in toward the throat. */
function headXY(s: HeadShape, t: number, rx: number, inset = 0): [number, number] {
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const up = sn > 0;
  const p = 2 / (up ? s.nTop : s.nBot);
  const ry = (up ? s.ryTop : s.ryBot) - inset;
  return [(rx - inset) * (1 + s.lift * sn) * Math.sign(c) * Math.abs(c) ** p, ry * Math.sign(sn) * Math.abs(sn) ** p];
}

class HeadCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly shape: HeadShape,
    private readonly cy: number,
    private readonly rx: number,
    private readonly from = 0,
    private readonly to = Math.PI * 2,
    private readonly inset: number | ((t: number) => number) = 0,
  ) {
    super();
  }
  tAt(u: number): number {
    return this.from + u * (this.to - this.from);
  }
  override getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const t = this.tAt(u);
    const ins = typeof this.inset === 'function' ? this.inset(t) : this.inset;
    const [x, y] = headXY(this.shape, t, this.rx, ins);
    return target.set(x, this.cy + y, 0);
  }
}

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly r: number, private readonly y0: number, private readonly y1: number, private readonly turns: number) {
    super();
  }
  override getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = u * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, this.y0 + u * (this.y1 - this.y0), Math.sin(a) * this.r);
  }
}

/** Half-extent of the string bed along one axis at the given offset. */
function bedSpan(v: number, rIn: number, rOut: number, n: number): number {
  const q = 1 - Math.min(1, Math.abs(v / rIn) ** n);
  return rOut * q ** (1 / n);
}

function mat(name: string, color: string, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  m.name = name;
  return m;
}

/* Surface detail, drawn once per page into small canvases and shared. */
let WEAVE: THREE.CanvasTexture | null = null;
/** A 2x2 twill carbon weave as a bump map: the diagonal tows under the lacquer. */
function weave(): THREE.CanvasTexture {
  if (WEAVE) return WEAVE;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    /* eslint-disable no-restricted-syntax -- bump-map heights (greys), not UI colour. */
    x.fillStyle = '#808080';
    x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const on = (i + j) % 4 < 2;
      const g = x.createLinearGradient(i * 8, j * 8, i * 8 + 8, j * 8 + 8);
      g.addColorStop(0, on ? '#9a9a9a' : '#5c5c5c'); g.addColorStop(0.5, on ? '#b8b8b8' : '#6e6e6e'); g.addColorStop(1, on ? '#8a8a8a' : '#545454');
      x.fillStyle = g;
      x.fillRect(i * 8, j * 8, 8, 8);
    }
    /* eslint-enable no-restricted-syntax */
  }
  WEAVE = new THREE.CanvasTexture(c);
  WEAVE.wrapS = WEAVE.wrapT = THREE.RepeatWrapping;
  WEAVE.repeat.set(40, 2);
  return WEAVE;
}

let PU: THREE.CanvasTexture | null = null;
/** A perforated PU grip: small dimples on a soft base. */
function puGrip(): THREE.CanvasTexture {
  if (PU) return PU;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    /* eslint-disable no-restricted-syntax -- bump-map heights (greys), not UI colour. */
    x.fillStyle = '#9a9a9a';
    x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#5a5a5a';
    /* eslint-enable no-restricted-syntax */
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.arc(i * 8 + (j % 2) * 4 + 2, j * 8 + 4, 1.4, 0, Math.PI * 2); x.fill(); }
  }
  PU = new THREE.CanvasTexture(c);
  PU.wrapS = PU.wrapT = THREE.RepeatWrapping;
  PU.repeat.set(6, 30);
  return PU;
}

/** A lacquered composite: base coat, clear coat over it, the carbon weave under it. */
function coat(name: string, color: THREE.ColorRepresentation, finish: LiveryFinish = 'gloss', accent = false): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: finish === 'matte' ? 0.72 : 0.5,
    metalness: finish === 'metallic' ? 0.6 : accent ? 0.45 : 0.15,
    clearcoat: finish === 'matte' ? 0.15 : 1,
    clearcoatRoughness: finish === 'matte' ? 0.6 : 0.05,
    bumpMap: weave(),
    bumpScale: finish === 'matte' ? 0.3 : 0.6,
  });
  if (finish === 'pearl') { m.iridescence = 0.85; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [180, 520]; }
  m.name = name;
  return m;
}

function tube(name: string, curve: THREE.Curve<THREE.Vector3>, radius: number, material: THREE.Material, segments = 200, closed = false): THREE.Mesh {
  const geo = new THREE.TubeGeometry(curve, segments, radius, 14, closed);
  geo.scale(1, 1, FLAT);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  return mesh;
}

type Extent = number | ((t: number) => number);

/**
 * A tube with a box-aero cross-section rather than a round one: a superellipse
 * profile swept along a planar curve, so the frame carries a defined outer
 * face and crisp corner edges the way a real composite frame does. Built on an
 * explicit (tangent, z) basis — Frenet frames twist on a curve that lies flat.
 */
function profileTube(
  name: string, curve: HeadCurve, halfW: Extent, halfD: Extent, material: THREE.Material,
  along: number, closed = false, n = 4,
): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  const round = 24;
  const p = 2 / n;
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const rings = closed ? along : along + 1;
  for (let i = 0; i < rings; i++) {
    const u = i / along;
    const par = curve.tAt(u);
    const hw = typeof halfW === 'function' ? halfW(par) : halfW;
    const hd = typeof halfD === 'function' ? halfD(par) : halfD;
    curve.getPoint(u, P);
    curve.getTangent(u, T);
    N.crossVectors(T, Z).normalize();
    for (let j = 0; j < round; j++) {
      const t = (j / round) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const a = Math.sign(c) * Math.abs(c) ** p * hw;
      const b = Math.sign(s) * Math.abs(s) ** p * hd;
      pos.push(P.x + N.x * a, P.y + N.y * a, P.z + b);
    }
  }
  for (let i = 0; i < along; i++) {
    const next = closed ? (i + 1) % along : i + 1;
    for (let j = 0; j < round; j++) {
      const k = (j + 1) % round;
      idx.push(i * round + j, next * round + j, next * round + k);
      idx.push(i * round + j, next * round + k, i * round + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  return mesh;
}

/** `rings` subdivides the length, so a painted fade down a shaft has vertices to land on. */
function cyl(name: string, rTop: number, rBottom: number, h: number, y: number, material: THREE.Material, squash = 1, segments = 24, rings = 1): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments, rings, false);
  if (squash !== 1) geo.scale(1, 1, squash);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y + h / 2;
  mesh.name = name;
  return mesh;
}

/** The livery a build paints, or none. A member's own frame colour replaces it
 *  (only a typed-in racket can take one); a livery fixes its own shape and paint,
 *  so the pattern and shape tweaks do not apply to it. */
function liveryOf(look: ModelLook, tw: ModelTweaks): Livery | null {
  const lv = look.liveryId ? RACKET_LIVERIES[look.liveryId] : undefined;
  return lv && !tw.frame ? lv : null;
}

/** The colours a build actually paints with: the look, with any tweak over it. */
function palette(look: ModelLook, tw: ModelTweaks = {}) {
  const lv = liveryOf(look, tw);
  const frame = tw.frame || look.frame;
  const grip = tw.wrap || lv?.grip || look.grip;
  return {
    frame, grip, accent: look.accent,
    string: tw.string || lv?.strings || DEFAULT_STRING,
    grommet: lv?.grommets ?? darken(frame, 0.45),
    // A white towel or PU grip's ridge is barely darker than the grip.
    wrap: darken(grip, lv ? 0.1 : 0.3),
  };
}

export interface RacketMaterials {
  frame: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  grip: THREE.MeshStandardMaterial;
  wrap: THREE.MeshStandardMaterial;
  grommet: THREE.MeshStandardMaterial;
  string: THREE.MeshStandardMaterial;
}

/** Paint the head, throat, shaft and handle cone with a livery, as vertex colours. */
function paintLivery(g: THREE.Group, lv: Livery, S: HeadShape, CY: number, finish: LiveryFinish): void {
  const len = S.ryTop + S.ryBot;
  const material = coat('livery', 0xffffff, finish); // white: the vertex colours carry the paint
  material.vertexColors = true;
  const v = new THREE.Vector3();
  const stemColour = (name: string, y: number): RGB => {
    if (name === 'throat') return hexToRgb(lv.throat ?? (typeof lv.head === 'string' ? lv.head : lv.head[0][1]));
    if (name === 'handle_cone') return lv.cone ? hexToRgb(lv.cone) : sampleStops(lv.shaft, 0);
    if (name === 'butt_cap') return hexToRgb(lv.butt ?? lv.cone ?? INK);
    return sampleStops(lv.shaft, (y - GRIP_TOP) / (SHAFT_TOP - GRIP_TOP));
  };
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const isHead = mesh.name === 'frame';
    const isStem = mesh.name === 'shaft' || mesh.name === 'throat' || mesh.name === 'handle_cone' || mesh.name === 'butt_cap';
    if (!isHead && !isStem) return;
    mesh.updateMatrix();
    const pos = mesh.geometry.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrix);
      const c = isHead
        ? headColour(lv, (Math.atan2((v.y - CY) / (v.y > CY ? S.ryTop : S.ryBot), v.x / S.rx) * 180) / Math.PI, (v.y - HEAD_BOTTOM) / len)
        : stemColour(mesh.name, v.y);
      // Liveries are written in sRGB hex; the renderer works in linear.
      const col = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
      cols[k * 3] = col.r; cols[k * 3 + 1] = col.g; cols[k * 3 + 2] = col.b;
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    mesh.material = material;
  });
}

/** A badminton racket in one model's colourway — or, with a livery, its real paint. */
export function buildRacket(look: ModelLook, tw: ModelTweaks = {}): THREE.Group {
  const lv = liveryOf(look, tw);
  // A livery's frame is the slim modern section (≈7.8 mm across the bed, the
  // Halbertec 9000 measured from photos); the three-colour look keeps Grant's 11 mm.
  const FR = lv ? 0.0039 : FRAME_R;
  const S: HeadShape = lv?.shape
    ? shapeFromMeasure(lv.shape, SHAPES.isometric.ryTop + SHAPES.isometric.ryBot, FR)
    : SHAPES[tw.shape ?? 'isometric'] ?? SHAPES.isometric;
  const CY = HEAD_BOTTOM + S.ryBot; // head centre — the widest line
  const arcs = (lv ? [] : (PATTERNS[tw.pattern ?? 'shoulder'] ?? PATTERNS.shoulder).arcs) as ReadonlyArray<readonly [number, number]>;
  const c = palette(look, tw);
  const finish = lv?.finish ?? 'gloss';

  const g = new THREE.Group();
  g.name = 'racket';

  const mFrame = coat('frame', c.frame, finish);
  const mAccent = coat('accent', c.accent, finish, true);
  const mGrip = mat('grip', c.grip, 0.82, 0);
  mGrip.bumpMap = puGrip();
  mGrip.bumpScale = 1.2;
  const mWrap = mat('grip_wrap', c.wrap, 0.96, 0);
  const mString = Object.assign(new THREE.MeshPhysicalMaterial({ color: c.string, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.3 }), { name: 'string' });
  const mTrim = Object.assign(new THREE.MeshPhysicalMaterial({ color: lv?.buttTrim ?? TRIM, roughness: lv?.buttTrim ? 0.4 : 0.18, metalness: lv?.buttTrim ? 0.1 : 1 }), { name: 'trim' });
  const mGrommet = mat('grommet', c.grommet, 0.5, 0);
  const mCollar = lv ? coat('collar', lv.collar ?? lv.cone ?? INK, finish) : mAccent;

  /* Handle: butt cap, trim ring, an octagonal grip, the collar, overgrip helix. */
  g.add(cyl('butt_cap', 0.0136, 0.0132, 0.008, 0, mFrame, 0.83));
  g.add(cyl('butt_trim', 0.0139, 0.0139, 0.0026, 0.008, mTrim, 0.83));
  g.add(cyl('grip', 0.0118, 0.0128, 0.1826, 0.0106, mGrip, 0.83, 8));
  g.add(cyl('grip_collar', 0.0114, 0.0118, 0.0073, 0.1932, mCollar, 0.83));

  const wrap = tube('grip_wrap', new HelixCurve(0.0124, 0.016, 0.1925, 11.5), 0.0011, mWrap, 320);
  wrap.geometry.scale(1, 1, 0.83 / FLAT);
  g.add(wrap);

  /* Shaft and its two painted flashes, the handle cone, then the throat. A
     livery's shaft is the slim 6.6 mm modern one and paints its own flashes. */
  g.add(cyl('shaft', lv ? 0.0033 : 0.0039, lv ? 0.0035 : 0.0044, SHAFT_TOP - GRIP_TOP, GRIP_TOP, mFrame, 1, 20, 48));
  g.add(cyl('handle_cone', 0.0047, 0.0115, 0.034, 0.2, mFrame, 0.86, 22, 8));
  if (!lv) {
    g.add(cyl('shaft_flash_lower', 0.0046, 0.0046, 0.0061, 0.3119, mAccent, 1, 20));
    g.add(cyl('shaft_flash_upper', 0.0045, 0.0046, 0.0174, 0.3328, mAccent, 1, 20));
  }
  g.add(cyl('throat', 0.0082, 0.0042, 0.052, 0.3715, mFrame, 1, 22, 8));

  /* Frame, then the accent paint as arcs laid over it. The section thins as it
     runs over the crown, the way an aero frame does. */
  const hw = (t: number) => FR * (1 - 0.35 * Math.max(0, Math.sin(t)) ** 0.9);
  const hd = (t: number) => FRAME_R * FLAT * (1 - 0.18 * Math.max(0, Math.sin(t)) ** 0.9);
  g.add(profileTube('frame', new HeadCurve(S, CY, S.rx), hw, hd, mFrame, 560, true));
  arcs.forEach(([from, to], i) => {
    const rings = Math.max(14, Math.round((to - from) * 50));
    g.add(profileTube(`accent_band_${i + 1}`, new HeadCurve(S, CY, S.rx, from, to), (t) => hw(t) * 1.07, (t) => hd(t) * 1.07, mAccent, rings));
  });

  /* Grommet strip: the moulded channel seated in the frame's inner groove and
     showing again in the outer channel, with a barrel at every string hole —
     sitting nearly flush, the way they do on a real frame. */
  const stripD = (t: number) => hd(t) * 0.78;
  g.add(profileTube('grommet_strip', new HeadCurve(S, CY, S.rx, 0, Math.PI * 2, (t) => hw(t) + 0.0004), 0.0016, stripD, mGrommet, 280, true, 3));
  g.add(profileTube('grommet_strip_outer', new HeadCurve(S, CY, S.rx, 0, Math.PI * 2, (t) => -(hw(t) + 0.0004)), 0.0016, stripD, mGrommet, 280, true, 3));
  const grommets = new THREE.Group();
  grommets.name = 'grommets';
  const barrelGeo = new THREE.CylinderGeometry(0.0011, 0.0009, 0.0034, 10);
  const barrel = (name: string, x: number, y: number, alongX: boolean) => {
    const geo = barrelGeo.clone();
    if (alongX) geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, mGrommet);
    m.position.set(x, y, 0);
    m.name = name;
    grommets.add(m);
  };
  barrelGeo.dispose();

  /* String bed: 22 mains (a 76-hole pattern) and crosses that ride over one
     main and under the next, alternating row by row, cut to the frame. */
  const strings = new THREE.Group();
  strings.name = 'strings';
  const inset = FR + 0.0012;
  const rxIn = S.rx - inset;
  const ryTopIn = S.ryTop - inset;
  const ryBotIn = S.ryBot - inset;
  const sr = 0.00036;
  const pitch = Math.min(0.0081, (rxIn * 1.9) / 21);

  for (let k = 0; k < 22; k++) {
    const x = (k - 10.5) * pitch;
    const top = bedSpan(x, rxIn, ryTopIn, S.nTop);
    const bot = bedSpan(x, rxIn, ryBotIn, S.nBot);
    if (top + bot < 0.004) continue;
    const geo = new THREE.CylinderGeometry(sr, sr, top + bot, 10);
    const m = new THREE.Mesh(geo, mString);
    m.position.set(x, CY - bot + (top + bot) / 2, 0);
    const id = String(k + 1).padStart(2, '0');
    m.name = `main_${id}`;
    strings.add(m);
    barrel(`grommet_main_${id}_t`, x, CY + top + 0.0012, false);
    barrel(`grommet_main_${id}_b`, x, CY - bot - 0.0012, false);
  }
  for (let j = -9; j <= 11; j++) {
    const y = j * 0.0107;
    const half = y > 0 ? bedSpan(y, ryTopIn, rxIn, S.nTop) : bedSpan(y, ryBotIn, rxIn, S.nBot);
    if (half < 0.003) continue;
    const pts: THREE.Vector3[] = [];
    const n = 160;
    for (let q = 0; q <= n; q++) {
      const xx = -half + (2 * half * q) / n;
      const phase = ((xx + 10.5 * pitch) / pitch) * Math.PI + (((j % 2) + 2) % 2) * Math.PI;
      pts.push(new THREE.Vector3(xx, 0, 0.00042 * Math.cos(phase)));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, sr, 8, false);
    const m = new THREE.Mesh(geo, mString);
    m.position.set(0, CY + y, 0);
    const id = String(j + 10).padStart(2, '0');
    m.name = `cross_${id}`;
    strings.add(m);
    barrel(`grommet_cross_${id}_l`, -half - 0.0012, CY + y, true);
    barrel(`grommet_cross_${id}_r`, half + 0.0012, CY + y, true);
  }
  g.add(strings);
  g.add(grommets);

  if (lv) paintLivery(g, lv, S, CY, finish);

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const materials: RacketMaterials = { frame: mFrame, accent: mAccent, grip: mGrip, wrap: mWrap, grommet: mGrommet, string: mString };
  g.userData.materials = materials;
  return g;
}

/** Repaint an already-built racket — keeps the camera where the user left it.
 *  Shape and pattern changes need a rebuild; colours never do. */
export function applyLook(racket: THREE.Group, look: ModelLook, tw: ModelTweaks = {}): void {
  const m = racket.userData.materials as RacketMaterials;
  const c = palette(look, tw);
  m.frame.color.set(c.frame);
  m.accent.color.set(c.accent);
  m.grip.color.set(c.grip);
  m.wrap.color.set(c.wrap);
  m.grommet.color.set(c.grommet);
  m.string.color.set(c.string);
}

/** Free every geometry and material a racket owns. */
export function disposeRacket(racket: THREE.Object3D): void {
  racket.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}
