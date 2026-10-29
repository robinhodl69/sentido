// ============================================================================
//  Sentido - IRL MCP para Codex
//  ESP32-S3-DevKitC-1 + DHT11 + OLED SSD1306 + LED RGB integrado
//
//  Cada 5 s lee el DHT11 y lo manda al servidor (POST /ingest).
//  Cada 1 s pregunta al servidor (GET /command) si hay texto o color de LED.
//  Si el sensor falla NO se inventa nada: se muestra "Sin dato" y no se envia.
//
//  Placa en Arduino IDE: "ESP32S3 Dev Module", USB CDC On Boot: Enabled
// ============================================================================
#include <WiFi.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ---------- 1) CONFIGURA ESTO ----------------------------------------------
#if __has_include("secrets.h")
#include "secrets.h"  // Configuracion local opcional, ignorada por Git.
#endif
#ifndef SENTIDO_WIFI_SSID
#define SENTIDO_WIFI_SSID "PON_AQUI_TU_WIFI"
#endif
#ifndef SENTIDO_WIFI_PASSWORD
#define SENTIDO_WIFI_PASSWORD "PON_AQUI_TU_PASSWORD"
#endif
#ifndef SENTIDO_SERVER_HOST
#define SENTIDO_SERVER_HOST "nombre-de-tu-mac"
#endif
#ifndef SENTIDO_SERVER_IP
#define SENTIDO_SERVER_IP ""
#endif
const char* WIFI_SSID     = SENTIDO_WIFI_SSID;
const char* WIFI_PASSWORD = SENTIDO_WIFI_PASSWORD;
// Nombre de tu Mac en la red, SIN ".local". Se ve con: scutil --get LocalHostName
// El firmware busca la Mac por nombre, asi no importa que IP le toque.
const char* SERVER_HOST   = SENTIDO_SERVER_HOST;
const int   SERVER_PORT   = 3000;
// Respaldo OPCIONAL por si la busqueda por nombre falla ("" = sin respaldo).
// Se ve con: ipconfig getifaddr en0
const char* SERVER_IP_RESPALDO = SENTIDO_SERVER_IP;

// ---------- 2) PINES --------------------------------------------------------
const int DHT_PIN = 4;    // DATA del DHT11
const int SDA_PIN = 8;    // OLED
const int SCL_PIN = 9;    // OLED
// LED RGB integrado del DevKitC-1. Casi todas las placas lo traen en GPIO48;
// algunas revisiones lo traen en GPIO38. Si no enciende, prueba con 38.
const int LED_PIN = 48;

// ---------- 3) TIEMPOS Y LIMITES -------------------------------------------
const unsigned long SENSOR_EVERY_MS  = 5000;   // leer DHT11 (maximo 1 por segundo)
const unsigned long COMMAND_EVERY_MS = 1000;   // preguntar comandos
const unsigned long WIFI_RETRY_MS    = 10000;  // reintentar WiFi
const int HTTP_TIMEOUT_MS = 1500;
// Rango que un DHT11 puede medir. Fuera de esto es un error de lectura.
const float TEMP_MIN = 0,  TEMP_MAX = 50;
const float HUM_MIN  = 1,  HUM_MAX  = 100;

// ---------- Objetos ----------------------------------------------------------
DHT dht(DHT_PIN, DHT11);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

// ---------- Estado -----------------------------------------------------------
bool  haveTemp = false, haveHum = false;   // true solo si la ultima lectura fue valida
float temperature = 0, humidity = 0;
String codexText = "";                      // texto que pidio Codex ("" = ninguno)
String codexLed  = "";                      // color que pidio Codex ("" = ninguno)
bool  serverOk = true;                      // resultado del ultimo POST/GET
bool  oledOk = false;
bool  wifiWasUp = false;
String serverBase = "";                     // "http://IP:3000" una vez encontrada la Mac
unsigned long tResolve = 0;
const unsigned long RESOLVE_EVERY_MS = 15000;
bool  dirty = true;                         // true = hay que redibujar la pantalla
unsigned long tSensor = 0, tCommand = 0, tWifi = 0, flashUntil = 0;
uint8_t flashR = 0, flashG = 0, flashB = 0;
long lastLedKey = -1;

