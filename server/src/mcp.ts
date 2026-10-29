import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { automationFields, automationPatchFields } from "./automation-schema.js";
import { createAutomation, deleteAutomation, listAutomations, listAutomationRuns, updateAutomation } from "./automations.js";
import { getEmailConnection } from "./composio.js";
import { clearRule, setRule } from "./alerts.js";
import { STALE_MS } from "./config.js";
import { currentReading, downsample, lastReading, logAction, readingsSince, saveState, state } from "./store.js";
import { LED_COLORS } from "./types.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
const automationResult = async (work: () => unknown | Promise<unknown>) => {
  try { return json(await work()); }
  catch (error) {
    return { ...text(error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join(". ") :
      error instanceof Error ? error.message : "No se pudo guardar la automatización"), isError: true };
  }
};
const NO_RECENT = `No hay dato reciente: el sensor no ha enviado una lectura en los últimos ${STALE_MS / 1000} s (¿ESP32 apagado o sin WiFi?). No inventes valores.`;

/** Quita acentos y caracteres no ASCII (la pantalla OLED solo muestra ASCII). */
export function toAscii(s: string): string {
  return s
    .replace(/¡/g, "!")
    .replace(/¿/g, "?")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "sentido", version: "0.2.0" }, {
    instructions: "Sentido mide temperatura y humedad reales. Nunca inventes lecturas. Para avisos automáticos por correo usa create_automation: las reglas se guardan en SQLite, se ven también en el dashboard y las ejecuta el servidor ante lecturas nuevas, con Gmail vía Composio. Consulta get_email_connection para conocer la cuenta conectada y ofrece ese correo como destinatario si el usuario pide avisarse a sí mismo. Usa list_automations antes de crear para evitar duplicados. Una regla habilitada puede enviar un correo con la próxima lectura que cumpla la condición. Un envío por cruce; no reintentes automáticamente envíos de resultado incierto.",
  });

  server.registerTool("get_email_connection", {
    title: "Conexión de correo",
    description: "Consulta si Gmail está conectado mediante Composio y devuelve su dirección de correo. No envía mensajes.",
    annotations: { readOnlyHint: true },
  }, async () => {
    logAction("get_email_connection");
    return json(await getEmailConnection());
  });

  server.registerTool("list_automations", {
    title: "Ver automatizaciones",
    description: "Lista las reglas de correo compartidas con el dashboard y sus últimos 30 envíos, incluidos errores y resultados inciertos. Las reglas siguen funcionando con el servidor encendido aunque se cierre el chat.",
    annotations: { readOnlyHint: true },
  }, async () => {
    logAction("list_automations");
    return json({ automations: listAutomations(), runs: listAutomationRuns() });
  });

  server.registerTool("create_automation", {
    title: "Crear automatización de correo",
    description: "Guarda una regla nueva en SQLite: al cumplirse una condición de temperatura o humedad en una lectura nueva, manda un correo mediante Composio. Un correo por cruce; vuelve a armarse cuando deja de cumplirse. gt >, gte ≥, lt <, lte ≤. El destinatario debe ser una dirección completa. enabled=false la guarda pausada. No genera lecturas ni envía un correo de prueba.",
    inputSchema: automationFields,
  }, async (input) => {
    logAction("create_automation");
    return automationResult(() => ({ automation: createAutomation(input) }));
  });

  server.registerTool("update_automation", {
    title: "Editar o pausar automatización",
    description: "Actualiza una regla existente por su id. Usa enabled=false para pausarla y enabled=true para activarla. Cambiar la condición o reactivarla la rearma para la próxima lectura nueva. Cambiar solo nombre o destinatario conserva el cruce actual.",
    inputSchema: { id: z.string().uuid(), changes: z.strictObject(automationPatchFields).partial() },
    annotations: { idempotentHint: true },
  }, async ({ id, changes }) => {
    logAction("update_automation");
    return automationResult(() => ({ automation: updateAutomation(id, changes) }));
  });

  server.registerTool("delete_automation", {
    title: "Eliminar automatización",
    description: "Elimina una regla por su id. Conserva el historial de correos y cancela los envíos que aún no comenzaron.",
    inputSchema: { id: z.string().uuid() },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    logAction("delete_automation");
    return automationResult(() => { deleteAutomation(id); return { ok: true }; });
  });

  server.registerTool(
    "get_current_reading",
    {
      title: "Lectura actual",
      description:
        "Devuelve la temperatura (°C) y humedad relativa (%) ACTUALES del sensor físico (DHT11 en un ESP32), con hora y antigüedad en segundos. Úsala cuando pregunten cómo está el ambiente ahora. Si no hay lectura de los últimos 30 s responde 'No hay dato reciente' (no hay valor actual).",
    },
    async () => {
      logAction("get_current_reading");
      const r = currentReading();
      if (!r) {
        const last = lastReading();
        return text(NO_RECENT + (last ? ` Última lectura recibida: ${new Date(last.t).toISOString()}.` : " Aún no se ha recibido ninguna lectura."));
      }
      return json({
        temperature_c: r.temperature,
        humidity_percent: r.humidity,
        timestamp: new Date(r.t).toISOString(),
        age_seconds: Math.round((Date.now() - r.t) / 1000),
      });
    },
  );

  server.registerTool(
    "get_history",
    {
      title: "Historial",
      description:
        "Lecturas reales de temperatura y humedad de los últimos N minutos (1 a 10080 = 7 días), de la más antigua a la más reciente. Si hay muchas se promedian en cubetas de tiempo (máx. 200 puntos). Úsala para ver tendencias o la evolución.",
      inputSchema: { minutes: z.number().int().min(1).max(10080).describe("Ventana en minutos hacia atrás (1 a 10080)") },
    },
    async ({ minutes }) => {
      logAction("get_history");
      const list = readingsSince(minutes);
      if (!list.length) return text(`No hay lecturas en los últimos ${minutes} min.`);
      const points = downsample(list, minutes, 200);
      return json({ minutes, raw_count: list.length, points_returned: points.length, readings: points });
    },
  );

  server.registerTool(
    "get_stats",
    {
      title: "Estadísticas",
      description:
        "Mínimo, máximo y promedio de temperatura y humedad en los últimos N minutos (1 a 10080), con número de lecturas y primera/última hora. Úsala para resúmenes (p. ej. del día o la semana).",
      inputSchema: { minutes: z.number().int().min(1).max(10080).describe("Ventana en minutos hacia atrás (1 a 10080)") },
    },
    async ({ minutes }) => {
      logAction("get_stats");
      const list = readingsSince(minutes);
      if (!list.length) return text(`No hay lecturas en los últimos ${minutes} min, no se pueden calcular estadísticas.`);
      const stat = (f: (r: (typeof list)[number]) => number) => {
        const v = list.map(f);
        return {
          min: Math.min(...v),
          max: Math.max(...v),
          avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10,
        };
      };
      return json({
        minutes,
        count: list.length,
        first: new Date(list[0].t).toISOString(),
        last: new Date(list[list.length - 1].t).toISOString(),
        temperature_c: stat((r) => r.temperature),
        humidity_percent: stat((r) => r.humidity),
      });
    },
  );

  server.registerTool(
    "set_alert",
    {
      title: "Configurar alerta",
      description:
        "Define la ÚNICA regla de alerta activa (reemplaza la anterior): avisa por correo, una sola vez por cruce, cuando la variable sea mayor o igual (gte) o menor o igual (lte) que el umbral. Ejemplo: humidity, 70, gte.",
      inputSchema: {
        variable: z.enum(["temperature", "humidity"]).describe("temperature (°C) o humidity (%)"),
        threshold: z.number().finite().describe("Valor umbral"),
        direction: z.enum(["gte", "lte"]).describe("gte = mayor o igual, lte = menor o igual"),
      },
    },
    async ({ variable, threshold, direction }) => {
      logAction("set_alert");
      setRule({ variable, threshold, direction });
      return text(`Alerta configurada: ${variable} ${direction === "gte" ? "≥" : "≤"} ${threshold}. Se avisará una vez por cada cruce.`);
    },
  );

  server.registerTool(
    "get_alerts",
    {
      title: "Ver alertas",
      description: "Devuelve la regla de alerta actual (si hay) y el historial de alertas disparadas (últimas 20, más reciente primero), con si se envió el correo.",
    },
    async () => {
      logAction("get_alerts");
      return json({
        rule: state.rule,
        active: state.rule ? state.active : null,
        since: state.rule ? state.since : null,
        history: state.history,
      });
    },
  );

  server.registerTool(
    "clear_alert",
    { title: "Quitar alerta", description: "Elimina la regla de alerta activa (el historial se conserva)." },
    async () => {
      logAction("clear_alert");
      const had = state.rule !== null;
      clearRule();
      return text(had ? "Alerta eliminada." : "No había ninguna alerta configurada.");
    },
  );

  server.registerTool(
    "show_on_display",
    {
      title: "Mostrar en pantalla",
      description:
        "Muestra un mensaje corto (máx. 40 caracteres, sin acentos ni emojis) en la pantalla OLED del dispositivo físico. Texto vacío = borrar el mensaje. Úsalo para avisar a quien está junto al sensor.",
      inputSchema: { text: z.string().max(40).describe("Mensaje, máx. 40 caracteres") },
    },
    async ({ text: t }) => {
      logAction("show_on_display");
      const clean = toAscii(t);
      state.display = clean === "" ? null : clean;
      saveState();
      return text(state.display === null ? "Mensaje borrado de la pantalla." : `Mensaje enviado a la pantalla: "${state.display}"`);
    },
  );

  server.registerTool(
    "set_led",
    {
      title: "Color del LED",
      description: "Pone el LED RGB del dispositivo físico en un color: rojo, verde, azul, amarillo, blanco o apagado. Úsalo para señales visibles (p. ej. rojo = alerta).",
      inputSchema: { color: z.enum(LED_COLORS).describe("rojo | verde | azul | amarillo | blanco | apagado") },
    },
    async ({ color }) => {
      logAction("set_led");
      state.led = color;
      saveState();
      return text(`LED en ${color}.`);
    },
  );

  return server;
}
