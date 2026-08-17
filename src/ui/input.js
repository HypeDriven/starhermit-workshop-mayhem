// Unified input: pointer/touch raycast placement with pointer capture,
// keyboard navigation with a virtual cursor, gamepad polling, remappable
// bindings, and action-id double-commit prevention (spec §3 input).
import { explainPlacement, TOOLS } from '../rules/engine.js';

export const DEFAULT_BINDINGS = {
  keyboard: {
    confirm: 'Enter', trigger: 'Space', cancel: 'Escape', pause: 'KeyP',
    undo: 'KeyU', hint: 'KeyH', restart: 'KeyR', skip: 'KeyS',
    camera: 'KeyC', mute: 'KeyM', tool1: 'Digit1', tool2: 'Digit2',
    tool3: 'Digit3', tool4: 'Digit4', tool5: 'Digit5',
  },
  gamepad: {
    confirm: 0, cancel: 1, trigger: 2, hint: 3, toolPrev: 4, toolNext: 5,
    undo: 8, pause: 9, camera: 10,
  },
};

export const BINDING_LABELS = {
  confirm: 'Confirm / place', trigger: 'Trigger tool', cancel: 'Cancel',
  pause: 'Pause', undo: 'Undo', hint: 'Hint', restart: 'Restart round',
  skip: 'Fast-forward', camera: 'Camera reset', mute: 'Mute',
  tool1: 'Tool slot 1', tool2: 'Tool slot 2', tool3: 'Tool slot 3',
  tool4: 'Tool slot 4', tool5: 'Tool slot 5',
  toolPrev: 'Previous tool', toolNext: 'Next tool',
};

const TOOL_ORDER = ['piston', 'pad', 'fan', 'magnet', 'weight'];
const TAP_DIST = 10;      // px
const CURSOR_STEP = 0.25; // m per keypress
const AIM_STEP = 0.07;    // radians-ish per keypress

export class InputController {
  constructor({ canvas, session, scene, callbacks }) {
    this.canvas = canvas;
    this.session = session;
    this.scene = scene;
    this.cb = callbacks; // {pause, cameraReset, mute, hint, undo, restart, skip, announce, trayChanged, tutorialUi}
    this.enabled = false;
    this.selectedTool = null;
    this.drag = null;          // {startPt, startPx, startTime, pointerId}
    this.virtualCursor = null; // {x,y} world
    this.aimEdit = null;       // {toolId, x, y, mountId, tool, dx, dy}
    this.hoverPt = null;
    this.gamepadState = { buttons: [], axes: [0, 0] };
    this.padRepeat = { t: 0, dir: null };
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.lastPointerType = 'mouse';
    this.pendingPlace = 0;
    this.bind();
  }

  setBindings(b) {
    if (b?.keyboard) Object.assign(this.bindings.keyboard, b.keyboard);
    if (b?.gamepad) Object.assign(this.bindings.gamepad, b.gamepad);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancelAll();
  }

  get state() { return this.session.state; }

  // --- tool selection ---------------------------------------------------------
  selectTool(tool) {
    if (!this.enabled || !this.state) return;
    if (this.selectedTool === tool) { this.deselect(); return; }
    const legal = this.session.legal;
    if (!legal?.placements.find(p => p.tool === tool)) {
      this.cb.announce?.(`${TOOLS[tool]?.name ?? tool} is out of stock`);
      return;
    }
    this.selectedTool = tool;
    this.aimEdit = null;
    this.scene.showGhost(tool);
    this.scene.levelView?.setMountHighlight(
      TOOLS[tool].placement === 'mount',
      legal.placements.find(p => p.tool === tool)?.mounts,
    );
    if (!this.virtualCursor) {
      const dc = this.session.dummyCenter;
      this.virtualCursor = { x: dc.x + 1, y: Math.max(0.4, dc.y + 0.5) };
    }
    this.cb.trayChanged?.(tool);
    this.cb.tutorialUi?.('select-tool', { tool });
    this.updateGhost(this.hoverPt ?? this.virtualCursor);
  }

  deselect() {
    this.selectedTool = null;
    this.aimEdit = null;
    this.scene.hideGhost();
    this.scene.levelView?.setMountHighlight(false);
    this.cb.trayChanged?.(null);
  }

  cancelAll() {
    this.deselect();
    this.drag = null;
    this.aimEdit = null;
    this.hideCrosshair();
  }

  // --- pointer ------------------------------------------------------------------
  bind() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    c.addEventListener('lostpointercapture', (e) => this.onPointerCancel(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('gamepadconnected', () => this.cb.announce?.('Gamepad connected'));
  }

  toWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndy = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return this.scene.screenToWorld(ndx, ndy);
  }

  onPointerDown(e) {
    if (!this.enabled) return;
    this.lastPointerType = e.pointerType;
    this.canvas.setPointerCapture(e.pointerId);
    const pt = this.toWorld(e);
    if (!pt) return;
    this.drag = { startPt: pt, startPx: { x: e.clientX, y: e.clientY }, startTime: performance.now(), pointerId: e.pointerId, aiming: false };
    e.preventDefault();
  }