// ---------- LED --------------------------------------------------------------
// Brillo bajo (20) para que no moleste. El core de ESP32 trae neopixelWrite();
// en versiones nuevas (3.3+) se llama rgbLedWrite() y neopixelWrite esta obsoleta.
void ledWrite(uint8_t r, uint8_t g, uint8_t b) {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 3, 0)
  rgbLedWrite(LED_PIN, r, g, b);
#else
  neopixelWrite(LED_PIN, r, g, b);
#endif
}

bool colorFromName(const String& n, uint8_t& r, uint8_t& g, uint8_t& b) {
  r = g = b = 0;
  if      (n == "rojo")     r = 20;
  else if (n == "verde")    g = 20;
  else if (n == "azul")     b = 20;
  else if (n == "amarillo") { r = 20; g = 14; }
  else if (n == "blanco")   { r = 14; g = 14; b = 14; }
  else if (n == "apagado")  { }
  else return false;
  return true;
}

void flash(uint8_t r, uint8_t g, uint8_t b, unsigned long ms) {
  flashR = r; flashG = g; flashB = b; flashUntil = millis() + ms;
}

// Prioridad: 1) color de Codex  2) destello  3) estado (azul sin WiFi, verde ok, rojo error)
void updateLed() {
  uint8_t r = 0, g = 0, b = 0;
  bool codexOverride = (codexLed != "") && colorFromName(codexLed, r, g, b);
  if (codexOverride) { /* r,g,b ya quedaron con el color de Codex */ }
  else if (millis() < flashUntil) { r = flashR; g = flashG; b = flashB; }
  else if (WiFi.status() != WL_CONNECTED) b = 20;
  else if (serverOk) g = 20;
  else r = 20;
  long key = ((long)r << 16) | ((long)g << 8) | b;
  if (key != lastLedKey) { lastLedKey = key; ledWrite(r, g, b); }
}

// ---------- Pantalla ---------------------------------------------------------
// Solo ASCII (sin acentos): la fuente de la OLED no los tiene.
void drawValue(int x, bool ok, float v, const char* unit, const char* label) {
  oled.setCursor(x, 30); oled.setTextSize(1); oled.print(label);
  if (ok) { oled.setCursor(x, 12); oled.setTextSize(2); oled.print((int)round(v)); oled.print(" "); oled.print(unit); }
  else    { oled.setCursor(x, 16); oled.setTextSize(1); oled.print("Sin dato"); }
}

void draw() {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  // Linea de estado (arriba)
  oled.setTextSize(1); oled.setCursor(0, 0);
  if (WiFi.status() != WL_CONNECTED) oled.print("WiFi desconectado");
  else if (!serverOk) oled.print("Servidor sin respuesta");
  else { oled.print("WiFi "); oled.print(WiFi.RSSI()); oled.print(" dBm"); }
  // Valores grandes
  drawValue(0,  haveTemp, temperature, "C", "Temperatura");
  drawValue(72, haveHum,  humidity,    "%", "Humedad");
  // Zona de mensaje de Codex (abajo, 2 lineas de 21 caracteres)
  oled.drawFastHLine(0, 42, 128, SSD1306_WHITE);
  oled.setCursor(0, 46); oled.print(codexText.substring(0, 21));
  oled.setCursor(0, 56); oled.print(codexText.substring(21, 42));
  oled.display();
}

void showStatus(const char* line) {   // pantalla simple de arranque
  if (!oledOk) return;
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 24); oled.print(line); oled.display();
}

// ---------- WiFi -------------------------------------------------------------
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// ---------- Buscar la Mac ----------------------------------------------------
// Primero por nombre (mDNS); si falla, usa la IP de respaldo.
void findServer() {
  tResolve = millis();
  IPAddress ip = MDNS.queryHost(SERVER_HOST, 2000);
  String base = "";
  if (ip != IPAddress((uint32_t)0)) {
    base = "http://" + ip.toString() + ":" + String(SERVER_PORT);
    Serial.println("Servidor encontrado por nombre: " + base);
  } else if (strlen(SERVER_IP_RESPALDO) > 0) {
    base = "http://" + String(SERVER_IP_RESPALDO) + ":" + String(SERVER_PORT);
    Serial.println("Nombre no encontrado, uso IP de respaldo: " + base);
  } else {
    Serial.println("No encontre la Mac (nombre " + String(SERVER_HOST) + ".local)");
  }
  if (base != serverBase) { serverBase = base; dirty = true; }
}

