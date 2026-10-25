// Single flex sensor test — ESP32, GPIO34 (D34)
// Wiring: 3V3 -> flex sensor -> D34 -> 10k -> GND

static const int FLEX_PIN = 34;
static const int LED_PIN  = 2;
static const float R_FIXED = 10000.0f;   // 10k to GND
static const float VCC_MV  = 3300.0f;

void setup() {
  Serial.begin(115200);
  delay(1500);
  pinMode(LED_PIN, OUTPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(FLEX_PIN, ADC_11db);
  Serial.println();
  Serial.println("=== FLEX TEST  pin=D34 (GPIO34) ===");
  Serial.println("Wiring: 3V3 -> FLEX -> D34 -> 10k -> GND");
  Serial.println("Flat vs bent should change the numbers below.");
  Serial.println("raw\tmV\tRflex(ohm)");
}

void loop() {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(FLEX_PIN);
  int raw = sum / 16;

  float mv = analogReadMilliVolts(FLEX_PIN);
  float rf = -1.0f;
  if (mv > 10.0f && mv < VCC_MV - 10.0f) {
    rf = R_FIXED * (VCC_MV - mv) / mv;
  }

  if (rf < 0) Serial.printf("%4d\t%.0f\t  --\n", raw, mv);
  else       Serial.printf("%4d\t%.0f\t%.0f\n", raw, mv, rf);

  digitalWrite(LED_PIN, (raw < 2000) ? HIGH : LOW);
  delay(200);
}
