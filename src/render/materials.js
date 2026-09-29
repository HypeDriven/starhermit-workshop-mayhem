// Procedural PBR materials (spec §4: coherent surfaces, perceptual params,
// readable state masks, no-post baseline legibility).
import * as THREE from 'three';

// tiny procedural canvas texture helper (wood grain / fabric weave). The
// detailed variant doubles the resolution and adds knots and fine grain noise.
function makeTexture(kind, base, accent, detailed = false) {
  const size = detailed ? 256 : 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = accent;
  g.globalAlpha = 0.35;
  if (kind === 'wood') {
    for (let i = 0; i < 12; i++) {
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      const y = (i / 12) * size + Math.sin(i * 3.7) * 4;
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 8) g.lineTo(x, y + Math.sin(x * 0.08 + i) * 2.5);
      g.stroke();
    }
  } else if (kind === 'fabric') {
    g.globalAlpha = 0.16;
    for (let i = 0; i < size; i += 4) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
    }
  } else if (kind === 'metal') {
    g.globalAlpha = 0.12;
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.arc(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 0, 7);
      g.stroke();
    }
  }
  if (detailed) addDetail(g, kind, size);
  const tex = new THREE.CanvasTexture(c);
  if (detailed) tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// deterministic hash noise so the detailed textures never shimmer between builds
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function addDetail(g, kind, size) {
  if (kind === 'wood') {
    // a couple of small, soft knots stretched along the grain
    for (let k = 0; k < 2; k++) {
      const x = hash(k * 3 + 1) * size, y = hash(k * 3 + 2) * size, r = 2 + hash(k * 3 + 3) * 2.5;
      g.globalAlpha = 0.16;
      g.fillStyle = '#1a0f06';
      g.beginPath(); g.ellipse(x, y, r * 2.6, r, 0, 0, 7); g.fill();
    }
  }
  // fine grain: short streaks along the grain (wood) or faint slubs (fabric)
  const n = kind === 'fabric' ? 500 : 700;
  for (let i = 0; i < n; i++) {
    const lx = hash(i * 1.37 + 7) * size, ly = hash(i * 2.91 + 3) * size;
    g.globalAlpha = 0.03 + hash(i + 0.5) * 0.05;
    g.fillStyle = hash(i * 5.3) > 0.5 ? '#ffffff' : '#000000';
    g.fillRect(lx, ly, kind === 'wood' ? 4 + hash(i * 0.7) * 6 : 1, 1);
  }
  g.globalAlpha = 1;
}

const texCache = new Map();
function tex(kind, base, accent, detailed = false) {
  const key = `${kind}:${base}:${accent}:${detailed ? 'd' : 'p'}`;
  if (!texCache.has(key)) texCache.set(key, makeTexture(kind, base, accent, detailed));
  return texCache.get(key);
}

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export class MaterialFactory {
  // rich: physically based extras (clearcoat varnish on wood and metal, fabric
  // sheen on plush) that pay off when the scene has an environment map.
  // detailed: higher-resolution procedural textures with knots and grain.
  constructor(theme, { rich = false, detailed = false } = {}) {
    this.theme = theme;
    this.rich = rich;
    this.detailed = detailed;
    this.owned = [];
  }

  make(params) {
    const m = new THREE.MeshStandardMaterial(params);
    this.owned.push(m);
    return m;
  }

  // Physical when rich, plain Standard otherwise (the extras are dropped)
  makeRich(params, extras) {
    const m = this.rich
      ? new THREE.MeshPhysicalMaterial({ ...params, ...extras })
      : new THREE.MeshStandardMaterial(params);
    this.owned.push(m);
    return m;
  }

  tex(kind, base, accent) { return tex(kind, base, accent, this.detailed); }

  floorMat(alt = false) {
    const t = this.theme;
    const base = hex(alt ? t.floorAlt : t.floor);
    const map = this.tex('wood', base, hex(t.wall));
    map.repeat.set(2, 2);
    // a thin worn varnish so the lamp leaves a soft sheen on the boards
    return this.makeRich({ map, roughness: 0.8, metalness: 0.02 }, { clearcoat: 0.12, clearcoatRoughness: 0.55 });
  }

  wallMat() {
    const t = this.theme;
    const map = this.tex('wood', hex(t.wall), hex(t.shelf));
    map.repeat.set(3, 2);
    return this.make({ map, roughness: 0.9, metalness: 0.02 });
  }

  woodMat(color, rough = 0.8) {
    // map carries the albedo; color stays white to avoid squaring the tint
    return this.makeRich(
      { color: 0xffffff, roughness: rough, metalness: 0.03, map: this.tex('wood', hex(color), '#00000055') },
      { clearcoat: 0.3, clearcoatRoughness: 0.35 },
    );
  }

  metalMat(color, rough = 0.35, metal = 0.85) {
    // without an environment map a fully metallic surface has nothing to
    // reflect and reads as a black hole: keep it partly diffuse instead
    const metalness = this.rich ? metal : Math.min(metal, 0.45);
    return this.makeRich(
      { color: 0xffffff, roughness: rough, metalness, map: this.tex('metal', hex(color), '#ffffff44') },
      { clearcoat: 0.6, clearcoatRoughness: 0.12 },
    );
  }

  plushMat(color) {
    const map = this.tex('fabric', hex(color), '#00000033');
    return this.makeRich(
      { color: 0xffffff, map, roughness: 0.95, metalness: 0.0 },
      { sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25) },
    );
  }

  emissiveMat(color, intensity = 1.4) {
    return this.make({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 });
  }

  ghostMat(valid) {
    return new THREE.MeshBasicMaterial({
      color: valid ? 0x51ff9a : 0xff5151,
      transparent: true, opacity: 0.45, depthWrite: false,
    });
  }

  zoneMat(color) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, depthWrite: false,
    });
  }

  dispose() {
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
  }
}

// Color-vision-safe palette variants for state colors (spec §3: color
// reinforced by shape/label; contrast-safe palettes).
export const STATE_PALETTES = {
  default: { valid: 0x51ff9a, invalid: 0xff5151, zone: 0x64d8ff, goal: 0xffe083 },
  deuteranopia: { valid: 0x51b0ff, invalid: 0xffb051, zone: 0xff6ad8, goal: 0xf0f0f0 },
  tritanopia: { valid: 0x51ffd8, invalid: 0xff6a6a, zone: 0xffd851, goal: 0xf0f0f0 },
  highContrast: { valid: 0x00ff88, invalid: 0xff3333, zone: 0x00ccff, goal: 0xffff00 },
};

export function statePalette(name) {
  return STATE_PALETTES[name] || STATE_PALETTES.default;
}
