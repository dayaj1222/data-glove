// MPU-9250 test — ESP32, I2C SDA=21 SCL=22
// Stage 1: scan bus + WHO_AM_I. Stage 2: stream accel/gyro/mag.
#include <Wire.h>

static const int SDA_PIN = 21;
static const int SCL_PIN = 22;

static uint8_t mpuAddr = 0x68;

static bool i2cWrite(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool i2cRead(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)len) != (int)len) return false;
  for (size_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

static uint8_t read8(uint8_t addr, uint8_t reg) {
  uint8_t v = 0;
  i2cRead(addr, reg, &v, 1);
  return v;
}

static void scanBus() {
  Serial.println("--- I2C scan (SDA=21 SCL=22) ---");
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  device at 0x%02X", a);
      if (a == 0x68) Serial.print("  (MPU-9250/6050)");
      if (a == 0x69) Serial.print("  (MPU-9250/6050 alt)");
      if (a == 0x0C) Serial.print("  (AK8963 magnetometer)");
      if (a == 0x0D) Serial.print("  (QMC5883 mag)");
      if (a == 0x76 || a == 0x77) Serial.print("  (BMP280/BME280)");
      Serial.println();
      found++;
    }
  }
  if (!found) {
    Serial.println("  NO devices. Check VCC=3V3, GND, SDA=D21, SCL=D22, AD0=GND.");
  } else {
    Serial.printf("  total: %d\n", found);
  }
  Serial.println();
}

static bool mpuInit() {
  // Try both possible addresses.
  for (uint8_t a : {0x68, 0x69}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { mpuAddr = a; break; }
  }
  uint8_t who = read8(mpuAddr, 0x75);
  Serial.printf("WHO_AM_I @ 0x%02X = 0x%02X\n", mpuAddr, who);
  if (who == 0x71 || who == 0x73)      Serial.println("  -> MPU-9250 confirmed");
  else if (who == 0x68 || who == 0x70) Serial.println("  -> MPU-6050/6500 (6-axis, no mag)");
  else if (who == 0x00 || who == 0xFF) { Serial.println("  -> no valid reply, aborting"); return false; }
  else                                 Serial.println("  -> unknown chip, continuing anyway");

  i2cWrite(mpuAddr, 0x6B, 0x80);  // PWR_MGMT_1: reset
  delay(100);
  i2cWrite(mpuAddr, 0x6B, 0x01);  // wake, clock = PLL (gyro X)
  delay(10);

  i2cWrite(mpuAddr, 0x1C, 0x00);  // ACCEL_CONFIG:  +-2g
  i2cWrite(mpuAddr, 0x1B, 0x00);  // GYRO_CONFIG:   +-250 dps
  i2cWrite(mpuAddr, 0x1A, 0x03);  // CONFIG: DLPF ~44 Hz
  delay(10);

  // Enable I2C bypass so the AK8963 mag is visible at 0x0C.
  i2cWrite(mpuAddr, 0x37, 0x02);  // INT_PIN_CFG: BYPASS_EN
  delay(10);

  uint8_t magWho = read8(0x0C, 0x00);
  Serial.printf("AK8963 WHO_AM_I @ 0x0C = 0x%02X", magWho);
  if (magWho == 0x48) {
    Serial.println("  -> magnetometer OK");
    i2cWrite(0x0C, 0x0A, 0x01);   // CNTL1: power down
    delay(10);
    i2cWrite(0x0C, 0x0A, 0x16);   // CNTL1: 16-bit, continuous mode 2
    delay(10);
  } else {
    Serial.println("  -> magnetometer NOT responding (accel+gyro still work)");
  }
  return true;
}

static void readMotion() {
  uint8_t b[14];
  if (!i2cRead(mpuAddr, 0x3B, b, 14)) { Serial.println("read failed"); return; }

  int16_t ax = (b[0] << 8) | b[1];
  int16_t ay = (b[2] << 8) | b[3];
  int16_t az = (b[4] << 8) | b[5];
  int16_t t  = (b[6] << 8) | b[7];
  int16_t gx = (b[8] << 8) | b[9];
  int16_t gy = (b[10] << 8) | b[11];
  int16_t gz = (b[12] << 8) | b[13];

  const float A = 2.0f / 32768.0f;     // +-2g
  const float G = 250.0f / 32768.0f;   // +-250 dps
  float tempC = t / 333.87f + 21.0f;

  Serial.printf("a[%6.2f %6.2f %6.2f] g  w[%7.2f %7.2f %7.2f] dps  T=%.1fC",
                ax * A, ay * A, az * A, gx * G, gy * G, gz * G, tempC);

  uint8_t st = read8(0x0C, 0x02);
  if (st & 0x01) {
    uint8_t m[7];
    if (i2cRead(0x0C, 0x03, m, 7)) {
      int16_t mx = (m[1] << 8) | m[0];
      int16_t my = (m[3] << 8) | m[2];
      int16_t mz = (m[5] << 8) | m[4];
      const float M = 4912.0f / 32760.0f;  // uT
      Serial.printf("  m[%7.1f %7.1f %7.1f] uT", mx * M, my * M, mz * M);
      (void)read8(0x0C, 0x09);             // release for next sample
    }
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== MPU-9250 TEST  SDA=D21 SCL=D22 ===");
  Wire.begin(SDA_PIN, SCL_PIN, 400000);
  delay(200);
  scanBus();
  if (!mpuInit()) { Serial.println("INIT FAILED - halting"); }
  Serial.println("streaming: a=accel(g) w=gyro(dps) m=mag(uT)");
}

void loop() {
  static uint32_t last = 0;
  if (millis() - last >= 200) {
    last = millis();
    readMotion();
  }
}
