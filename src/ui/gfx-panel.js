// Graphics section of the Settings screen: quality preset, render scale,
// per-effect overrides, adaptive resolution and frame-rate readout, with a
// live GPU / cost summary. Strings are localized from navigator.language
// (the game has no language setting of its own).
import { PRESETS, CATEGORIES, presetTier, withPreset, describe, SHADOW_MAP } from '../render/gfx.js';

const EN = {
  title: 'Graphics',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})',
  cat_shadows: 'Shadows', cat_ao: 'Ambient occlusion', cat_bloom: 'Bloom', cat_grade: 'Colour grade',
  cat_antialias: 'Anti-aliasing', cat_reflections: 'Reflections', cat_particles: 'Particles', cat_detail: 'Workshop detail',
  t_off: 'Off', t_on: 'On', t_low: 'Low', t_medium: 'Medium', t_high: 'High',
  t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Plain', t_detailed: 'Detailed',
  adaptive: 'Adaptive resolution',
  showFps: 'Show frame rate',
  hint: 'Changes apply immediately and only affect how the workshop looks, never the rules.',
  postFailed: 'Post-processing is unavailable on this device, so the workshop renders without it.',
  s_noShadows: 'no shadows', s_shadows: '{n}² shadows', s_ao: 'ambient occlusion', s_aoFull: 'full ambient occlusion',
  s_reflections: 'reflections', s_bloom: 'bloom', s_noAA: 'no anti-aliasing',
};

const STRINGS = {
  'en-US': { ...EN, cat_grade: 'Color grade' },
  'en-GB': EN,
  'es-419': {
    title: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Corrección de color',
    cat_antialias: 'Antialiasing', cat_reflections: 'Reflejos', cat_particles: 'Partículas', cat_detail: 'Detalle del taller',
    t_off: 'No', t_on: 'Sí', t_low: 'Bajas', t_medium: 'Medias', t_high: 'Altas',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simple', t_detailed: 'Detallado',
    adaptive: 'Resolución adaptable', showFps: 'Mostrar FPS',
    hint: 'Los cambios se aplican al instante y solo afectan el aspecto del taller, nunca las reglas.',
    postFailed: 'El posprocesamiento no está disponible en este dispositivo, así que el taller se muestra sin él.',
    s_noShadows: 'sin sombras', s_shadows: 'sombras de {n}²', s_ao: 'oclusión ambiental', s_aoFull: 'oclusión ambiental completa',
    s_reflections: 'reflejos', s_bloom: 'resplandor', s_noAA: 'sin antialiasing',
  },
  'es-ES': {
    title: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Etalonaje',
    cat_antialias: 'Suavizado de bordes', cat_reflections: 'Reflejos', cat_particles: 'Partículas', cat_detail: 'Detalle del taller',
    t_off: 'No', t_on: 'Sí', t_low: 'Bajas', t_medium: 'Medias', t_high: 'Altas',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Sencillo', t_detailed: 'Detallado',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    hint: 'Los cambios se aplican al momento y solo afectan al aspecto del taller, nunca a las reglas.',
    postFailed: 'El posprocesado no está disponible en este dispositivo, así que el taller se muestra sin él.',
    s_noShadows: 'sin sombras', s_shadows: 'sombras de {n}²', s_ao: 'oclusión ambiental', s_aoFull: 'oclusión ambiental completa',
    s_reflections: 'reflejos', s_bloom: 'resplandor', s_noAA: 'sin suavizado',
  },
  'de-DE': {
    title: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
    renderScale: 'Renderskalierung', fromPreset: 'Aus Voreinstellung ({tier})',
    cat_shadows: 'Schatten', cat_ao: 'Umgebungsverdeckung', cat_bloom: 'Bloom', cat_grade: 'Farbkorrektur',
    cat_antialias: 'Kantenglättung', cat_reflections: 'Spiegelungen', cat_particles: 'Partikel', cat_detail: 'Werkstattdetails',
    t_off: 'Aus', t_on: 'An', t_low: 'Niedrig', t_medium: 'Mittel', t_high: 'Hoch',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Schlicht', t_detailed: 'Detailliert',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    hint: 'Änderungen gelten sofort und betreffen nur das Aussehen der Werkstatt, nie die Regeln.',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; die Werkstatt wird ohne sie dargestellt.',
    s_noShadows: 'keine Schatten', s_shadows: '{n}²-Schatten', s_ao: 'Umgebungsverdeckung', s_aoFull: 'volle Umgebungsverdeckung',
    s_reflections: 'Spiegelungen', s_bloom: 'Bloom', s_noAA: 'keine Kantenglättung',
  },
  'fr-FR': {
    title: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Étalonnage des couleurs',
    cat_antialias: 'Anticrénelage', cat_reflections: 'Reflets', cat_particles: 'Particules', cat_detail: 'Détails de l’atelier',
    t_off: 'Désactivé', t_on: 'Activé', t_low: 'Basses', t_medium: 'Moyennes', t_high: 'Hautes',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simple', t_detailed: 'Détaillé',
    adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    hint: 'Les changements s’appliquent immédiatement et ne modifient que l’apparence de l’atelier, jamais les règles.',
    postFailed: 'Le post-traitement n’est pas disponible sur cet appareil ; l’atelier s’affiche sans lui.',
    s_noShadows: 'sans ombres', s_shadows: 'ombres {n}²', s_ao: 'occlusion ambiante', s_aoFull: 'occlusion ambiante complète',
    s_reflections: 'reflets', s_bloom: 'halo', s_noAA: 'sans anticrénelage',
  },
  'fr-CA': {
    title: 'Graphiques', quality: 'Qualité', auto: 'Automatique (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Correction des couleurs',
    cat_antialias: 'Anticrénelage', cat_reflections: 'Reflets', cat_particles: 'Particules', cat_detail: 'Détails de l’atelier',
    t_off: 'Désactivé', t_on: 'Activé', t_low: 'Basses', t_medium: 'Moyennes', t_high: 'Hautes',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simple', t_detailed: 'Détaillé',
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    hint: 'Les changements s’appliquent tout de suite et ne touchent que l’apparence de l’atelier, jamais les règles.',
    postFailed: 'Le post-traitement n’est pas offert sur cet appareil; l’atelier s’affiche sans lui.',
    s_noShadows: 'sans ombres', s_shadows: 'ombres {n}²', s_ao: 'occlusion ambiante', s_aoFull: 'occlusion ambiante complète',
    s_reflections: 'reflets', s_bloom: 'halo', s_noAA: 'sans anticrénelage',
  },
  'pt-BR': {
    title: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    cat_shadows: 'Sombras', cat_ao: 'Oclusão de ambiente', cat_bloom: 'Brilho', cat_grade: 'Correção de cor',
    cat_antialias: 'Antisserrilhamento', cat_reflections: 'Reflexos', cat_particles: 'Partículas', cat_detail: 'Detalhes da oficina',
    t_off: 'Desligado', t_on: 'Ligado', t_low: 'Baixas', t_medium: 'Médias', t_high: 'Altas',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simples', t_detailed: 'Detalhada',
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    hint: 'As mudanças valem na hora e só afetam a aparência da oficina, nunca as regras.',
    postFailed: 'O pós-processamento não está disponível neste aparelho, então a oficina é exibida sem ele.',
    s_noShadows: 'sem sombras', s_shadows: 'sombras {n}²', s_ao: 'oclusão de ambiente', s_aoFull: 'oclusão de ambiente completa',
    s_reflections: 'reflexos', s_bloom: 'brilho', s_noAA: 'sem antisserrilhamento',
  },
  'it-IT': {
    title: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
    cat_shadows: 'Ombre', cat_ao: 'Occlusione ambientale', cat_bloom: 'Bagliore', cat_grade: 'Correzione colore',
    cat_antialias: 'Antialiasing', cat_reflections: 'Riflessi', cat_particles: 'Particelle', cat_detail: 'Dettagli dell’officina',
    t_off: 'No', t_on: 'Sì', t_low: 'Basse', t_medium: 'Medie', t_high: 'Alte',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Semplice', t_detailed: 'Dettagliata',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frame rate',
    hint: 'Le modifiche si applicano subito e cambiano solo l’aspetto dell’officina, mai le regole.',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo, quindi l’officina viene mostrata senza.',
    s_noShadows: 'nessuna ombra', s_shadows: 'ombre {n}²', s_ao: 'occlusione ambientale', s_aoFull: 'occlusione ambientale completa',
    s_reflections: 'riflessi', s_bloom: 'bagliore', s_noAA: 'nessun antialiasing',
  },
};