  onPointerMove(e) {
    if (!this.enabled || !this.state) return;
    const pt = this.toWorld(e);
    if (!pt) return;
    this.hoverPt = pt;
    this.virtualCursor = pt;
    if (this.drag && this.selectedTool) {
      const dist = Math.hypot(e.clientX - this.drag.startPx.x, e.clientY - this.drag.startPx.y);
      if (dist > TAP_DIST) this.drag.aiming = true;
      this.updateGhost(this.drag.startPt, pt);
    } else if (this.selectedTool) {
      this.updateGhost(pt);
    }
  }

  onPointerUp(e) {
    if (!this.enabled || !this.drag) return;
    const pt = this.toWorld(e) ?? this.drag.startPt;
    const drag = this.drag;
    this.drag = null;
    if (this.selectedTool) {
      this.commitPlacement(drag.startPt, pt, drag.aiming);
    } else {
      // tap on an armed world tool triggers it
      const tool = this.nearestTool(pt, 0.65);
      if (tool && tool.status === 'armed') this.session.trigger(tool.id);
    }
  }

  onPointerCancel() {
    // cancel safely on lost capture (spec §3)
    this.drag = null;
    if (this.selectedTool) this.updateGhost(this.hoverPt ?? this.virtualCursor);
  }

  nearestTool(pt, maxDist) {
    if (!this.state) return null;
    let best = null, bd = maxDist;
    for (const t of this.state.tools) {
      if (t.type === 'pad') continue;
      const d = Math.hypot(t.x - pt.x, t.y - pt.y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // ghost + validity preview
  updateGhost(pt, dragPt = null) {
    if (!this.selectedTool || !this.state) return;
    const tool = this.selectedTool;
    const def = TOOLS[tool];
    let placePt = pt;
    let mountId = null;
    let angle = 0;
    if (def.placement === 'mount') {
      const mount = this.scene.nearestMount(dragPt ?? pt, 1.4);
      mountId = mount?.id ?? this.session.legal?.placements.find(p => p.tool === tool)?.mounts?.[0] ?? null;
      const mv = this.scene.levelView?.mountViews.find(v => v.id === mountId);
      if (mv) placePt = { x: mv.x, y: mv.y };
      const aimTarget = dragPt ?? this.session.dummyCenter;
      angle = Math.atan2(aimTarget.y - placePt.y, aimTarget.x - placePt.x);
    } else if (def.placement === 'ground') {
      angle = 0;
    } else {
      angle = dragPt ? Math.atan2(dragPt.y - pt.y, dragPt.x - pt.x) : Math.atan2(0.1, 1);
    }
    const check = explainPlacement(this.state, tool, placePt.x, placePt.y, mountId);
    this.scene.setGhostPose(check.ok ? { x: check.x, y: check.y } : placePt, angle, check.ok);
    // trajectory preview for piston while aiming
    if (tool === 'piston' && check.ok) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const pts = this.scene.previewTrajectory(this.session, { type: 'place', tool, x: check.x, y: check.y, dx, dy, mountId });
      this.scene.ghost.setTrajectory(pts);
    } else {
      this.scene.ghost.setTrajectory(null);
    }
    this.lastCheck = { ...check, angle, mountId };
    this.showCrosshairAt(placePt);
  }

  commitPlacement(startPt, endPt, wasDrag) {
    const tool = this.selectedTool;
    if (!tool || !this.state) return;
    const def = TOOLS[tool];
    const chk = this.lastCheck ?? {};
    let dx = chk.dx ?? 1, dy = chk.dy ?? 0.1;
    if (def.placement === 'mount') {
      const aim = wasDrag ? endPt : this.session.dummyCenter;
      const from = chk.ok ? { x: chk.x, y: chk.y } : startPt;
      const ax = aim.x - from.x, ay = aim.y - from.y;
      const al = Math.hypot(ax, ay) || 1;
      dx = ax / al; dy = ay / al;
    } else if (!def.passive && wasDrag) {
      const ax = endPt.x - startPt.x, ay = endPt.y - startPt.y;
      const al = Math.hypot(ax, ay);
      if (al > 0.2) { dx = ax / al; dy = ay / al; }
    }
    if (this.pendingPlace > performance.now()) return; // action-id double-commit guard
    this.pendingPlace = performance.now() + 120;
    if (wasDrag || def.placement === 'mount') this.cb.tutorialUi?.('aim');
    const result = this.session.place(tool, startPt.x, startPt.y, dx, dy, chk.mountId ?? null);
    if (result.accepted) {
      this.scene.ghost.setTrajectory(null);
      if (this.consumeStock(tool)) this.deselect();
      else this.updateGhost(endPt);
    } else {
      this.scene.setGhostPose(startPt, 0, false);
    }
  }

  consumeStock(tool) {
    return (this.state?.stock[tool] ?? 0) <= 0;
  }

  // --- keyboard ------------------------------------------------------------------
  onKeyDown(e) {
    if (!this.enabled) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const kb = this.bindings.keyboard;
    const code = e.code;
    const toolKey = Object.entries(kb).find(([k]) => k.startsWith('tool') && kb[k] === code);
    if (toolKey && toolKey[0].length === 5) {
      const idx = parseInt(toolKey[0].slice(4), 10) - 1;
      const stockTool = TOOL_ORDER.filter(t => (this.state?.stock[t] ?? 0) > 0)[idx]
        ?? TOOL_ORDER[idx];
      if (stockTool) this.selectTool(stockTool);
      e.preventDefault();
      return;
    }
    if (this.selectedTool && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
      this.moveVirtualCursor(code, e.shiftKey);
      e.preventDefault();
      return;
    }
    switch (code) {
      case kb.confirm: this.keyConfirm(); e.preventDefault(); break;
      case kb.trigger: this.keyTrigger(); e.preventDefault(); break;
      case kb.cancel: this.keyCancel(); e.preventDefault(); break;
      case kb.pause: this.cb.pause?.(); e.preventDefault(); break;
      case kb.undo: this.cb.undo?.(); e.preventDefault(); break;
      case kb.hint: this.cb.hint?.(); e.preventDefault(); break;
      case kb.restart: this.cb.restart?.(); e.preventDefault(); break;
      case kb.skip: this.cb.skip?.(); e.preventDefault(); break;
      case kb.camera: this.cb.cameraReset?.(); e.preventDefault(); break;
      case kb.mute: this.cb.mute?.(); e.preventDefault(); break;
    }
  }

  moveVirtualCursor(code, fine) {
    if (!this.virtualCursor) {
      const dc = this.session.dummyCenter;
      this.virtualCursor = { x: dc.x, y: dc.y + 0.5 };
    }
    const step = (fine ? CURSOR_STEP / 3 : CURSOR_STEP);
    if (code === 'ArrowUp') this.virtualCursor.y += step;
    if (code === 'ArrowDown') this.virtualCursor.y -= step;
    if (code === 'ArrowLeft') this.virtualCursor.x -= step;
    if (code === 'ArrowRight') this.virtualCursor.x += step;
    this.updateGhost(this.virtualCursor);
  }

  keyConfirm() {
    if (!this.selectedTool || !this.state) return;
    const pt = this.virtualCursor ?? this.session.dummyCenter;
    this.updateGhost(pt);
    this.commitPlacement(pt, pt, false);
  }

  keyTrigger() {
    if (!this.state) return;
    const armed = this.session.legal?.triggers;
    if (armed?.length) this.session.trigger(armed[0].toolId);
  }

  keyCancel() {
    if (this.selectedTool) this.deselect();
    else this.cb.pause?.();
  }

  // --- gamepad ---------------------------------------------------------------------
  pollGamepad(dt) {
    if (!this.enabled) return;
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find(p => p && p.connected);
    if (!gp) return;
    const gb = this.bindings.gamepad;
    const press = (i) => gp.buttons[i]?.pressed;
    const pressedOnce = (i, key) => {
      const was = this.gamepadState.buttons[i];
      this.gamepadState.buttons[i] = press(i);
      return press(i) && !was;
    };
    // sticks move the virtual cursor / ghost
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    if (Math.abs(ax) > 0.18 || Math.abs(ay) > 0.18) {
      if (!this.virtualCursor) this.virtualCursor = { ...this.session.dummyCenter };
      this.virtualCursor.x += ax * dt * 4;
      this.virtualCursor.y -= ay * dt * 4;
      this.hoverPt = this.virtualCursor;
      if (this.selectedTool) this.updateGhost(this.virtualCursor);
      this.showCrosshairAt(this.virtualCursor);
    }
    if (pressedOnce(gb.confirm, 'confirm') && this.selectedTool) this.keyConfirm();
    if (pressedOnce(gb.trigger, 'trigger')) this.keyTrigger();
    if (pressedOnce(gb.cancel, 'cancel')) this.keyCancel();
    if (pressedOnce(gb.pause, 'pause')) this.cb.pause?.();
    if (pressedOnce(gb.hint, 'hint')) this.cb.hint?.();
    if (pressedOnce(gb.undo, 'undo')) this.cb.undo?.();
    if (pressedOnce(gb.camera, 'camera')) this.cb.cameraReset?.();
    if (pressedOnce(gb.toolPrev, 'tp')) this.cycleTool(-1);
    if (pressedOnce(gb.toolNext, 'tn')) this.cycleTool(1);
  }

  cycleTool(dir) {
    const avail = TOOL_ORDER.filter(t => (this.state?.stock[t] ?? 0) > 0);
    if (!avail.length) return;
    const cur = avail.indexOf(this.selectedTool);
    const next = avail[(cur + dir + avail.length) % avail.length];
    this.selectTool(next);
  }

  // --- crosshair (DOM, native resolution) -------------------------------------------
  showCrosshairAt(pt) {
    const el = document.getElementById('crosshair');
    if (!el) return;
    const s = this.scene.worldToScreen(pt.x, pt.y, 0.3);
    el.style.display = 'block';
    el.style.transform = `translate(${s.x - 14}px, ${s.y - 14}px)`;
  }

  hideCrosshair() {
    const el = document.getElementById('crosshair');
    if (el) el.style.display = 'none';
  }

  frame(dt) {
    this.pollGamepad(dt);
  }
}
