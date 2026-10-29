import { execFile } from "node:child_process";
import { z } from "zod";
import type { AutomationRun } from "./automation-schema.js";

const BINARY = process.env.COMPOSIO_BIN || "composio";
const ACCOUNT = process.env.COMPOSIO_GMAIL_ACCOUNT;
const accountArgs = ACCOUNT ? ["--account", ACCOUNT] : [];

export interface EmailConnection {
  connected: boolean;
  email: string | null;
  error: string | null;
}

export class DeliveryError extends Error {
  constructor(message: string, public uncertain: boolean) { super(message); }
}

/** Sin shell: nombres, destinatarios y mensajes nunca se interpretan como comandos. */
function command(args: string[], input?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(BINARY, args, { timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout) => {
      if (error) {
        const unavailable = "code" in error && error.code === "ENOENT";
        reject(new DeliveryError(unavailable ? "Composio no está instalado en este servidor" : "No se pudo confirmar la respuesta de Composio. Revisa Gmail antes de repetir el envío.", !unavailable));
        return;
      }
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new DeliveryError("Composio devolvió una respuesta que no se pudo confirmar. Revisa Gmail.", true)); }
    });
    // Evita un error de EPIPE si el proceso termina antes de leer la entrada.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

let cached: { value: EmailConnection; expires: number } | null = null;
let checking: Promise<EmailConnection> | null = null;

export async function getEmailConnection(): Promise<EmailConnection> {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (checking) return checking;
  checking = (async () => {
    let value: EmailConnection;
    try {
      const raw = await command(["proxy", "https://gmail.googleapis.com/gmail/v1/users/me/profile", "--toolkit", "gmail", ...accountArgs]);
      const result = z.object({ emailAddress: z.email() }).safeParse(raw);
      value = result.success
        ? { connected: true, email: result.data.emailAddress, error: null }
        : { connected: false, email: null, error: "No se pudo verificar Gmail. Revisa la conexión de Composio." };
    } catch {
      value = { connected: false, email: null, error: "No se pudo conectar con Gmail mediante Composio." };
    }
    cached = { value, expires: Date.now() + (value.connected ? 60_000 : 10_000) };
    return value;
  })();
  try { return await checking; } finally { checking = null; }
}

const symbols = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

export function buildAutomationEmail(run: AutomationRun) {
  const label = run.variable === "temperature" ? "temperatura" : "humedad";
  const unit = run.variable === "temperature" ? "°C" : "%";
  const time = new Date(run.triggeredAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City", hour12: false });
  return {
    recipient_email: run.recipient,
    subject: `Sentido · ${run.name}`,
    body: [
      `Se activó la automatización «${run.name}».`, "",
      `Lectura del sensor: ${run.value} ${unit} de ${label}.`,
      `Condición: ${label} ${symbols[run.direction]} ${run.threshold} ${unit}.`,
      `Hora: ${time} (Ciudad de México).`, "",
      "Recibirás otro aviso si la condición deja de cumplirse y vuelve a activarse.",
    ].join("\n"),
    is_html: false,
    include_signature: false,
  };
}

export async function sendAutomationEmail(run: AutomationRun): Promise<void> {
  const result = await command(["execute", "GMAIL_SEND_EMAIL", ...accountArgs, "-d", "-"], buildAutomationEmail(run));
  const parsed = z.object({ successful: z.boolean() }).safeParse(result);
  if (!parsed.success) throw new DeliveryError("Respuesta de envío sin confirmar. Revisa Gmail antes de repetirlo.", true);
  if (!parsed.data.successful) throw new DeliveryError("Composio no confirmó el envío del correo. Revisa Gmail antes de repetirlo.", true);
}
