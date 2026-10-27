# Sentido - IRL MCP para Codex (proyecto hackathon: sensores reales vía MCP, ESP32-S3)
Estado: en definición (26 oct 2026). NO ejecutar hasta luz verde de Robin.

## Idea
Un ESP32 con sensor de humedad/temperatura conectado a Codex por MCP. Codex consulta datos reales del mundo físico, actúa sobre el dispositivo (pantalla/LED) y corre automatizaciones. Pitch: "Codex ya sabe programar; ahora le damos sentidos en el mundo físico". Caso de negocio: vigilar bodega, refri o local pequeño por menos de $400 MXN.

## Hardware
- Placa: ESP32-S3-DevKitC-1 (Espressif), confirmada por foto de la caja.
- Ya tiene: protoboard, jumpers, una pantalla (modelo por confirmar).
- Por comprar (MVP): BME280 (I2C, 3.3 V; verificar que sea BME280 y no BMP280).
  - Opción favorita: H-AVR Electronica, $189, envío gratis: https://www.mercadolibre.com.mx/bme280-sensor-presion-atmosferica-humedad-y-temperatura-33v/up/MLMU489415322
  - Alternativa: Geek Factory, $467: https://www.mercadolibre.com.mx/bme280-sensor-de-presion-humedad-y-temperatura/up/MLMU698874151
- Extras opcionales: sonda DS18B20 impermeable, reed switch de puerta, PIR.

## Arquitectura (local para el demo)
ESP32 --WiFi POST /ingest--> Servidor en la Mac (Node + TypeScript + SDK de MCP + SQLite)
Codex --MCP Streamable HTTP--> http://localhost:3000/mcp
ESP32 consulta GET /command cada ~1 s para recibir órdenes de pantalla/LED.
Config en Codex (~/.codex/config.toml):
  [mcp_servers.sensor_negocio]
  url = "http://localhost:3000/mcp"
El ESP32 solo necesita USB para energía (power bank) y para cargar el firmware. Llevar hotspot del celular al evento (redes de eventos suelen aislar clientes).

## Herramientas MCP propuestas
Lectura: get_current_reading, get_history(minutos), get_stats(minutos), get_alerts
Acción: set_alert(variable, umbral, dirección), show_on_display(texto), set_led(color)
Núcleo mínimo: get_current_reading, get_history, show_on_display.

## Firmware
C++ con Arduino IDE (decisión de Robin 27 oct: un solo archivo .ino; placa "ESP32S3 Dev Module", USB CDC On Boot activado). Librerías: Adafruit BME280, WiFi, HTTPClient, ArduinoJson, la de la pantalla (por definir). Ciclo: leer cada ~5 s, enviar JSON, mostrar en pantalla, consultar comandos. LED RGB integrado: azul conectando, verde enviando, rojo error. WiFi e IP de la Mac en archivo de configuración.

## Automatizaciones en la app de Codex (Scheduled)
1. Vigilante de umbral (estrella del demo): cada pocos minutos lee, si humedad > 70 % pone LED rojo y mensaje en pantalla.
2. Resumen de la mañana con get_stats.
3. Bitácora diaria en archivo.
Notas: solo corren con la app abierta y la Mac encendida; en vivo usar "Run now"; probar acceso a localhost desde el sandbox. Disparadores por evento solo en web/móvil.

## Orden de trabajo (noche)
1. Servidor MCP con datos falsos, probado desde Codex.
2. Firmware con lecturas reales.
3. Cableado BME280 + pantalla (con foto del protoboard).
4. Comandos hacia el ESP32 y automatización.
5. Ensayo y video de respaldo.

## Pendiente por definir
- Modelo de la pantalla.
- Confirmar Node y Codex instalados en la Mac.
- Qué automatización se muestra en el demo; guion del pitch. (Nombre ya definido: Sentido - IRL MCP para Codex.)
- Luz verde para construir.

## Actualización 27 oct 2026: sensor
Robin ya compró en Steren el sensor ARD-360 = DHT11 (azul, 4 pines sueltos, sin módulo).
- Mide 0-50 °C (±2 °C, resolución 1 °C) y 20-90 % RH (±5 %). Sin presión. Máx. 1 lectura por segundo; leer cada ~5 s.
- El MVP sigue igual (temperatura y humedad). El BME280 pasa a ser mejora opcional (más preciso, también I2C).
- Librería Arduino: "DHT sensor library" de Adafruit (+ Adafruit Unified Sensor), en vez de Adafruit BME280.
- Cableado (pines con la rejilla azul hacia ti): pin 1 VCC a 3V3, pin 2 DATA a GPIO4 (con resistencia de 10 kΩ entre DATA y 3V3), pin 3 sin conectar, pin 4 GND.
- Pendiente: confirmar que Robin tiene una resistencia de 10 kΩ. Usar 3V3 (no 5V) para no meter 5 V a un GPIO de 3.3 V.
- Ajuste en servidor: pressure_hpa opcional, ya estaba como opcional.

