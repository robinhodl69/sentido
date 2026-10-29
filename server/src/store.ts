import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, KEEP_MS, STALE_MS } from "./config.js";
import type { Device, PersistedState, Reading } from "./types.js";

const READINGS_FILE = path.join(DATA_DIR, "readings.jsonl");
const DB_FILE = path.join(DATA_DIR, "sentido.db");
const STATE_FILE = path.join(DATA_DIR, "state.json");

export const readings: Reading[] = [];
export let device: Device | null = null;
export const recentActions: { t: string; tool: string }[] = []; // mas reciente primero

export const state: PersistedState = {
  rule: null,
  active: false,
  since: null,
  history: [],
  display: null,
  led: null,
};

let db: DatabaseSync;

export function database(): DatabaseSync {
  if (!db) throw new Error("El almacenamiento no está inicializado");
  return db;
}

export function initStore(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS readings (t INTEGER PRIMARY KEY, temperature REAL NOT NULL, humidity REAL NOT NULL)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      variable TEXT NOT NULL CHECK (variable IN ('temperature', 'humidity')),
      direction TEXT NOT NULL CHECK (direction IN ('gt', 'gte', 'lt', 'lte')),
      threshold REAL NOT NULL, recipient TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, name TEXT NOT NULL,
      triggered_at TEXT NOT NULL, variable TEXT NOT NULL, direction TEXT NOT NULL,
      threshold REAL NOT NULL, value REAL NOT NULL, recipient TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'unknown')),
      error TEXT, sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS automation_runs_time ON automation_runs(triggered_at DESC);
  `);

  // Migracion unica: importa el historial de readings.jsonl si existe
  if (fs.existsSync(READINGS_FILE)) {
    const ins = db.prepare("INSERT OR IGNORE INTO readings (t, temperature, humidity) VALUES (?, ?, ?)");
    let n = 0;
    db.exec("BEGIN");
    for (const line of fs.readFileSync(READINGS_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { t: string; temperature: number; humidity: number };
        const t = Date.parse(o.t);
        if (Number.isFinite(t) && Number.isFinite(o.temperature) && Number.isFinite(o.humidity)) {
          ins.run(t, o.temperature, o.humidity);
          n++;
        }
      } catch {
        /* linea danada, se ignora */
      }
    }
    db.exec("COMMIT");
    fs.renameSync(READINGS_FILE, READINGS_FILE + ".migrado");
    console.log(`[store] migradas ${n} lecturas de readings.jsonl a SQLite`);
  }

  // Carga a memoria los ultimos 7 dias
  const cutoff = Date.now() - KEEP_MS;
  const rows = db
    .prepare("SELECT t, temperature, humidity FROM readings WHERE t >= ? ORDER BY t")
    .all(cutoff) as { t: number; temperature: number; humidity: number }[];
  for (const r of rows) readings.push({ t: r.t, temperature: r.temperature, humidity: r.humidity });
  console.log(`[store] lecturas cargadas desde SQLite: ${readings.length}`);

  if (fs.existsSync(STATE_FILE)) {
    try {
      Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
    } catch (e) {
      console.warn("[store] state.json ilegible, se ignora:", (e as Error).message);
    }
  }
}

export function saveState(): void {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export function addReading(r: Reading, dev: Device): void {
  readings.push(r);
  const cutoff = Date.now() - KEEP_MS;
  while (readings.length && readings[0].t < cutoff) readings.shift();
  device = dev;
  try {
    db.prepare("INSERT OR REPLACE INTO readings (t, temperature, humidity) VALUES (?, ?, ?)").run(r.t, r.temperature, r.humidity);
  } catch (e) {
    console.error("[store] no pude guardar en SQLite:", (e as Error).message);
  }
}

export function logAction(tool: string): void {
  recentActions.unshift({ t: new Date().toISOString(), tool });
  recentActions.length = Math.min(recentActions.length, 20);
}

export function lastReading(): Reading | null {
  return readings.length ? readings[readings.length - 1] : null;
}

/** Lectura actual: solo si tiene menos de 30 s. Si no, null (nunca un dato viejo). */
export function currentReading(now = Date.now()): Reading | null {
  const r = lastReading();
  return r && now - r.t <= STALE_MS ? r : null;
}

export function readingsSince(minutes: number, now = Date.now()): Reading[] {
  const from = now - minutes * 60_000;
  return readings.filter((r) => r.t >= from && r.t <= now);
}

export interface Point {
  t: string;
  temperature: number;
  humidity: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Si hay mas de maxPoints, promedia por cubetas de tiempo (promedios reales, nada inventado). */
export function downsample(list: Reading[], minutes: number, maxPoints: number, now = Date.now()): Point[] {
  const toPoint = (r: Reading): Point => ({ t: new Date(r.t).toISOString(), temperature: r.temperature, humidity: r.humidity });
  if (list.length <= maxPoints) return list.map(toPoint);
  const from = now - minutes * 60_000;
  const width = (minutes * 60_000) / maxPoints;
  const buckets = new Map<number, Reading[]>();
  for (const r of list) {
    const i = Math.min(maxPoints - 1, Math.max(0, Math.floor((r.t - from) / width)));
    const b = buckets.get(i);
    if (b) b.push(r);
    else buckets.set(i, [r]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => {
      const avg = (f: (r: Reading) => number) => b.reduce((s, r) => s + f(r), 0) / b.length;
      return {
        t: new Date(Math.round(avg((r) => r.t))).toISOString(),
        temperature: round1(avg((r) => r.temperature)),
        humidity: round1(avg((r) => r.humidity)),
      };
    });
}
