# Sentido - IRL MCP para Codex

Una ESP32-S3 con un sensor DHT11 y una pantalla OLED manda lecturas reales de temperatura y humedad a un servidor local que es también un servidor MCP. Codex consulta los datos, activa alertas y escribe en la pantalla y el LED de la tarjeta.

Sin datos simulados: si no hay lectura reciente, el sistema lo dice.

## Estructura

- `firmware/sentido/`: sketch de Arduino IDE para la ESP32-S3 (`sentido.ino`).
- `server/`: servidor Node + TypeScript (MCP en `/mcp`, `/ingest`, `/command`, `/health` y el dashboard).
- `server/public/`: dashboard web.
- `docs/`: plan y notas (`PLAN.md`).

## Hardware

- ESP32-S3-DevKitC-1
- Sensor DHT11 (Steren ARD-360): 3V3, GPIO4, GND
- Pantalla OLED SSD1306 128x64 I2C (0x3C): SDA GPIO8, SCL GPIO9, 3V3, GND

## Estado

Solo estructura. Aún sin código; se construye cuando Robin diga "empieza".
