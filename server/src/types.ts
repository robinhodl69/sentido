export type Variable = "temperature" | "humidity";
export type Direction = "gte" | "lte";
export const LED_COLORS = ["rojo", "verde", "azul", "amarillo", "blanco", "apagado"] as const;
export type LedColor = (typeof LED_COLORS)[number];

export interface Reading {
  t: number; // ms epoch (reloj del servidor)
  temperature: number;
  humidity: number;
}

export interface Rule {
  variable: Variable;
  direction: Direction;
  threshold: number;
}

export interface AlertEntry {
  t: string; // ISO
  variable: Variable;
  value: number;
  emailSent: boolean;
}

export interface PersistedState {
  rule: Rule | null;
  active: boolean;
  since: string | null;
  history: AlertEntry[];
  display: string | null;
  led: LedColor | null;
}

export interface Device {
  ip: string;
  rssi: number | null;
}
