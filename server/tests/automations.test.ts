import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Reading } from "../src/types.js";

// Solo se leen mediciones reales existentes. La base de pruebas es temporal;
// no se llama a /ingest ni se ejecuta el transporte de correo.
const source = new DatabaseSync(path.resolve("data/sentido.db"), { readOnly: true });
const realReadings = source.prepare("SELECT t, temperature, humidity FROM readings ORDER BY t").all() as unknown as Reading[];
source.close();
assert.ok(realReadings.length > 0, "Estas pruebas necesitan historial real del sensor en data/sentido.db");
const low = realReadings.reduce((a, b) => a.temperature < b.temperature ? a : b);
const high = realReadings.reduce((a, b) => a.temperature > b.temperature ? a : b);
assert.ok(high.temperature > low.temperature, "Se necesitan dos temperaturas reales distintas");

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sentido-automation-tests-"));
const store = await import("../src/store.js");
const rules = await import("../src/automations.js");
const { buildAutomationEmail } = await import("../src/composio.js");
const { createApp } = await import("../src/app.js");
store.initStore();

const input = () => ({ name: "Aviso de temperatura", variable: "temperature", direction: "gt", threshold: low.temperature, recipient: "sensor@example.com", enabled: true });
const replay = (reading: Reading) => rules.claimAutomationRuns(reading, reading.t);

beforeEach(() => {
  store.database().exec("DELETE FROM automation_runs; DELETE FROM automations");
});
after(() => store.database().close());

test("valida correo, rangos, campos desconocidos y cambios vacíos", () => {
  assert.throws(() => rules.createAutomation({ ...input(), recipient: "correo inválido" }));
  assert.throws(() => rules.createAutomation({ ...input(), variable: "humidity", threshold: -1 }));
  assert.throws(() => rules.createAutomation({ ...input(), threshold: 81 }));
  assert.throws(() => rules.createAutomation({ ...input(), extra: true }));
  const rule = rules.createAutomation(input());
  assert.throws(() => rules.updateAutomation(rule.id, {}));
  assert.throws(() => rules.updateAutomation(rule.id, { threshold: null }));
  assert.throws(() => rules.updateAutomation(rule.id, { threshold: 101, variable: "humidity" }));
  assert.equal(rules.getAutomation(rule.id).variable, "temperature");
});

test("editar una regla pausada conserva su estado y persiste al reiniciar", () => {
  const rule = rules.createAutomation({ ...input(), enabled: false });
  rules.updateAutomation(rule.id, { name: "Nombre editado" });
  assert.equal(rules.getAutomation(rule.id).enabled, false);
  store.database().close();
  store.initStore();
  assert.equal(rules.getAutomation(rule.id).name, "Nombre editado");
  assert.equal(rules.getAutomation(rule.id).enabled, false);
  replay(high);
  assert.equal(rules.listAutomationRuns().length, 0);
});

test("distingue comparaciones estrictas e inclusivas usando una medición real", () => {
  for (const variable of ["temperature", "humidity"] as const) {
    const threshold = high[variable];
    assert.equal(rules.automationConditionMet({ variable, threshold, direction: "gt" }, high), false);
    assert.equal(rules.automationConditionMet({ variable, threshold, direction: "gte" }, high), true);
    assert.equal(rules.automationConditionMet({ variable, threshold, direction: "lt" }, high), false);
    assert.equal(rules.automationConditionMet({ variable, threshold, direction: "lte" }, high), true);
  }
});

test("un envío por cruce, rearme y pausa que cancela los pendientes", () => {
  const rule = rules.createAutomation(input());
  replay(low); replay(high); replay(high);
  assert.equal(rules.listAutomationRuns().length, 1);
  const sending = rules.takeQueuedRun();
  assert.ok(sending);
  assert.equal(rules.takeQueuedRun(), null);
  rules.finishAutomationRun(sending.id, "sent");
  rules.updateAutomation(rule.id, { name: "Otro nombre", recipient: "sensor@example.com" });
  replay(high);
  assert.equal(rules.listAutomationRuns().length, 1);
  replay(low); replay(high);
  assert.equal(rules.listAutomationRuns().length, 2);
  rules.updateAutomation(rule.id, { enabled: false });
  assert.equal(rules.takeQueuedRun(), null);
  assert.equal(rules.listAutomationRuns().filter((run) => run.status === "failed").length, 1);
  rules.updateAutomation(rule.id, { enabled: true });
  replay(high);
  assert.equal(rules.listAutomationRuns().length, 3);
});

