export type Variable = "temperature" | "humidity";
export type Direction = "gte" | "lte";

export interface AlertInfo {
  active: boolean | null;
  variable: Variable | null;
  direction: Direction | null;
  threshold: number | null;
  since: number | null; // ms epoch
  emailSent: boolean | null;
}

export interface ActionItem {
  t: number | null;
  tool: string;
}

export interface AlertRow {
  t: number | null;
  variable: Variable | null;
  value: number | null;
  emailSent: boolean | null;
}

export interface Status {
  lastReadingAt: number | null; // ms epoch
  current: { temperature: number | null; humidity: number | null } | null;
  alert: AlertInfo | null;
  codex: {
    displayMessage: string | null;
    led: string | null;
    recentActions: ActionItem[];
  };
  alerts: AlertRow[];
}

export interface Reading {
  t: number; // ms epoch
  temperature: number | null;
  humidity: number | null;
}

export interface ReadingsData {
  readings: Reading[];
  window: { from: number; to: number };
  stats: { temperature: Stats | null; humidity: Stats | null };
}

export interface Stats {
  min: number;
  max: number;
  avg: number;
}
