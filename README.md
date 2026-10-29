# Sentido · IRL MCP para Codex

Sentido conecta una ESP32-S3 con Codex para consultar temperatura y humedad reales y actuar sobre una pantalla OLED y un LED. Si no hay una lectura reciente, muestra «Sin dato».

## Componentes

- `firmware/`: programa de la ESP32 y guía de cableado.
- `server/`: servidor Node.js con API, almacenamiento SQLite, alertas y herramientas MCP en el puerto 3000.
- `dashboard/`: panel Next.js en el puerto 3001.
- `docs/`: contrato de la API y notas del proyecto.

El sensor DHT11 envía lecturas cada 5 segundos. El servidor conserva el historial en SQLite y considera obsoleta una lectura después de 30 segundos. Las automatizaciones pueden enviar correos mediante Composio; la alerta individual usa SMTP.

## Comenzar

1. Configura y carga el dispositivo siguiendo [la guía del firmware](firmware/README.md).
2. Instala y ejecuta el servidor siguiendo [su guía](server/README.md).
3. Instala y ejecuta el [dashboard](dashboard/README.md).

Consulta [la API](docs/API.md) para integrar el servidor y [el plan](docs/PLAN.md) para conocer el contexto del proyecto.

Creado por Robin con Codex.