// ---------- Sensor + POST /ingest --------------------------------------------
void readAndSend() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  haveTemp = !isnan(t) && t >= TEMP_MIN && t <= TEMP_MAX;
  haveHum  = !isnan(h) && h >= HUM_MIN  && h <= HUM_MAX;
  if (haveTemp) temperature = t;
  if (haveHum)  humidity = h;
  dirty = true;
  if (!haveTemp || !haveHum) {            // lectura mala: se descarta y NO se envia
    Serial.println("DHT11: lectura invalida, se descarta (revisa cableado)");
    flash(20, 0, 0, 1000);
    return;
  }
  Serial.printf("DHT11: %.0f C, %.0f %%\n", temperature, humidity);
  if (WiFi.status() != WL_CONNECTED || serverBase.length() == 0) {
    if (serverOk) { serverOk = false; dirty = true; }
    return;
  }

  JsonDocument doc;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();
  String body; serializeJson(doc, body);

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(serverBase + "/ingest");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  bool ok = (code == 200);
  Serial.printf("POST /ingest -> %d\n", code);
  if (ok != serverOk) dirty = true;
  serverOk = ok;
  flash(ok ? 0 : 20, ok ? 20 : 0, 0, 500);
}

// ---------- GET /command ------------------------------------------------------
void pollCommand() {
  if (WiFi.status() != WL_CONNECTED || serverBase.length() == 0) return;
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(serverBase + "/command");
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      String text = doc["display"].isNull() ? "" : String(doc["display"].as<const char*>());
      String led  = doc["led"].isNull()     ? "" : String(doc["led"].as<const char*>());
      if (text != codexText) { codexText = text; dirty = true; }
      codexLed = led;
    }
    if (!serverOk) { serverOk = true; dirty = true; }
  } else {
    Serial.printf("GET /command -> %d\n", code);
    if (serverOk) { serverOk = false; dirty = true; }
  }
  http.end();
}

// ---------- Arduino ----------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nSentido arrancando...");
  ledWrite(0, 0, 20);                 // azul = conectando
  pinMode(DHT_PIN, INPUT_PULLUP);                   // sin resistencia externa
  dht.begin();
  Wire.begin(SDA_PIN, SCL_PIN);
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledOk) Serial.println("OLED no encontrada (revisa SDA/SCL y direccion 0x3C)");
  showStatus("Conectando WiFi...");
  connectWifi();
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi OK, IP " + WiFi.localIP().toString());
    MDNS.begin("sentido-esp32");
    findServer();
  } else Serial.println("WiFi no conectado, se reintentara en el loop");
  tWifi = millis();
  tSensor = millis() - SENSOR_EVERY_MS;             // primera lectura ya
}

void loop() {
  unsigned long now = millis();
  // Si el WiFi se cae o vuelve, redibuja la linea de estado
  bool wifiNow = (WiFi.status() == WL_CONNECTED);
  if (wifiNow != wifiWasUp) {
    wifiWasUp = wifiNow; dirty = true;
    if (wifiNow) { MDNS.end(); MDNS.begin("sentido-esp32"); findServer(); }   // WiFi volvio: buscar la Mac otra vez
  }
  // Si no hay servidor o no responde, vuelve a buscarlo cada 15 s (la IP pudo cambiar)
  if (wifiNow && (serverBase.length() == 0 || !serverOk) && now - tResolve >= RESOLVE_EVERY_MS) findServer();
  // Reconexion automatica de WiFi
  if (WiFi.status() != WL_CONNECTED && now - tWifi >= WIFI_RETRY_MS) {
    Serial.println("WiFi perdido, reconectando...");
    WiFi.disconnect();
    connectWifi();
    tWifi = now; dirty = true;
  }
  if (now - tSensor >= SENSOR_EVERY_MS)   { tSensor = now;  readAndSend(); }
  if (now - tCommand >= COMMAND_EVERY_MS) { tCommand = now; pollCommand(); }
  if (dirty) { dirty = false; draw(); }
  updateLed();
  delay(10);
}
