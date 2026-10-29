import nodemailer from "nodemailer";
import { smtp } from "./config.js";
import { saveState, state } from "./store.js";
import type { Reading, Rule, Variable } from "./types.js";

const LABEL: Record<Variable, string> = { temperature: "temperatura", humidity: "humedad" };

function fmt(variable: Variable, n: number): string {
  return variable === "humidity" ? `${n} %` : `${n} °C`;
}

export function conditionMet(rule: Rule, r: Reading): boolean {
  const v = r[rule.variable];
  return rule.direction === "gte" ? v >= rule.threshold : v <= rule.threshold;
}

export function setRule(rule: Rule): void {
  state.rule = rule;
  state.active = false; // se reinicia el cruce
  state.since = null;
  saveState();
}

export function clearRule(): void {
  state.rule = null;
  state.active = false;
  state.since = null;
  saveState();
}

let warnedNoSmtp = false;

function smtpConfigured(): boolean {
  return Boolean(smtp.user && smtp.pass && smtp.to);
}

async function sendEmail(rule: Rule, value: number, whenIso: string): Promise<boolean> {
  if (!smtpConfigured()) {
    if (!warnedNoSmtp) {
      warnedNoSmtp = true;
      console.warn("[alertas] Falta SMTP_USER, SMTP_PASS o ALERT_EMAIL_TO en .env: las alertas se registran pero NO se envia correo.");
    }
    return false;
  }
  const sym = rule.direction === "gte" ? "≥" : "≤";
  const name = LABEL[rule.variable];
  const subject = `Sentido: ${name} ${sym} ${fmt(rule.variable, rule.threshold)} (${fmt(rule.variable, value)})`;
  const hora = new Date(whenIso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", hour12: false });
  const text = [
    `La ${name} cruzó el umbral que configuraste.`,
    ``,
    `Valor medido: ${fmt(rule.variable, value)}`,
    `Umbral: ${sym} ${fmt(rule.variable, rule.threshold)}`,
    `Hora: ${hora} (Ciudad de México)`,
    ``,
    `Sentido`,
  ].join("\n");
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({ from: smtp.from || smtp.user, to: smtp.to, subject, text });
    return true;
  } catch (e) {
    console.error("[alertas] No se pudo enviar el correo:", (e as Error).message);
    return false;
  }
}

/** Se llama en cada lectura nueva. Un correo por cruce (falso -> verdadero). */
export function evaluate(r: Reading): void {
  const rule = state.rule;
  if (!rule) return;
  const met = conditionMet(rule, r);
  if (!met) {
    if (state.active) {
      state.active = false;
      saveState();
    }
    return;
  }
  if (state.active) return; // ya cruzo; espera a re-armarse
  const whenIso = new Date(r.t).toISOString();
  const value = r[rule.variable];
  const entry = { t: whenIso, variable: rule.variable, value, emailSent: false };
  state.active = true;
  state.since = whenIso;
  state.history.unshift(entry);
  state.history.length = Math.min(state.history.length, 20);
  saveState();
  console.log(`[alertas] Cruce: ${rule.variable} ${value} (${rule.direction} ${rule.threshold})`);
  void sendEmail(rule, value, whenIso).then((ok) => {
    if (ok) {
      entry.emailSent = true;
      saveState();
      console.log("[alertas] Correo enviado.");
    }
  });
}
