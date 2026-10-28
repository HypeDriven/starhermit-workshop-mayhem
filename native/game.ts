// The browser build's pure game modules (shared with the node tests), typed
// for this client: the rules (src/rules: the deterministic verlet physics at
// a fixed 1/120 s step, tools, legality, scoring, serialization), the content
// (src/content: 40 Journey stages, 8 challenges, 5 lessons, the Daily, themes,
// achievements), the session controller (src/session/session.js: validated
// commands, undo snapshots, replay envelope, results and progression) and the
// versioned, checksummed documents (src/session/persistence.js).
import * as engineMod from "../src/rules/engine.js";
import * as physicsMod from "../src/rules/physics.js";
import * as scoringMod from "../src/rules/scoring.js";
import * as serializeMod from "../src/rules/serialize.js";
import * as rngMod from "../src/rules/rng.js";
import * as stagesMod from "../src/content/stages.js";
import * as tutorialsMod from "../src/content/tutorials.js";
import * as dailyMod from "../src/content/daily.js";
import * as themesMod from "../src/content/themes.js";
import * as achievementsMod from "../src/content/achievements.js";
import * as schemaMod from "../src/content/schema.js";
import * as sessionMod from "../src/session/session.js";
import * as persistenceMod from "../src/session/persistence.js";

export type ToolKey = "piston" | "pad" | "fan" | "magnet" | "weight";
export interface Goal {
  type: string; primary: boolean; done: boolean; value: number; best: number; index: number;
  minSpeed?: number; holdTicks?: number; dist?: number; count?: number; ticks?: number; value2?: number; x?: number; y?: number; r?: number; bell?: number;
}
export interface Tool { id: number; type: ToolKey; x: number; y: number; dx: number; dy: number; status: string; mountId?: string | null }
export interface Particle { x: number; y: number; px: number; py: number; r: number }
export interface BodyRef { kind: string; start: number; count: number; toolId?: number }
export interface Mount { id: string; x: number; y: number; occupiedBy: number | null }
export interface Field { kind: string; x: number; y: number; dx: number; dy: number }
export interface Theme {
  id: string; name: string; unlock: string;
  key: { color: number; intensity: number; pos: [number, number, number] };
  hemi: { sky: number; ground: number; intensity: number };
  lamp: { color: number; intensity: number };
  fog: { color: number; near: number; far: number };
  floor: number; floorAlt: number; wall: number; shelf: number; accent: number; zone: number; bell: number; pad: number;
  dummy: { body: number; trim: number; face: number };
  exposure: number; ambience: string; music: string; blurb: string;
}
export interface Bounds { x: number; y: number; w: number; h: number }
export interface SolutionStep { do: string; tool?: ToolKey | null; x?: number; y?: number; dx?: number; dy?: number; mountId?: string | null; ticks?: number }
export interface Level {
  id: string; name: string; version: number; chapter: number; difficulty: number; theme: string; seed: number; intro?: string;
  tools: Partial<Record<ToolKey, number>>; goals: Goal[]; bounds: Bounds; par?: { ticks: number; score: number; star3: number };
  statics: { segments: [number, number, number, number, string?, number?][]; circles: [number, number, number, string?, string?][] };
  bells?: { x: number; y: number; r: number }[]; zones?: { x: number; y: number; r: number }[]; mounts?: { id: string; x: number; y: number }[];
  props?: { kind: string; x: number; y: number }[]; dummy: { x: number; y: number };
  solution?: SolutionStep[]; tutorial?: { steps: { text: string; expect?: { do?: string; ui?: string; tool?: string } }[] };
  challenge?: { moveLimit?: number; timeLimitTicks?: number }; daily?: { day: number; ruleset: number; excluded?: boolean };
}
export interface State {
  tick: number; phase: string; terminalReason: string | null; seed: number; settled: boolean;
  options: { allowUndo: boolean; moveLimit: number; maxTicks: number };
  world: { particles: Particle[]; fields: Field[]; segments: { x1: number; y1: number; x2: number; y2: number }[] };
  bodies: BodyRef[]; dummyBody: number; mounts: Mount[]; tools: Tool[]; stock: Record<ToolKey, number>; goals: Goal[];
  bounds: Bounds;
}
export interface Legal {
  phase: string; canAct: boolean; placements: { tool: ToolKey; stock: number; placement: string; mounts?: string[] }[];
  triggers: { toolId: number; type: ToolKey; x: number; y: number }[]; undo: boolean; skip: boolean; restart: boolean;
}
export interface ScoreResult { total: number; primaryComplete: boolean; components: Record<string, number> }
export interface Results {
  levelId: string; mode: string; reason: string; score: ScoreResult; stars: number; ticks: number;
  newRecord?: boolean; newAchievements?: { key: string }[]; progression?: Progression;
}
export interface GameEvent { t: string; [k: string]: unknown }
export interface CommandResult { accepted: boolean; reason?: string; toolId?: number; events?: GameEvent[] }
export interface Hint { kind: "place" | "trigger"; tool?: ToolKey; type?: ToolKey; x: number; y: number; dx?: number; dy?: number; mountId?: string | null; toolId?: number }
export interface Session {
  state: State | null; level: Level | null; mode: string | null; finished: Results | null; tutorialStep: number;
  interpAlpha: number; paused: boolean; speed: number; undoStack: unknown[];
  readonly legal: Legal | null; readonly summary: { score: number } | null; readonly dummyCenter: { x: number; y: number };
  start(level: Level, o: { mode: string; allowUndo?: boolean }): State;
  place(tool: ToolKey, x: number, y: number, dx: number, dy: number, mountId?: string | null): CommandResult;
  trigger(toolId: number): CommandResult;
  skip(): CommandResult; undo(): CommandResult; restart(): void; abandon(): void;
  tutorialUi(kind: string, data?: Record<string, unknown>): void;
  hint(): Hint | null;
  advance(dt: number): GameEvent[];
  setPaused(p: boolean): void;
  renderPositions(out: Float32Array): Float32Array;
  _capturePrev(): void;
}
export interface Progression {
  stars: Record<string, number>; bestScores: Record<string, { total: number; ticks: number }>; totalStars: number; xp: number;
  cosmetics: { theme: string }; totals: Record<string, number>; journey: { furthest: string };
}
export interface AchievementDoc { unlocked: Record<string, string>; seenTools: string[]; dailyDays: number[]; completionsTotal: number }
export interface Settings { tutorialDone: string[]; lastTheme: string; rules: { undoInPractice: boolean }; [k: string]: unknown }