## Decisión 27 oct 2026: sin datos mockeados
Robin: no se usan lecturas simuladas ni mock en el MVP (bajaría el estatus del proyecto). Todo dato sale del DHT11 real vía la ESP32.
- Se elimina el simulador del plan y el modo SIMULATE del firmware.
- El servidor MCP no debe devolver datos inventados: si no hay lecturas recientes, `get_current_reading` indica claramente que no hay dato (stale/sin datos), nunca un valor falso.
- Orden de trabajo ajustado: firmware con sensor real primero para poder probar el servidor con datos reales; luego servidor MCP y Codex.
- Seguimos sin construir hasta que Robin diga "empieza".

## Definición firmware (27 oct 2026, sin construir)
- Cableado DHT11: pin1→3V3, pin2→GPIO4, pin4→GND. OLED SSD1306 0x3C: SDA→GPIO8, SCL→GPIO9, VCC→3V3, GND→GND.
- Sin resistencia de 10 kΩ por ahora: usar INPUT_PULLUP en GPIO4; lecturas inválidas se descartan ("Sin dato" en pantalla, nunca valores falsos). Ideal conseguir una de 10 kΩ para el demo.
- Ciclo 5 s: leer DHT11 → mostrar en OLED → POST /ingest (JSON) → LED verde/rojo. Cada ~1 s: GET /command (texto para pantalla, color LED).
- WiFi e IP del servidor como constantes al inicio del .ino. Pendiente: confirmar hotspot en el evento (IP fija vs tumac.local).
- Librerías: DHT sensor library, Adafruit Unified Sensor, Adafruit SSD1306, Adafruit GFX, ArduinoJson.
- NO construir hasta que Robin diga "empieza".

## Definición MCP, automatizaciones y correo (27 oct 2026, sin construir)
- Servidor Node/TS en la Mac: POST /ingest, GET /command, GET /health, MCP en localhost:3000/mcp. Guarda en memoria + JSONL. Sin lectura de <30 s => "no hay dato reciente".
- Tools: get_current_reading, get_history(min), get_stats(min), set_alert, get_alerts, show_on_display, set_led.
- Automatizaciones Codex (tareas programadas): 1) vigilante de humedad (>70 % => LED rojo + aviso en pantalla), 2) reporte semanal con get_stats, 3) revisión de alertas. Sondeo cada minuto para el MVP.
- Trigger por evento: no nativo en la app de escritorio. Extra opcional: el servidor lanza `codex exec` al cruzar un umbral (por probar).
- Correo: umbral (>= o <= X, temperatura o humedad) => correo una sola vez por cruce. Vía A (recomendada): servidor por SMTP Gmail con contraseña de aplicación (nodemailer). Vía B (extra): Codex con conector de Gmail. Robin conectará Gmail; falta su correo destino.
- NO construir hasta que Robin diga "empieza".

## Dashboard web (27 oct 2026, sin construir)
- Página servida por el mismo servidor en http://localhost:3000, alimentada por las mismas lecturas reales (sin datos falsos; "Sin dato" si no hay lectura reciente).
- Muestra: temp/humedad actuales, gráfica de última hora/día, mín/máx, estado del sensor, último mensaje de Codex a la pantalla, alertas disparadas. Auto-refresh cada pocos segundos.
- Repo propuesto: ~/Projects/sentido (firmware/sentido/sentido.ino, server/, docs/, README.md); secretos fuera de Git.
- NO construir hasta que Robin diga "empieza".

## Referencia de estilo del dashboard (27 oct 2026)
- Referencia Behance "Monty" (Valeria Gutsu): UI clara, fondo #F3F2F7, tarjetas blancas radio 12-16px, violeta #6D3BF5 (KPI destacado, barra activa), tinta #16141F, verde #30A46C, amarillo #F5A524, rojo ~#E5484D, tipografía tipo Inter, píldoras para estados, gráfica de barras con barra resaltada, sidebar izquierda. Imágenes en /workspace/behance/.

## DECISIÓN (27 oct 2026): estilo del dashboard = estilo claro de Monty (paleta, radios, tipografía y gráficas de la sección anterior). Robin lo confirmó. Aplicar al construir; NO construir hasta "empieza".
