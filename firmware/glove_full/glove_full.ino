// Glove firmware: 2x flex (D34, D35) + MPU-6500 IMU (I2C SDA=21 SCL=22)
//
// Emits the monitor's 48-byte binary frame at a fixed 50 Hz:
//   [0xAA 0x55] [5 x uint16 LE flex] [9 x float32 LE accel xyz, gyro xyz, mag xyz]
// flex[0] = D34, flex[1] = D35, flex[2..4] = 0 (unused channels).
// Mag is zero: the MPU-6500 has no magnetometer.
//
// Wiring per flex sensor (one divider each, middle point to its own pin):
//   3V3 -- flex -- (middle) -- resistor -- GND,   middle -> D34 / D35
// GPIO 34/35 are input-only and have NO internal pull resistors: an
// unconnected pin floats and reads random values. That is wiring, not code.
#include <Wire.h>

// --- pins -------------------------------------------------------------------
static const int FLEX_PINS[] = {34, 35};
static const int FLEX_COUNT  = sizeof(FLEX_PINS) / sizeof(FLEX_PINS[0]);
static const int SDA_PIN = 21;
static const int SCL_PIN = 22;
static const int LED_PIN = 2;

// --- timing -----------------------------------------------------------------
static const uint32_t FRAME_PERIOD_US = 20000;  // 50 Hz
static const int ADC_SAMPLES = 9;               // median-of-9 per frame

// --- gyro calibration ---------------------------------------------------------
// Measured over 299 still samples (5 min), 2026-10-16:
//   X = -5.101 dps (std 0.181), Y = +7.412 dps (std 0.224), Z = -0.495 dps (std 0.145)
// At boot we re-measure for 2 s and use the result ONLY if the board was still
// (low spread); otherwise these stored offsets stay in use.
static float gyroOff[3] = {-5.101f, 7.412f, -0.495f};
static const int   CAL_SAMPLES  = 400;   // 400 x 5 ms = 2 s
static const float CAL_MAX_STD  = 1.0f;  // dps; above this the board was moving

static const uint8_t FRAME_MAGIC[2] = {0xAA, 0x55};
static uint8_t mpuAddr = 0x68;
static bool imuReady = false;

// --- I2C helpers --------------------------------------------------------------
static bool i2cW(uint8_t a, uint8_t r, uint8_t v) {
  Wire.beginTransmission(a); Wire.write(r); Wire.write(v);
  return Wire.endTransmission() == 0;
}
static bool i2cR(uint8_t a, uint8_t r, uint8_t *b, size_t n) {
  Wire.beginTransmission(a); Wire.write(r);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)a, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) b[i] = Wire.read();
  return true;
}

// --- IMU ----------------------------------------------------------------------
static bool imuInit() {
  bool found = false;
  for (uint8_t a : {0x68, 0x69}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { mpuAddr = a; found = true; break; }
  }
  if (!found) { Serial.println("[imu] no device at 0x68/0x69"); return false; }
  uint8_t who = 0;
  i2cR(mpuAddr, 0x75, &who, 1);
  Serial.printf("[imu] WHO_AM_I=0x%02X @0x%02X\n", who, mpuAddr);
  if (who == 0x00 || who == 0xFF) return false;

  i2cW(mpuAddr, 0x6B, 0x80); delay(100);   // reset
  i2cW(mpuAddr, 0x6B, 0x01); delay(20);    // wake, PLL clock
  i2cW(mpuAddr, 0x1C, 0x00);               // accel +-2 g
  i2cW(mpuAddr, 0x1B, 0x00);               // gyro +-250 dps
  i2cW(mpuAddr, 0x1A, 0x03);               // DLPF 44 Hz
  delay(20);
  Serial.println("[imu] ready");
  return true;
}

static bool readRawGyro(float *g) {
  uint8_t b[6];
  if (!i2cR(mpuAddr, 0x43, b, 6)) return false;
  const float G = 250.0f / 32768.0f;
  g[0] = (int16_t)((b[0] << 8) | b[1]) * G;
  g[1] = (int16_t)((b[2] << 8) | b[3]) * G;
  g[2] = (int16_t)((b[4] << 8) | b[5]) * G;
  return true;
}