interface EngineApi {
  TOOLS: Record<ToolKey, { key: ToolKey; placement: string; passive?: boolean; range?: number }>;
  explainPlacement(state: State, tool: ToolKey, x: number, y: number, mountId?: string | null): { ok: boolean; reason?: string; x?: number; y?: number };
  applyCommand(state: State, cmd: Record<string, unknown>): CommandResult;
  step(state: State): GameEvent[];
  dummyCenter(state: State): { x: number; y: number };
}
export const Engine = engineMod as unknown as EngineApi;
export const Physics = physicsMod as unknown as { DT: number; MAT: Record<string, number> };
export const Scoring = scoringMod as unknown as { starsFor(level: Level, score: ScoreResult): number };
export const Serialize = serializeMod as unknown as { cloneState(s: State): State };
export const Rng = rngMod as unknown as { createStream(seed: number): { next(): number } };
export const Stages = stagesMod as unknown as { JOURNEY: Level[]; CHALLENGES: Level[]; journeyById(id: string): Level | null };
export const Tutorials = tutorialsMod as unknown as { TUTORIALS: Level[]; tutorialById(id: string): Level | null };
export const Daily = dailyMod as unknown as { dailyLevel(day: number): Level };
export const Themes = themesMod as unknown as {
  THEMES: Record<string, Theme>; THEME_ORDER: string[]; themeById(id: string): Theme; themeUnlocked(t: Theme, p: Progression): boolean;
};
export const Achievements = achievementsMod as unknown as { ACHIEVEMENTS: { key: string }[]; emptyAchievementDoc(): AchievementDoc };
export const Schema = schemaMod as unknown as { BOUNDS: Bounds };
export const Persistence = persistenceMod as unknown as {
  loadLocal(kind: string): unknown; saveLocal(kind: string, data: unknown): unknown; wrapDoc(kind: string, data: unknown): unknown;
  unwrapDoc(kind: string, doc: unknown): unknown; mergeProgression(a: unknown, b: unknown): Progression;
  DEFAULT_SETTINGS: Settings; DEFAULT_PROFILE: { displayName: string; guest: boolean }; DEFAULT_PROGRESSION: Progression;
};
export const createSession = (onEvent: (ev: GameEvent) => void, platform: unknown): Session =>
  new (sessionMod as unknown as { SessionController: new (o: { platform: unknown; onEvent: (ev: GameEvent) => void }) => Session }).SessionController({ platform, onEvent });
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
