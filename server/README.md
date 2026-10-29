# Sentido · servidor

Recibe las lecturas reales del ESP32 (`POST /ingest`), las guarda, sirve el panel (`/api/*`) y expone las herramientas MCP para Codex (`/mcp`). **No genera ni simula datos**: si no hay una lectura de menos de 30 s, dice que no hay dato reciente.

## Instalar y correr

Requiere Node.js con soporte para `node:sqlite` (Node 22.13 o superior).

```bash
cd server
npm install
cp .env.example .env     # opcional: solo para correo de alertas
npm run dev              # desarrollo (tsx watch)
# o producción:
npm run build && npm start
```

Escucha en `http://0.0.0.0:3000` (el ESP32 debe poder llegar a la IP de tu Mac). Otros scripts: `npm run typecheck`.

## Variables de entorno (`.env`)

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PORT` | `3000` | Puerto |
| `DATA_DIR` | `./data` | Dónde se guardan `sentido.db` y `state.json` |
| `SMTP_HOST` | `smtp.gmail.com` | Servidor de correo |
| `SMTP_PORT` | `465` | Puerto SMTP (465 = SSL) |
| `SMTP_USER` | — | Tu correo de Gmail |
| `SMTP_PASS` | — | Contraseña de aplicación de Google (no tu contraseña normal) |
| `ALERT_EMAIL_TO` | — | Quién recibe las alertas |
| `ALERT_EMAIL_FROM` | `SMTP_USER` | Remitente (opcional) |

Sin SMTP el servidor funciona igual: las alertas quedan en el historial con `emailSent: false` y se avisa una vez en la consola.

## Agregarlo a Codex

En `~/.codex/config.toml`:

```toml
[mcp_servers.sentido]
url = "http://localhost:3000/mcp"
```

Reinicia Codex. Herramientas: `get_current_reading`, `get_history`, `get_stats`, `set_alert`, `get_alerts`, `clear_alert`, `show_on_display`, `set_led` (detalle en `../docs/API.md`).

## Prueba manual

```bash
curl http://localhost:3000/health

```

Para el demo no mandes datos a mano: solo el ESP32 debe escribir en `data/`.

## Panel

```bash
cd ../dashboard
npm install
npm run dev     # http://localhost:3001  (usa SENTIDO_API_URL, por defecto http://localhost:3000)
```

## Automatizaciones programadas de Codex

Pide a la automatización que, en cada ejecución: (1) llame `get_current_reading`; (2) si responde "No hay dato reciente", no haga nada más y lo reporte; (3) si el valor pasa tu umbral, llame `set_led` (p. ej. `rojo`) y `show_on_display` con un mensaje corto; si vuelve a la normalidad, `set_led` `verde` y `show_on_display` con texto vacío. Para resúmenes usa `get_stats` (p. ej. 1440 min para el día). Sondea cada minuto como máximo. Las tareas programadas solo corren con la app de Codex abierta y la Mac encendida. Para correo por cruce de umbral usa `set_alert` (lo envía el servidor, una vez por cruce).