// Re-measure the gyro zero-rate offset; keep it only if the board was still.
static void calibrateGyro() {
  Serial.println("[cal] measuring gyro offset, keep still 2 s...");
  double s[3] = {0, 0, 0}, q[3] = {0, 0, 0};
  int n = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    float g[3];
    if (readRawGyro(g)) {
      for (int k = 0; k < 3; k++) { s[k] += g[k]; q[k] += (double)g[k] * g[k]; }
      n++;
    }
    delay(5);
  }
  if (n < CAL_SAMPLES / 2) { Serial.println("[cal] too few reads, keeping stored offsets"); return; }
  float mean[3], sd[3], worst = 0;
  for (int k = 0; k < 3; k++) {
    mean[k] = s[k] / n;
    double var = q[k] / n - (double)mean[k] * mean[k];
    sd[k] = var > 0 ? sqrt(var) : 0;
    if (sd[k] > worst) worst = sd[k];
  }
  if (worst > CAL_MAX_STD) {
    Serial.printf("[cal] board moved (std %.2f dps), keeping stored offsets\n", worst);
    return;
  }
  for (int k = 0; k < 3; k++) gyroOff[k] = mean[k];
  Serial.printf("[cal] gyro offset = %.3f / %.3f / %.3f dps\n", gyroOff[0], gyroOff[1], gyroOff[2]);
}

// Reads accel (g) and offset-corrected gyro (dps). Returns false on an I2C error.
static bool readIMU(float *accel, float *gyro) {
  uint8_t b[14];
  if (!i2cR(mpuAddr, 0x3B, b, 14)) return false;
  const float A = 2.0f / 32768.0f, G = 250.0f / 32768.0f;
  accel[0] = (int16_t)((b[0] << 8) | b[1]) * A;
  accel[1] = (int16_t)((b[2] << 8) | b[3]) * A;
  accel[2] = (int16_t)((b[4] << 8) | b[5]) * A;
  gyro[0]  = (int16_t)((b[8] << 8) | b[9]) * G - gyroOff[0];
  gyro[1]  = (int16_t)((b[10] << 8) | b[11]) * G - gyroOff[1];
  gyro[2]  = (int16_t)((b[12] << 8) | b[13]) * G - gyroOff[2];
  return true;
}

// --- flex ---------------------------------------------------------------------
// Median of ADC_SAMPLES raw reads: rejects single-sample spikes better than a mean.
static uint16_t readFlex(int pin) {
  uint16_t v[ADC_SAMPLES];
  for (int i = 0; i < ADC_SAMPLES; i++) v[i] = analogRead(pin);
  for (int i = 1; i < ADC_SAMPLES; i++) {           // insertion sort (9 items)
    uint16_t x = v[i]; int j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
    v[j + 1] = x;
  }
  return v[ADC_SAMPLES / 2];
}

// --- main ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1500);
  pinMode(LED_PIN, OUTPUT);
  analogReadResolution(12);
  for (int i = 0; i < FLEX_COUNT; i++) analogSetPinAttenuation(FLEX_PINS[i], ADC_11db);  // 0-3.3 V
  Wire.begin(SDA_PIN, SCL_PIN, 400000);
  delay(2000);   // the MPU needs time after a cold boot
  Serial.println();
  Serial.println("=== GLOVE FIRMWARE (flex D34+D35 + IMU) ===");
  imuReady = imuInit();
  if (imuReady) calibrateGyro();
  else Serial.println("[imu] not up yet - will retry in loop");
  Serial.println("[stream] binary frames: 5x uint16 flex + 9x float32 @50 Hz");
}

void loop() {
  static uint32_t next = micros();
  static uint32_t retry = 0;

  // Bring the IMU (back) up if it is missing; calibration only on (re)init.
  if (!imuReady && millis() - retry > 2000) {
    retry = millis();
    imuReady = imuInit();
    if (imuReady) calibrateGyro();
  }

  // Fixed 50 Hz schedule (no drift from the work done per frame).
  if ((int32_t)(micros() - next) < 0) return;
  next += FRAME_PERIOD_US;
  if ((int32_t)(micros() - next) > (int32_t)FRAME_PERIOD_US) next = micros();  // resync after a stall

  uint16_t flex[5] = {0, 0, 0, 0, 0};
  for (int i = 0; i < FLEX_COUNT && i < 5; i++) flex[i] = readFlex(FLEX_PINS[i]);

  float accel[3] = {0, 0, 0}, gyro[3] = {0, 0, 0};
  if (imuReady && !readIMU(accel, gyro)) {
    imuReady = false;              // I2C error: drop to the retry path above
    accel[0] = accel[1] = accel[2] = 0;
    gyro[0] = gyro[1] = gyro[2] = 0;
  }
  float imu[9] = {accel[0], accel[1], accel[2], gyro[0], gyro[1], gyro[2], 0, 0, 0};

  Serial.write(FRAME_MAGIC, 2);
  Serial.write((uint8_t *)flex, sizeof(flex));
  Serial.write((uint8_t *)imu, sizeof(imu));

  digitalWrite(LED_PIN, (flex[0] < 500) ? HIGH : LOW);
}
