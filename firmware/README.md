# Sentido · firmware (ESP32-S3)

Un solo archivo: `sentido/sentido.ino`. Lee el DHT11, muestra en la OLED, manda las lecturas al servidor y recibe texto/color de LED desde Codex. Si el sensor falla, muestra "Sin dato" y no envía nada.

## 1. Librerías (Arduino IDE → Herramientas → Administrar bibliotecas)

Busca e instala (acepta instalar dependencias):

- **DHT sensor library** (Adafruit)
- **Adafruit Unified Sensor**
- **Adafruit SSD1306**
- **Adafruit GFX Library**
- **ArduinoJson** (Benoit Blanchon, versión 7)

Placa: Administrador de placas → instala **esp32** (de Espressif). WiFi y HTTPClient vienen incluidos.

Compilado y probado con core esp32 3.3.12, ArduinoJson 7.4.3, DHT 1.4.7, SSD1306 2.5.17, GFX 1.13.0.

## 2. Ajustes de la placa

| Opción | Valor |
| --- | --- |
| Placa | **ESP32S3 Dev Module** |
| USB CDC On Boot | **Enabled** |
| Puerto | el del ESP32 (`/dev/cu.usbmodem...`) |
| Velocidad del monitor serie | 115200 |

Conecta el cable al puerto del DevKitC-1 marcado **USB** (el otro es UART; si tu Mac no lo ve, prueba el otro). Si no sube, mantén presionado **BOOT**, toca **RST** y suelta BOOT.

## 3. Cableado

| Pieza | Pin de la pieza | ESP32-S3 |
| --- | --- | --- |
| DHT11 (ARD-360), con la rejilla azul hacia ti | 1 VCC | 3V3 |
| | 2 DATA | GPIO4 |
| | 3 | sin conectar |
| | 4 GND | GND |
| OLED SSD1306 (I2C, 0x3C) | VCC | 3V3 |
| | GND | GND |
| | SDA | GPIO8 |
| | SCL | GPIO9 |

Usa **3V3**, nunca 5V. El firmware activa el pull-up interno en GPIO4, así que no hace falta resistencia (con una de 10 kΩ entre DATA y 3V3 es más estable).

## 4. WiFi y servidor

Crea `sentido/secrets.h` para configurar el WiFi y la Mac:

```cpp
// secrets.h (no se sube a Git):
#define SENTIDO_WIFI_SSID "TuWiFi"
#define SENTIDO_WIFI_PASSWORD "TuPassword"
#define SENTIDO_SERVER_HOST "nombre-de-tu-mac"  // sin .local
#define SENTIDO_SERVER_IP "192.168.1.XX"        // respaldo opcional
```

IP de tu Mac: `ipconfig getifaddr en0` (en terminal). El ESP32 y la Mac deben estar en la **misma red**. El ESP32 solo usa WiFi de **2.4 GHz**.
Nombre de la Mac: `scutil --get LocalHostName`. Mantén el WiFi y la contraseña en `secrets.h`.

Hotspot del celular: actívalo, conecta la Mac y el ESP32 a él, y vuelve a sacar la IP de la Mac con el comando de arriba (cambia en cada red). Las redes de eventos suelen aislar a los clientes entre sí, por eso conviene el hotspot.

## 5. Qué hace

- LED: azul = sin WiFi, verde = servidor responde, rojo = fallo (destello rojo de 1 s si la lectura del sensor es inválida). Si Codex pone un color con `set_led`, ese color manda.
- OLED: arriba el estado de WiFi/servidor; en medio temperatura y humedad; abajo (2 líneas de 21 caracteres) el mensaje de Codex.
- Monitor serie (115200): cada lectura y cada petición HTTP.
- LED integrado: casi todas las placas usan GPIO48; si no enciende, cambia `LED_PIN` a `38`.

## 6. Problemas comunes

- **"Sin dato" / "DHT11: lectura invalida"**: revisa el cableado (DATA en GPIO4, 3V3 y GND bien puestos, pines en el orden correcto). Agrega una resistencia de 10 kΩ entre DATA y 3V3 si persiste.
- **No sale nada en el monitor serie**: activa **USB CDC On Boot → Enabled**, vuelve a subir y reabre el monitor a 115200.
- **OLED en blanco**: revisa SDA/SCL (GPIO8/GPIO9) y la dirección 0x3C (algunas son 0x3D). El monitor serie dice "OLED no encontrada".
- **"Servidor sin respuesta"**: el servidor debe estar corriendo, el nombre o la IP de respaldo deben corresponder a tu Mac, y ambos deben estar en la misma red. En la Mac, cuando macOS pregunte si `node` puede aceptar conexiones entrantes, elige **Permitir** (o revisa Ajustes del Sistema → Red → Firewall). Prueba desde otro dispositivo: `http://IP_DE_TU_MAC:3000/health`.
- **No conecta al WiFi**: verifica nombre y contraseña, y que sea una red de 2.4 GHz.
