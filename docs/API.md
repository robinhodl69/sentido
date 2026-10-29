# API de Sentido (contrato)

Servidor en `http://localhost:3000`. El panel (puerto 3001) lo consulta con rutas relativas `/api/...` cada 5 s; Next las reenvía al servidor (variable `SENTIDO_API_URL`).

Cualquier campo puede faltar o ser `null`: el panel lo muestra como "Sin dato" / "—" y nunca inventa valores. Una lectura con más de 30 s de antigüedad se considera obsoleta.

## GET /api/status

```json
{
  "lastReadingAt": "ISO | null",
  "current": { "temperature": 0, "humidity": 0 },
  "alert": {
    "active": true,
    "variable": "temperature | humidity",
    "direction": "gte | lte",
    "threshold": 0,
    "since": "ISO | null",
    "emailSent": true
  },
  "codex": {
    "displayMessage": "string | null",
    "led": "string | null",
    "recentActions": [{ "t": "ISO", "tool": "string" }]
  },
  "alerts": [
    { "t": "ISO", "variable": "temperature | humidity", "value": 0, "emailSent": true }
  ],
  "device": { "ip": "string", "rssi": 0 }
}
```

- `current`, `alert` y `device` pueden ser `null`.
- `led`: el panel solo pinta el color si es `rojo`, `verde`, `azul`, `amarillo` o `blanco`.
- `direction`: `gte` = mayor o igual, `lte` = menor o igual.

## GET /api/readings?minutes=N

`N` ∈ 15, 60, 1440, 10080. Respuesta ordenada de más antigua a más reciente:

```json
{ "readings": [{ "t": "ISO", "temperature": 0, "humidity": 0 }] }
```

## POST /ingest (ESP32 → servidor)

```json
{ "temperature": 26, "humidity": 68, "rssi": -55, "ip": "192.168.1.50" }
```

- `temperature` (°C, −20 a 80) y `humidity` (%, 0 a 100) son obligatorios y numéricos; si no, responde `400 {"ok":false,"error":"..."}`.
- `rssi` e `ip` son opcionales (si falta `ip`, se usa la IP de origen de la petición).
- La hora la pone el servidor con su propio reloj. Respuesta: `200 {"ok":true}`.
- Cada lectura se guarda en SQLite (`data/sentido.db`), se mantiene en memoria durante 7 días y evalúa las reglas de alerta y automatización.

## GET /command (ESP32 → servidor, cada ~1 s)

```json
{ "display": "string | null", "led": "rojo | verde | azul | amarillo | blanco | apagado | null" }
```

- `display`: último texto puesto con `show_on_display` (`null` si no hay).
- `led`: último color puesto con `set_led` (`null` si nunca se ha usado).

## GET /health

`{ "ok": true }`

## MCP: POST /mcp (Streamable HTTP, sin sesión)

`GET` y `DELETE` responden `405`. Herramientas:

| Herramienta | Argumentos | Qué hace |
| --- | --- | --- |
| `get_current_reading` | — | Temperatura y humedad actuales con hora y edad en segundos. Si la última lectura tiene más de 30 s (o no hay), responde "No hay dato reciente". |
| `get_history` | `minutes` (1–10080) | Lecturas de los últimos N minutos, más antigua primero, máx. 200 puntos (promedios por cubeta si hay más). |
| `get_stats` | `minutes` (1–10080) | Mín / máx / promedio de temperatura y humedad, número de lecturas, primera y última hora. |
| `set_alert` | `variable` (`temperature`\|`humidity`), `threshold` (número), `direction` (`gte`\|`lte`) | Fija la única regla activa (reemplaza la anterior) y reinicia el cruce. Un correo por cruce. |
| `get_alerts` | — | Regla actual e historial de alertas disparadas. |
| `clear_alert` | — | Quita la regla. |
| `show_on_display` | `text` (máx. 40 caracteres) | Texto para la OLED (se quitan acentos y caracteres no ASCII). Vacío = borrar. |
| `set_led` | `color` (`rojo`\|`verde`\|`azul`\|`amarillo`\|`blanco`\|`apagado`) | Color del LED RGB. |

Cada llamada a una herramienta (también las de lectura) se registra en `codex.recentActions` de `/api/status` (últimas 5, la más reciente primero).

## Notas de `/api/status`

- `current` es `null` si la última lectura tiene más de 30 s; `lastReadingAt` conserva la hora de la última lectura recibida.
- `alert` es `null` si no hay regla. `alert.since` y `alert.emailSent` solo tienen valor mientras la alerta está activa (`emailSent` = si se envió el correo de ese cruce).
- `alerts`: últimas 20 alertas, la más reciente primero. `device` es `null` hasta recibir la primera lectura tras arrancar el servidor.
- `/api/readings` devuelve como máximo ~400 puntos (promedios reales por cubeta de tiempo en ventanas largas).
