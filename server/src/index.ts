import { createApp } from "./app.js";
import { DATA_DIR, PORT } from "./config.js";
import { initStore, readings } from "./store.js";
import { startAutomationEngine } from "./automation-engine.js";

initStore();
startAutomationEngine();
const app = createApp();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Sentido escuchando en http://0.0.0.0:${PORT}  (MCP: /mcp, ESP32: /ingest y /command)`);
  console.log(`Datos en ${DATA_DIR} · lecturas cargadas: ${readings.length}`);
});
