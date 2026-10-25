// Deep magnetometer probe for MPU-9250/6500
#include <Wire.h>
static uint8_t A = 0x68;

static bool w(uint8_t a, uint8_t r, uint8_t v) {
  Wire.beginTransmission(a); Wire.write(r); Wire.write(v);
  return Wire.endTransmission() == 0;
}
static bool rd(uint8_t a, uint8_t r, uint8_t *b, size_t n) {
  Wire.beginTransmission(a); Wire.write(r);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)a, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) b[i] = Wire.read();
  return true;
}
static uint8_t r8(uint8_t a, uint8_t r) { uint8_t v=0; rd(a,r,&v,1); return v; }

static void fullScan() {
  Serial.println("--- full bus scan (1..126) ---");
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { Serial.printf("  found 0x%02X\n", a); n++; }
  }
  Serial.printf("  total %d\n", n);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== MPU MAG PROBE ===");
  Wire.begin(21, 22, 400000);
  delay(200);
  fullScan();

  Serial.printf("WHO_AM_I(0x75) = 0x%02X\n", r8(A, 0x75));

  // Reset, wake
  w(A, 0x6B, 0x80); delay(150);
  w(A, 0x6B, 0x01); delay(50);

  Serial.println("--- before bypass ---");
  Serial.printf("  USER_CTRL(0x6A) = 0x%02X\n", r8(A, 0x6A));
  Serial.printf("  INT_PIN_CFG(0x37) = 0x%02X\n", r8(A, 0x37));
  Serial.printf("  INT_ENABLE(0x38) = 0x%02X\n", r8(A, 0x38));

  // Make sure I2C master is OFF before bypass
  w(A, 0x6A, 0x00); delay(20);
  w(A, 0x37, 0x02); delay(80);   // BYPASS_EN = bit1

  uint8_t intpin = r8(A, 0x37);
  Serial.printf("  after bypass INT_PIN_CFG(0x37) = 0x%02X  (bit1=%d)\n",
                intpin, (intpin >> 1) & 1);

  Serial.println("--- mag probes after bypass ---");
  struct { uint8_t a; const char* n; } addrs[] = {
    {0x0C, "AK8963 (9250 mag)"},
    {0x0D, "QMC5883"},
    {0x0E, "AK8963 alt"},
    {0x1E, "HMC5883"},
  };
  for (auto &x : addrs) {
    Wire.beginTransmission(x.a);
    bool ok = (Wire.endTransmission() == 0);
    Serial.printf("  0x%02X %-20s %s", x.a, x.n, ok ? "PRESENT" : "absent");
    if (ok) {
      uint8_t v = r8(x.a, 0x00);
      Serial.printf("  WHO=0x%02X", v);
      if (x.a == 0x0C && v == 0x48) Serial.print("  <-- AK8963 CONFIRMED");
    }
    Serial.println();
  }

  // Try the classic AK8963 init anyway
  Serial.println("--- AK8963 init attempt ---");
  bool ok1 = w(0x0C, 0x0A, 0x01); delay(20);   // power down
  bool ok2 = w(0x0C, 0x0A, 0x16); delay(20);   // 16-bit cont mode 2
  Serial.printf("  CNTL1 write1=%d write2=%d\n", ok1, ok2);
  Serial.printf("  CNTL1 readback = 0x%02X\n", r8(0x0C, 0x0A));
  Serial.printf("  ST1(0x02) = 0x%02X\n", r8(0x0C, 0x02));

  Serial.println();
  Serial.println("=== PROBE DONE ===");
}

void loop() {
  static uint32_t tp = 0;
  if (millis() - tp > 300) {
    tp = millis();
    Serial.println();
    Serial.println("=== REPEAT PROBE ===");
    fullScan();
    Serial.printf("WHO_AM_I(0x75) = 0x%02X\n", r8(A, 0x75));
    w(A, 0x37, 0x02); delay(80);
    Serial.printf("INT_PIN_CFG(0x37)=0x%02X\n", r8(A, 0x37));
    for (uint8_t a2 = 0x0C; a2 <= 0x0E; a2++) {
      Wire.beginTransmission(a2);
      Serial.printf("0x%02X %s\n", a2, Wire.endTransmission() == 0 ? "PRESENT" : "absent");
    }
  }
  static uint32_t t = 0;
  if (millis() - t > 500) {
    t = millis();
    uint8_t s1 = r8(0x0C, 0x02);
    uint8_t st = r8(0x0C, 0x09);
    Serial.printf("mag ST1=0x%02X ST2=0x%02X %s\n", s1, st,
                  (s1 & 0x01) ? "DRDY!" : "(no data)");
    if (s1 & 0x01) {
      uint8_t m[7];
      if (rd(0x0C, 0x03, m, 7)) {
        int16_t mx=(m[1]<<8)|m[0], my=(m[3]<<8)|m[2], mz=(m[5]<<8)|m[4];
        Serial.printf("  M = %d %d %d  (raw)\n", mx, my, mz);
      }
    }
  }
}
