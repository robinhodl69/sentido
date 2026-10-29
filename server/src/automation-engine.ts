import { claimAutomationRuns, finishAutomationRun, recoverInterruptedRuns, takeQueuedRun } from "./automations.js";
import { DeliveryError, sendAutomationEmail } from "./composio.js";
import type { Reading } from "./types.js";

let draining = false;

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let run;
    while ((run = takeQueuedRun())) {
      try {
        await sendAutomationEmail(run);
        finishAutomationRun(run.id, "sent");
      } catch (error) {
        finishAutomationRun(run.id, error instanceof DeliveryError && error.uncertain ? "unknown" : "failed",
          error instanceof DeliveryError ? error.message : "No se pudo enviar el correo");
      }
    }
  } finally { draining = false; }
}

export function startAutomationEngine(): void {
  recoverInterruptedRuns();
  void drainQueue().catch((error) => console.error("[automatizaciones]", error));
}

export function evaluateAutomations(reading: Reading): void {
  claimAutomationRuns(reading);
  void drainQueue().catch((error) => console.error("[automatizaciones]", error));
}
