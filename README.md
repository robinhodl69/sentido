# Sentido

**Un puente entre Codex y el mundo físico.** Sentido conecta una ESP32-S3 con un sensor de temperatura y humedad a un servidor MCP local. Así puedes preguntarle a Codex cómo está el ambiente, consultar tendencias, recibir avisos y enviar mensajes a una pantalla o cambiar el color de un LED.

El proyecto nació para un hackathon de Codex, con una idea sencilla: darle al agente acceso a mediciones reales y una forma de actuar en el espacio físico. Puede servir, por ejemplo, para vigilar las condiciones de una habitación o una bodega.

Sentido no genera lecturas simuladas. Si el dispositivo no ha enviado una medición en los últimos 30 segundos, muestra **«Sin dato»**.

## Cómo funciona

```text
DHT11 → ESP32-S3 → servidor local → dashboard
                    ↕
                   Codex → pantalla OLED y LED
```

1. La ESP32 lee temperatura y humedad cada 5 segundos y envía las mediciones al servidor por WiFi.
2. El servidor guarda las lecturas en SQLite, ofrece una API para el dashboard y expone herramientas MCP para Codex.
3. La ESP32 consulta al servidor cada segundo para recibir el texto de la pantalla y el color del LED.
4. El dashboard muestra las mediciones, el historial y las automatizaciones. Las reglas pueden enviar un correo cuando se cruza un umbral.

## Qué necesitas

- Una **ESP32-S3-DevKitC-1**, un sensor **DHT11** y una pantalla **OLED SSD1306 128×64 I2C**. El LED RGB está integrado en la placa.
- Una Mac o computadora con **Node.js 22.13 o superior**, npm y Arduino IDE.
- Una red WiFi de **2.4 GHz** compartida por la computadora y la ESP32. Un hotspot de teléfono puede servir.
- Codex configurado para conectarse al servidor MCP local.

## Instalación

### 1. Conecta y configura la ESP32

| Componente | Conexión a la ESP32 |
| --- | --- |
| DHT11 | 3V3, GND y DATA en GPIO4 |
| OLED | 3V3, GND, SDA en GPIO8 y SCL en GPIO9 |

Consulta la [guía del firmware](firmware/README.md) para el cableado completo, las bibliotecas de Arduino y los ajustes de la placa. Usa **3V3**, no 5V.

Crea el archivo `firmware/sentido/secrets.h` con los datos de tu red y computadora:

```cpp
#define SENTIDO_WIFI_SSID "TuWiFi"
#define SENTIDO_WIFI_PASSWORD "TuPassword"
#define SENTIDO_SERVER_HOST "nombre-de-tu-mac"  // sin .local
#define SENTIDO_SERVER_IP "192.168.1.XX"        // respaldo opcional
```

En macOS, `scutil --get LocalHostName` muestra el nombre de la Mac. `ipconfig getifaddr en0` puede mostrar su IP en WiFi. El archivo `secrets.h` está excluido de Git: conserva ahí tus credenciales.

Abre `firmware/sentido/sentido.ino` en Arduino IDE y súbelo a la placa siguiendo la guía del firmware.

### 2. Inicia el servidor

En una terminal, desde la carpeta del proyecto:

```bash
cd server
npm install
npm run dev
```

El servidor escucha en el puerto **3000**. Para comprobar que responde, abre otra terminal y ejecuta:

```bash
curl http://localhost:3000/health
```

Debe responder `{"ok":true}`. Mantén el servidor encendido para que la ESP32 pueda enviar lecturas.

### 3. Inicia el dashboard

En otra terminal, desde la carpeta del proyecto:

```bash
cd dashboard
npm install
npm run dev
```

Abre [http://localhost:3001](http://localhost:3001). El panel consulta el servidor local cada 5 segundos. Si la placa aún no envía datos o el servidor no responde, verás «Sin dato».

### 4. Conecta Codex

Añade esta configuración a `~/.codex/config.toml`:

```toml
[mcp_servers.sentido]
url = "http://localhost:3000/mcp"
```

Reinicia Codex con el servidor encendido. Ya puedes pedirle, por ejemplo:

- «¿Qué temperatura y humedad hay ahora?»
- «Resume las lecturas de las últimas 24 horas.»
- «Pon el LED verde y muestra “Todo bien” en la pantalla.»
- «Avísame por correo cuando la humedad supere el 70 %.»

## Alertas y automatizaciones

Hay dos maneras de enviar avisos:

- **Automatizaciones con Composio y Gmail:** se crean desde el dashboard o mediante Codex, admiten varias reglas y guardan su historial en SQLite. Necesitan Composio CLI instalado y una cuenta de Gmail conectada. Una regla se evalúa con cada lectura nueva y envía un aviso por cruce del umbral.
- **Alerta individual por SMTP:** se configura con la herramienta MCP `set_alert`. Para enviar correo, copia `server/.env.example` a `server/.env` y completa los datos SMTP y el destinatario. Sin esa configuración, el servidor registra la alerta, pero no envía el correo. Los detalles están en la [guía del servidor](server/README.md).

## Herramientas MCP

| Herramientas | Función |
| --- | --- |
| `get_current_reading`, `get_history`, `get_stats` | Consultar medición actual, historial y estadísticas. |
| `show_on_display`, `set_led` | Controlar el mensaje de la OLED y el color del LED. |
| `set_alert`, `get_alerts`, `clear_alert` | Administrar la alerta individual por SMTP. |
| `get_email_connection`, `list_automations`, `create_automation`, `update_automation`, `delete_automation` | Consultar la conexión de correo y administrar automatizaciones. |

## Datos y red

Las lecturas y automatizaciones se guardan en `server/data/sentido.db`; el servidor carga en memoria los últimos 7 días para consultas. El estado de la pantalla, el LED y la alerta individual se guarda en `server/data/state.json`. La carpeta de datos está excluida de Git.

El servidor escucha en la red local y sus rutas no tienen autenticación. Úsalo en una red de confianza y evita exponer el puerto 3000 a internet.

## Documentación

- [Firmware y cableado](firmware/README.md)
- [Servidor, configuración y correo](server/README.md)
- [Dashboard](dashboard/README.md)
- [Contrato de la API](docs/API.md)
- [Plan y notas del proyecto](docs/PLAN.md)

---

Creado por Robin con Codex.
