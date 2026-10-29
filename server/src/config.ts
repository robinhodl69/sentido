import "dotenv/config";
import path from "node:path";

export const PORT = Number(process.env.PORT ?? 3000);
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");

/** Una lectura con mas de estos ms de antiguedad ya no es "actual". */
export const STALE_MS = 30_000;
/** Cuanto historial se conserva en memoria. */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export const smtp = {
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  to: process.env.ALERT_EMAIL_TO || "",
  from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || "",
};
