// Procedural PBR materials (spec §4: coherent surfaces, perceptual params,
// readable state masks, no-post baseline legibility).
import * as THREE from 'three';

// tiny procedural canvas texture helper (wood grain / fabric weave)
function makeTexture(kind, base, accent, size = 128) {
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
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const texCache = new Map();
function tex(kind, base, accent) {
  const key = `${kind}:${base}:${accent}`;
  if (!texCache.has(key)) texCache.set(key, makeTexture(kind, base, accent));
  return texCache.get(key);
}

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export class MaterialFactory {
  constructor(theme) {
    this.theme = theme;
    this.owned = [];
  }

  make(params) {
    const m = new THREE.MeshStandardMaterial(params);
    this.owned.push(m);
    return m;
  }

  floorMat(alt = false) {
    const t = this.theme;
    const base = hex(alt ? t.floorAlt : t.floor);
    const map = tex('wood', base, hex(t.wall));
    map.repeat.set(2, 2);
    return this.make({ map, roughness: 0.85, metalness: 0.02 });
  }

  wallMat() {
    const t = this.theme;
    const map = tex('wood', hex(t.wall), hex(t.shelf));
    map.repeat.set(3, 2);
    return this.make({ map, roughness: 0.9, metalness: 0.02 });
  }

  woodMat(color, rough = 0.8) {
    // map carries the albedo; color stays white to avoid squaring the tint
    return this.make({ color: 0xffffff, roughness: rough, metalness: 0.03, map: tex('wood', hex(color), '#00000055') });
  }

  metalMat(color, rough = 0.35, metal = 0.85) {
    return this.make({ color: 0xffffff, roughness: rough, metalness: metal, map: tex('metal', hex(color), '#ffffff44') });
  }

  plushMat(color) {
    const map = tex('fabric', hex(color), '#00000033');
    return this.make({ color: 0xffffff, map, roughness: 0.95, metalness: 0.0 });
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
