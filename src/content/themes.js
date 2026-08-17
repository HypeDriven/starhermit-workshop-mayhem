// Visual themes — cosmetic only (spec §7: never hitboxes, timing, info, power).
// Each theme: lighting rig, palette, fog, ambience flavor, music mode.
// Colors are authored pre-tonemap; ACES + exposure per theme (spec §4).

export const THEMES = {
  brassworks: {
    id: 'brassworks', name: 'Brassworks Shop', unlock: 'default',
    key: { color: 0xffe3b3, intensity: 4.2, pos: [4, 7, 4] },
    hemi: { sky: 0xbfd4e6, ground: 0x8a6a4a, intensity: 1.35 },
    lamp: { color: 0xffb45e, intensity: 12 },
    fog: { color: 0x2a2018, near: 14, far: 30 },
    floor: 0x7a5a3a, floorAlt: 0x6b4e32, wall: 0x4a3826, shelf: 0x5c442c,
    accent: 0xd8a24a, zone: 0x64d8ff, bell: 0xe8c860, pad: 0xff7a59,
    dummy: { body: 0xf0e2c8, trim: 0xd94f3d, face: 0x2a2018 },
    exposure: 1.15, ambience: 'room', music: 'warm',
    blurb: 'The inventor’s home bench. Cedar, brass, and warm lamp light.',
  },
  tidepool: {
    id: 'tidepool', name: 'Tidepool Annex', unlock: 'stars-20',
    key: { color: 0xcfefff, intensity: 4.0, pos: [-3, 8, 5] },
    hemi: { sky: 0xaee6f0, ground: 0x3f6a70, intensity: 1.45 },
    lamp: { color: 0x7fe0d8, intensity: 10 },
    fog: { color: 0x14252a, near: 14, far: 30 },
    floor: 0x3f6d72, floorAlt: 0x376066, wall: 0x27444c, shelf: 0x2f525a,
    accent: 0x59d4c8, zone: 0xffe083, bell: 0xd8f0f0, pad: 0xffb257,
    dummy: { body: 0xe8f4f2, trim: 0x2fa89a, face: 0x14252a },
    exposure: 1.12, ambience: 'water', music: 'cool',
    blurb: 'A converted aquarium wing. Cool light, patient water.',
  },
  emberworks: {
    id: 'emberworks', name: 'Emberworks Foundry', unlock: 'stars-45',
    key: { color: 0xffc9a0, intensity: 3.6, pos: [5, 6, 2] },
    hemi: { sky: 0x6a4a52, ground: 0x2e1a14, intensity: 1.05 },
    lamp: { color: 0xff7a30, intensity: 18 },
    fog: { color: 0x1c0f0c, near: 12, far: 28 },
    floor: 0x4a2c22, floorAlt: 0x41261e, wall: 0x2e1a16, shelf: 0x3a221a,
    accent: 0xff8a3d, zone: 0x8fe0ff, bell: 0xffd27a, pad: 0xffe07a,
    dummy: { body: 0xe8d8cc, trim: 0xb43a20, face: 0x1c0f0c },
    exposure: 1.18, ambience: 'forge', music: 'warm',
    blurb: 'Where the heavy tools are born. Mind the glow.',
  },
  nocturne: {
    id: 'nocturne', name: 'Nocturne Observatory', unlock: 'stars-70',
    key: { color: 0xaac4ff, intensity: 3.2, pos: [-4, 8, 3] },
    hemi: { sky: 0x4a5a8a, ground: 0x1a1a2e, intensity: 0.95 },
    lamp: { color: 0x9ab0ff, intensity: 14 },
    fog: { color: 0x10101f, near: 12, far: 26 },
    floor: 0x2e2e4a, floorAlt: 0x282842, wall: 0x1e1e33, shelf: 0x262640,
    accent: 0x8a9af0, zone: 0x7af0d8, bell: 0xd8e0ff, pad: 0xff9ac8,
    dummy: { body: 0xdde2f0, trim: 0x5a6ad8, face: 0x10101f },
    exposure: 1.12, ambience: 'night', music: 'cool',
    blurb: 'A rooftop lab for late ideas and quiet magnets.',
  },
  verdant: {
    id: 'verdant', name: 'Verdant Greenhouse', unlock: 'stars-95',
    key: { color: 0xe8ffd0, intensity: 4.1, pos: [2, 9, 4] },
    hemi: { sky: 0xc8e8b0, ground: 0x3a5230, intensity: 1.4 },
    lamp: { color: 0xd0f090, intensity: 10 },
    fog: { color: 0x1a2416, near: 14, far: 30 },
    floor: 0x4a6a3a, floorAlt: 0x425f34, wall: 0x2e4426, shelf: 0x38502c,
    accent: 0x9ad84a, zone: 0xffe083, bell: 0xf0f0d0, pad: 0xff9a6a,
    dummy: { body: 0xf0eed8, trim: 0x4a8a3a, face: 0x1a2416 },
    exposure: 1.15, ambience: 'garden', music: 'warm',
    blurb: 'Overgrown benches, patient vines, excellent light.',
  },
  midnight: {
    id: 'midnight', name: 'Midnight Gauntlet', unlock: 'chapter-6',
    key: { color: 0xd0aaff, intensity: 3.4, pos: [0, 8, 5] },
    hemi: { sky: 0x5a4a7a, ground: 0x16121f, intensity: 0.9 },
    lamp: { color: 0xb080ff, intensity: 16 },
    fog: { color: 0x120e1a, near: 12, far: 26 },
    floor: 0x38284a, floorAlt: 0x312242, wall: 0x241a33, shelf: 0x2c2040,
    accent: 0xb080f0, zone: 0x80f0ff, bell: 0xe0d0ff, pad: 0xff8aa0,
    dummy: { body: 0xe2d8f0, trim: 0x7a4ad8, face: 0x120e1a },
    exposure: 1.14, ambience: 'night', music: 'cool',
    blurb: 'The inventor’s final exam room. Violet, velvet, volatile.',
  },
};

export const THEME_ORDER = ['brassworks', 'tidepool', 'emberworks', 'nocturne', 'verdant', 'midnight'];

export function themeById(id) {
  return THEMES[id] || THEMES.brassworks;
}

// Mastery-track unlock conditions (evaluated against progression).
export function themeUnlocked(theme, prog) {
  switch (theme.unlock) {
    case 'default': return true;
    case 'stars-20': return prog.totalStars >= 20;
    case 'stars-45': return prog.totalStars >= 45;
    case 'stars-70': return prog.totalStars >= 70;
    case 'stars-95': return prog.totalStars >= 95;
    case 'chapter-6': return (prog.stars['j33'] || 0) > 0;
    default: return false;
  }
}