test("ignora lecturas obsoletas y lecturas con fecha futura", () => {
  rules.createAutomation(input());
  rules.claimAutomationRuns(high, high.t + 30_001);
  rules.claimAutomationRuns(high, high.t - 1);
  assert.equal(rules.listAutomationRuns().length, 0);
});

test("un reinicio conserva el cruce y no reintenta un envío incierto", () => {
  rules.createAutomation(input());
  replay(high);
  assert.ok(rules.takeQueuedRun());
  store.database().close(); store.initStore();
  rules.recoverInterruptedRuns();
  assert.equal(rules.listAutomationRuns()[0].status, "unknown");
  replay(high);
  assert.equal(rules.takeQueuedRun(), null);
  assert.equal(rules.listAutomationRuns().length, 1);
  replay(low); replay(high);
  assert.ok(rules.takeQueuedRun());
});

test("eliminar conserva el historial y cancela los correos aún no iniciados", () => {
  const rule = rules.createAutomation(input());
  replay(high);
  rules.deleteAutomation(rule.id);
  assert.equal(rules.listAutomations().length, 0);
  assert.equal(rules.listAutomationRuns().length, 1);
  assert.equal(rules.listAutomationRuns()[0].status, "failed");
  assert.equal(rules.takeQueuedRun(), null);
});

test("el correo contiene la medición real y el destinatario de la regla", () => {
  rules.createAutomation(input()); replay(high);
  const run = rules.listAutomationRuns()[0];
  const email = buildAutomationEmail(run);
  assert.equal(email.recipient_email, input().recipient);
  assert.match(email.body, new RegExp(String(high.temperature)));
  assert.ok(email.body.includes("Ciudad de México"));
  assert.equal(email.include_signature, false);
});

test("HTTP y MCP crean, editan, pausan y eliminan las mismas reglas", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "sentido-tests", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    for (const tool of ["create_automation", "list_automations", "update_automation", "delete_automation", "get_email_connection"]) assert.ok(tools.includes(tool));
    const created = await client.callTool({ name: "create_automation", arguments: { ...input(), enabled: false } });
    assert.equal(created.isError, undefined);
    let data = await (await fetch(`${url}/api/automations`)).json();
    assert.equal(data.automations.length, 1);
    const id = data.automations[0].id;
    const patched = await fetch(`${url}/api/automations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Editada desde el panel" }) });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).automation.enabled, false);
    const listed = await client.callTool({ name: "list_automations", arguments: {} });
    assert.ok(Array.isArray(listed.content));
    const block = listed.content[0];
    assert.ok(block.type === "text");
    assert.equal(JSON.parse(block.text as string).automations[0].name, "Editada desde el panel");
    const invalid = await fetch(`${url}/api/automations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input(), recipient: "inválido" }) });
    assert.equal(invalid.status, 400);
    const updated = await client.callTool({ name: "update_automation", arguments: { id, changes: { name: "Editada por MCP" } } });
    assert.equal(updated.isError, undefined);
    assert.equal(rules.getAutomation(id).enabled, false);
    assert.equal((await fetch(`${url}/api/automations/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${url}/api/automations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) })).status, 404);
    const fromHttp = await (await fetch(`${url}/api/automations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input(), enabled: false }) })).json();
    const deleted = await client.callTool({ name: "delete_automation", arguments: { id: fromHttp.automation.id } });
    assert.equal(deleted.isError, undefined);
    data = await (await fetch(`${url}/api/automations`)).json();
    assert.equal(data.automations.length, 0);
    assert.equal(data.runs.length, 0);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
