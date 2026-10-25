// Glove firmware: flex (D34) + MPU-6500 IMU (I2C SDA=21 SCL=22)
// Emits the monitor's 46-byte binary packet: 5x uint16 flex + 9x float32
// (accel xyz, gyro xyz, mag xyz). Mag is zero (6500 has no magnetometer).
#include <Wire.h>

static const int FLEX_PIN = 34;
static const int SDA_PIN  = 21;
static const int SCL_PIN  = 22;
static const float R_FIXED = 10000.0f;
static const float VCC_MV  = 3300.0f;

// --- Gyro calibration -------------------------------------------------------
// Measured over 299 still samples (5 min), 2026-10-16:
//   X = -5.101 dps (std 0.181), Y = +7.412 dps (std 0.224), Z = -0.495 dps (std 0.145)
// If the board is held still for ~2 s at boot we re-measure and override these.
static float gyroOff[3] = {-5.101f, 7.412f, -0.495f};
static const uint32_t CAL_SAMPLES = 400;   // 400 x 5 ms = 2 s

// --- binary packet framing --------------------------------------------------
static uint8_t mpuAddr = 0x68;
static const uint8_t FRAME_MAGIC[2] = {0xAA, 0x55};

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
static uint8_t r8(uint8_t a, uint8_t r) { uint8_t v=0; i2cR(a,r,&v,1); return v; }

static bool imuReady = false;

static bool imuInit() {
  for (uint8_t a : {0x68, 0x69}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { mpuAddr = a; break; }
  }
  uint8_t who = r8(mpuAddr, 0x75);
  Serial.printf("[imu] WHO_AM_I=0x%02X @0x%02X\n", who, mpuAddr);
  if (who == 0x00 || who == 0xFF) return false;

  i2cW(mpuAddr, 0x6B, 0x80); delay(100);   // reset
  i2cW(mpuAddr, 0x6B, 0x01); delay(20);    // wake, PLL clock
  i2cW(mpuAddr, 0x1C, 0x00);               // accel +-2g
  i2cW(mpuAddr, 0x1B, 0x00);               // gyro +-250 dps
  i2cW(mpuAddr, 0x1A, 0x03);               // DLPF 44Hz
  delay(20);
  Serial.println("[imu] ready");
  return true;
}

static void readIMU(float *accel, float *gyro) {
  uint8_t b[14];
  accel[0]=accel[1]=accel[2]=0;
  gyro[0]=gyro[1]=gyro[2]=0;
  if (!i2cR(mpuAddr, 0x3B, b, 14)) return;
  int16_t ax=(b[0]<<8)|b[1], ay=(b[2]<<8)|b[3], az=(b[4]<<8)|b[5];
  int16_t gx=(b[8]<<8)|b[9], gy=(b[10]<<8)|b[11], gz=(b[12]<<8)|b[13];
  const float A = 2.0f/32768.0f, G = 250.0f/32768.0f;
  accel[0]=ax*A; accel[1]=ay*A; accel[2]=az*A;
  // Apply the measured zero-rate offset so a still board reads ~0 dps.
  gyro[0]=gx*G - gyroOff[0];
  gyro[1]=gy*G - gyroOff[1];
  gyro[2]=gz*G - gyroOff[2];
}

static void readRawGyro(float *g) {
  uint8_t b[6];
  g[0]=g[1]=g[2]=0;
  if (!i2cR(mpuAddr, 0x43, b, 6)) return;
  int16_t gx=(b[0]<<8)|b[1], gy=(b[2]<<8)|b[3], gz=(b[4]<<8)|b[5];
  const float G = 250.0f/32768.0f;
  g[0]=gx*G; g[1]=gy*G; g[2]=gz*G;
}

// Average the gyro while still, and use that as the new offset.
static void calibrateGyro() {
  Serial.println("[cal] measuring gyro offset, keep still 2s...");
  double sx=0, sy=0, sz=0;
  int n=0;
  for (uint32_t i=0; i<CAL_SAMPLES; i++) {
    float g[3];
    readRawGyro(g);
    sx+=g[0]; sy+=g[1]; sz+=g[2];
    n++;
    delay(5);
  }
  if (n > 0) {
    gyroOff[0]=sx/n; gyroOff[1]=sy/n; gyroOff[2]=sz/n;
    Serial.printf("[cal] gyro offset = %.3f / %.3f / %.3f dps\n",
                  gyroOff[0], gyroOff[1], gyroOff[2]);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  pinMode(2, OUTPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(FLEX_PIN, ADC_11db);
  Wire.begin(SDA_PIN, SCL_PIN, 400000);
  delay(2000);   // MPU needs time after cold boot
  Serial.println();
  Serial.println("=== GLOVE FIRMWARE (flex D34 + IMU) ===");
  imuReady = imuInit();
  if (!imuReady) Serial.println("[imu] not up yet - will retry in loop");
  else calibrateGyro();
  Serial.println("[stream] binary frames: 5x uint16 flex + 9x float32");
}

void loop() {
  static uint32_t last = 0;
  static uint32_t retry = 0;

  // Retry IMU bring-up until it answers (handles loose/ late power-up).
  if (!imuReady && millis() - retry > 2000) {
    retry = millis();
    imuReady = imuInit();
    if (imuReady) calibrateGyro();
  }

  if (millis() - last < 20) return;   // 50 Hz
  last = millis();

  uint32_t sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(FLEX_PIN);
  uint16_t flex[5];
  flex[0] = sum / 8;
  flex[1] = flex[2] = flex[3] = flex[4] = 0;

  float accel[3] = {0,0,0}, gyro[3] = {0,0,0};
  if (imuReady) readIMU(accel, gyro);
  float mag[3] = {0, 0, 0};   // MPU-6500 has no magnetometer

  float imu[9] = {
    accel[0], accel[1], accel[2],
    gyro[0],  gyro[1],  gyro[2],
    mag[0],   mag[1],   mag[2],
  };

  Serial.write(FRAME_MAGIC, 2);
  Serial.write((uint8_t*)flex, sizeof(flex));
  Serial.write((uint8_t*)imu, sizeof(imu));

  digitalWrite(2, (flex[0] < 500) ? HIGH : LOW);
}
