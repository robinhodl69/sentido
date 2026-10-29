# Sentido - IRL MCP para Codex (contexto para Codex)

Hackathon de Codex. Idea: dar a Codex "sentidos" reales. Una ESP32-S3 con sensor de temperatura y humedad manda lecturas REALES a esta Mac, y Codex las consulta y actua por MCP.

## Como esta armado
- Hardware: ESP32-S3-DevKitC-1 + DHT11 (GPIO4, pull-up interno) + OLED SSD1306 128x64 I2C (SDA GPIO8, SCL GPIO9) + LED RGB de la placa.
- Red: hotspot del iPhone. La ESP32 busca la Mac por mDNS y usa una IP local de respaldo. La configuracion local esta en `firmware/sentido/secrets.h`, ignorado por Git.
- Firmware (`firmware/sentido/sentido.ino`, Arduino IDE, un solo .ino): cada 5 s hace POST /ingest con temperatura y humedad; cada 1 s hace GET /command (mensaje para la pantalla, color del LED).
- Servidor (`server/`, Node + TypeScript, Express, puerto 3000): recibe lecturas, las guarda en SQLite y carga 7 dias en memoria; mantiene estado en `data/state.json`, envia alertas y expone MCP en `http://localhost:3000/mcp` (Streamable HTTP).
- Dashboard (`dashboard/`, Next.js, puerto 3001): una pantalla sin scroll, estilo claro (violeta #6D3BF5, fondo #F3F2F7, Inter). Todo sale de la API; contrato en `docs/API.md`.

## Herramientas MCP
get_current_reading, get_history, get_stats, set_alert, get_alerts, clear_alert, show_on_display, set_led.
Tambien: get_email_connection, list_automations, create_automation, update_automation, delete_automation.

## Reglas del proyecto (no negociables)
- Cero datos inventados, simulados o mock. Si no hay lectura en los ultimos 30 s se muestra "Sin dato".
- El dashboard NO debe parecer "AI slop": sin puntos parpadeantes, "Live", brillos, animaciones decorativas ni textos de relleno. Textos cortos en espanol.
- No hacer commits ni push a git hasta que Robin lo pida.
- Robin es principiante en electronica; responder en espanol, corto y claro.

## Tareas pendientes
1. Mejorar el dashboard y automatizaciones con Codex (alertas, resumenes).
