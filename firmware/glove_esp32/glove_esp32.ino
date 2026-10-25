// I2C SCANNER - diagnostic only.
// Scans the default ESP32 I2C bus (SDA=21, SCL=22) and identifies common IMUs.
#include <Wire.h>

static const int LED_PIN = 2;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("=== I2C SCANNER ===");
  Serial.println("SDA=GPIO21 (D21)   SCL=GPIO22 (D22)");
  Wire.begin(21, 22);
}

void loop() {
  // Heartbeat: 3 quick blinks at the start of each scan cycle.
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH); delay(120);
    digitalWrite(LED_PIN, LOW);  delay(120);
  }

  Serial.println("--- scan ---");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
      Serial.printf("  FOUND device at 0x%02X", addr);
      if (addr == 0x68) Serial.print("  (MPU6050 / MPU9250 / ICM-20948)");
      if (addr == 0x69) Serial.print("  (MPU6050 alt / ICM-20948 alt)");
      if (addr == 0x28) Serial.print("  (BNO055)");
      if (addr == 0x29) Serial.print("  (BNO055 alt)");
      if (addr == 0x76) Serial.print("  (BMP280 / BME280)");
      if (addr == 0x77) Serial.print("  (BMP280 / BME280 alt)");
      if (addr == 0x1E) Serial.print("  (HMC5883 mag)");
      if (addr == 0x0D) Serial.print("  (QMC5883 mag)");
      Serial.println();
      found++;
    }
  }
  if (found == 0) {
    Serial.println("  NO devices found on the bus.");
    Serial.println("  -> check VCC=3V3, GND, SDA=D21, SCL=D22");
  } else {
    Serial.printf("  total: %d device(s)\n", found);
  }
  Serial.println();
  delay(3000);
}

