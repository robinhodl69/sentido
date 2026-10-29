import express from "express";
import { z } from "zod";
import { evaluateAutomations } from "./automation-engine.js";
import { createAutomation, deleteAutomation, listAutomations, listAutomationRuns, updateAutomation } from "./automations.js";
import { getEmailConnection } from "./composio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { evaluate } from "./alerts.js";
import { buildMcpServer } from "./mcp.js";
import { addReading, currentReading, device, downsample, lastReading, readingsSince, recentActions, state } from "./store.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---- ESP32 -> servidor -------------------------------------------------
  app.post("/ingest", (req, res) => {
    const b = req.body as Record<string, unknown> | undefined;
    const temperature = b?.temperature;
    const humidity = b?.humidity;
    if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < -20 || temperature > 80) {
      res.status(400).json({ ok: false, error: "temperature debe ser un número entre -20 y 80" });
      return;
    }
    if (typeof humidity !== "number" || !Number.isFinite(humidity) || humidity < 0 || humidity > 100) {
      res.status(400).json({ ok: false, error: "humidity debe ser un número entre 0 y 100" });
      return;
    }
    const rssi = typeof b?.rssi === "number" && Number.isFinite(b.rssi) ? b.rssi : null;
    const ip =
      typeof b?.ip === "string" && b.ip.length > 0 && b.ip.length <= 45
        ? b.ip
        : (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const reading = { t: Date.now(), temperature, humidity };
    addReading(reading, { ip, rssi });
    evaluate(reading);
    evaluateAutomations(reading);
    res.json({ ok: true });
  });

  // ---- ESP32 pregunta cada ~1 s qué mostrar -----------------------------
  app.get("/command", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ display: state.display, led: state.led });
  });

  // ---- Panel web ---------------------------------------------------------
  app.get("/api/automations", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ automations: listAutomations(), runs: listAutomationRuns() });
  });

  app.post("/api/automations", (req, res) => {
    res.status(201).json({ automation: createAutomation(req.body) });
  });

  app.patch("/api/automations/:id", (req, res) => {
    res.json({ automation: updateAutomation(req.params.id, req.body) });
  });

  app.delete("/api/automations/:id", (req, res) => {
    deleteAutomation(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/email-connection", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await getEmailConnection());
  });

  app.get("/api/status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const last = lastReading();
    const cur = currentReading();
    const rule = state.rule;
    res.json({
      lastReadingAt: last ? new Date(last.t).toISOString() : null,
      current: cur ? { temperature: cur.temperature, humidity: cur.humidity } : null,
      alert: rule
        ? {
            active: state.active,
            variable: rule.variable,
            direction: rule.direction,
            threshold: rule.threshold,
            since: state.active ? state.since : null,
            emailSent: state.active ? (state.history[0]?.emailSent ?? false) : null,
          }
        : null,
      codex: {
        displayMessage: state.display,
        led: state.led,
        recentActions: recentActions.slice(0, 5),
      },
      alerts: state.history.slice(0, 20),
      device: device ? { ip: device.ip, rssi: device.rssi } : null,
    });
  });

  app.get("/api/readings", (req, res) => {
    res.set("Cache-Control", "no-store");
    const n = Number(req.query.minutes ?? 60);
    const minutes = Number.isFinite(n) ? Math.min(10080, Math.max(1, Math.floor(n))) : 60;
    const now = Date.now();
    const list = readingsSince(minutes, now);
    const stats = (variable: "temperature" | "humidity") => {
      if (!list.length) return null;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const reading of list) {
        const value = reading[variable];
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
      }
      return { min, max, avg: sum / list.length };
    };
    res.json({
      readings: downsample(list, minutes, 400, now),
      window: { from: new Date(now - minutes * 60_000).toISOString(), to: new Date(now).toISOString() },
      stats: { temperature: stats("temperature"), humidity: stats("humidity") },
    });
  });

  // ---- MCP (Streamable HTTP, sin sesión) --------------------------------
  app.post("/mcp", async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp] error:", e);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  const notAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // JSON mal formado -> 400
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: err.issues.map((issue) => issue.message).join(". ") });
      return;
    }
    res.status(err.status && err.status < 500 ? err.status : 500).json({ ok: false, error: err.message });
  });

  return app;
}
