import type { Variable } from "./types";

export type AutomationDirection = "gt" | "gte" | "lt" | "lte";
export interface Automation {
  id: string;
  name: string;
  variable: Variable;
  direction: AutomationDirection;
  threshold: number;
  recipient: string;
  enabled: boolean;
  active: boolean;
}
export interface AutomationRun {
  id: string;
  name: string;
  triggeredAt: string;
  variable: Variable;
  value: number;
  recipient: string;
  status: "queued" | "sending" | "sent" | "failed" | "unknown";
  error: string | null;
}
export const automationRunLabels: Record<AutomationRun["status"], string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  failed: "No enviado",
  unknown: "Sin confirmar",
};
export interface AutomationsData {
  automations: Automation[];
  runs: AutomationRun[];
}
export interface EmailConnection {
  connected: boolean;
  email: string | null;
  error: string | null;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const variable = (v: unknown): v is Variable => v === "temperature" || v === "humidity";
export const directionSymbol: Record<AutomationDirection, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

export function parseAutomations(raw: unknown): AutomationsData | null {
  if (!isRec(raw) || !Array.isArray(raw.automations) || !Array.isArray(raw.runs)) return null;
  for (const rule of raw.automations) {
    if (!isRec(rule) || typeof rule.id !== "string" || typeof rule.name !== "string" || !variable(rule.variable) ||
        typeof rule.direction !== "string" || !Object.hasOwn(directionSymbol, rule.direction) ||
        typeof rule.threshold !== "number" || !Number.isFinite(rule.threshold) || typeof rule.recipient !== "string" ||
        typeof rule.enabled !== "boolean" || typeof rule.active !== "boolean") return null;
  }
  for (const run of raw.runs) {
    if (!isRec(run) || typeof run.id !== "string" || typeof run.name !== "string" || !variable(run.variable) ||
        typeof run.triggeredAt !== "string" || !Number.isFinite(Date.parse(run.triggeredAt)) ||
        typeof run.value !== "number" || !Number.isFinite(run.value) || typeof run.recipient !== "string" ||
        !["queued", "sending", "sent", "failed", "unknown"].includes(String(run.status)) ||
        (run.error !== null && typeof run.error !== "string")) return null;
  }
  return raw as unknown as AutomationsData;
}

export function parseEmailConnection(raw: unknown): EmailConnection | null {
  if (!isRec(raw) || typeof raw.connected !== "boolean" ||
      (raw.email !== null && typeof raw.email !== "string") ||
      (raw.error !== null && typeof raw.error !== "string")) return null;
  return raw as unknown as EmailConnection;
}