// es-* → es-419 except Spain; fr-* → fr-FR except Canada; pt → pt-BR; en → en-US except GB-like.
export function pickLocale(langs) {
  for (const raw of langs || []) {
    const tag = String(raw || '');
    if (STRINGS[tag]) return tag;
    const [lang, region = ''] = tag.split('-');
    const r = region.toUpperCase();
    if (lang === 'en') return ['GB', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(r) ? 'en-GB' : 'en-US';
    if (lang === 'es') return r === 'ES' ? 'es-ES' : 'es-419';
    if (lang === 'fr') return r === 'CA' ? 'fr-CA' : 'fr-FR';
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'de') return 'de-DE';
    if (lang === 'it') return 'it-IT';
  }
  return 'en-US';
}

export const GFX_LOCALES = Object.keys(STRINGS);
export function gfxStrings(locale) { return STRINGS[locale] || STRINGS['en-US']; }

function navLangs() {
  try { return navigator.languages?.length ? navigator.languages : [navigator.language]; } catch { return []; }
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function summaryText(info, L) {
  const words = {
    noShadows: L.s_noShadows, shadows: (r) => L.s_shadows.replace('{n}', SHADOW_MAP[r.shadows]),
    ao: L.s_ao, aoFull: L.s_aoFull, reflections: L.s_reflections, bloom: L.s_bloom, noAA: L.s_noAA,
  };
  const r = info.resolved;
  const px = info.summary.match(/(\d+)×(\d+) px/);
  return `${info.gpu} · ${describe(r, px ? [px[1], px[2]] : null, words)}`;
}

/** Markup for the Graphics card. `saved` = settings.graphics; `info` = scene.graphicsInfo(). */
export function graphicsCardHtml(saved, info) {
  const L = gfxStrings(pickLocale(navLangs()));
  const tierName = (p) => L[p] || p;
  const r = info.resolved;
  const presetValue = PRESETS.includes(saved.preset) ? saved.preset : 'auto';
  const scalePct = Math.round((Number(saved.render_scale) || 1) * 100);
  const cats = Object.entries(CATEGORIES).map(([cat, tiers]) => {
    const own = presetTier(r.preset, cat);
    const cur = tiers.includes(saved[cat]) ? saved[cat] : 'preset';
    return `
      <label class="gfx-row">${esc(L[`cat_${cat}`])}
        <select id="gfx-${cat}" data-gfx-cat="${cat}">
          <option value="preset" ${cur === 'preset' ? 'selected' : ''}>${esc(L.fromPreset.replace('{tier}', L[`t_${own}`]))}</option>
          ${tiers.map(t => `<option value="${t}" ${cur === t ? 'selected' : ''}>${esc(L[`t_${t}`])}</option>`).join('')}
        </select>
      </label>`;
  }).join('');
  return `
    <h2>${esc(L.title)}</h2>
    <label class="gfx-row">${esc(L.quality)}
      <select id="gfx-preset" data-gfx="preset">
        <option value="auto" ${presetValue === 'auto' ? 'selected' : ''}>${esc(L.auto.replace('{tier}', tierName(info.detected)))}</option>
        ${PRESETS.map(p => `<option value="${p}" ${presetValue === p ? 'selected' : ''}>${esc(tierName(p))}</option>`).join('')}
      </select>
    </label>
    <label class="gfx-row gfx-scale">${esc(L.renderScale)}
      <span class="gfx-scale-line">
        <input type="range" id="gfx-scale" data-gfx="render_scale" min="50" max="200" step="5" value="${scalePct}" />
        <output id="gfx-scale-val" for="gfx-scale">${scalePct}%</output>
      </span>
    </label>
    ${cats}
    <label><input type="checkbox" id="gfx-adaptive" data-gfx="adaptive" ${saved.adaptive !== false ? 'checked' : ''} /> ${esc(L.adaptive)}</label>
    <label><input type="checkbox" id="gfx-fps" data-gfx="show_fps" ${saved.show_fps ? 'checked' : ''} /> ${esc(L.showFps)}</label>
    <p class="muted gfx-summary" id="gfx-summary" aria-live="polite">${esc(summaryText(info, L))}</p>
    <p class="muted gfx-note" id="gfx-post-note" ${info.postFailed ? '' : 'hidden'}>${esc(L.postFailed)}</p>
    <p class="muted">${esc(L.hint)}</p>`;
}

/**
 * Wire the Graphics card. `getSaved()` returns settings.graphics; `apply(next)`
 * saves + applies; `getInfo()` reads scene.graphicsInfo().
 */
export function bindGraphicsCard(card, { getSaved, apply, getInfo }) {
  const L = gfxStrings(pickLocale(navLangs()));
  const rerender = () => {
    const focusId = document.activeElement?.id;
    card.innerHTML = graphicsCardHtml(getSaved(), getInfo());
    if (focusId) card.querySelector(`#${focusId}`)?.focus();
  };
  const refreshSummary = () => {
    const info = getInfo();
    const sum = card.querySelector('#gfx-summary');
    if (sum) sum.textContent = summaryText(info, L);
    const note = card.querySelector('#gfx-post-note');
    if (note) note.hidden = !info.postFailed;
  };
  card.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'gfx-scale') {
      const out = card.querySelector('#gfx-scale-val');
      if (out) out.textContent = `${el.value}%`;
    }
  });
  card.addEventListener('change', (e) => {
    const el = e.target;
    const saved = { ...getSaved() };
    let next = null;
    if (el.dataset.gfx === 'preset') next = withPreset(saved, el.value);
    else if (el.dataset.gfx === 'render_scale') next = { ...saved, render_scale: Number(el.value) / 100 };
    else if (el.dataset.gfx === 'adaptive') next = { ...saved, adaptive: el.checked };
    else if (el.dataset.gfx === 'show_fps') next = { ...saved, show_fps: el.checked };
    else if (el.dataset.gfxCat) {
      next = { ...saved };
      if (el.value === 'preset') delete next[el.dataset.gfxCat];
      else next[el.dataset.gfxCat] = el.value;
    }
    if (!next) return;
    apply(next);
    // preset change relabels every "From preset (…)" option and clears overrides
    if (el.dataset.gfx === 'preset') rerender();
    else refreshSummary();
  });
  // keep the pixel size / post note current (adaptive resolution, resizes)
  const timer = setInterval(() => {
    if (!card.isConnected) { clearInterval(timer); return; }
    refreshSummary();
  }, 1000);
  // the first frames after a change may rebuild the post chain
  setTimeout(refreshSummary, 300);
}
