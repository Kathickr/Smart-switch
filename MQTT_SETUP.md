# MQTT Setup Guide

Your server now uses MQTT for real-time LED control! No more polling delays.

## Step 1: Set up HiveMQ Cloud (Free)

1. Go to https://console.hivemq.cloud/
2. Sign up (free, no credit card)
3. Create a new cluster:
   - Plan: **Free**
   - Name: `osmium-iot`
   - Region: Choose closest to you
4. Wait 2 minutes for deployment

## Step 2: Get your credentials

1. Click on your cluster → **Access Management**
2. Click **Add new credentials**:
   - Username: `osmium`
   - Password: `osmium2024` (or your choice)
   - Permissions: **Publish and Subscribe**
3. Click **Add**

4. Go to **Overview** tab and note:
   - **Host**: e.g., `abc123.s1.eu.hivemq.cloud`
   - **Port**: `8883` (TLS)
   - **Username**: `osmium`
   - **Password**: `osmium2024`

## Step 3: Update your server

### Option A: Using environment variables on Render (Recommended)

1. Go to your Render dashboard
2. Click on your service
3. Go to **Environment** tab
4. Add these variables:
   - `MQTT_BROKER` = `mqtts://YOUR_HOST:8883` (use your actual host)
   - `MQTT_USER` = `osmium`
   - `MQTT_PASS` = `osmium2024`
5. Click **Save Changes**

Render will auto-redeploy with MQTT enabled!

### Option B: Edit server.js directly

Open `server.js` and change line 11:

```javascript
// From:
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';

// To (use YOUR credentials):
const MQTT_BROKER = 'mqtts://abc123.s1.eu.hivemq.cloud:8883';
const MQTT_USER   = 'osmium';
const MQTT_PASS   = 'osmium2024';
```

Then push to GitHub.

## Step 4: Update ESP32 code

Change these lines in your Arduino sketch:

```cpp
// From:
#define MQTT_BROKER  "broker.hivemq.com"
#define MQTT_PORT    1883
#define MQTT_USER    ""
#define MQTT_PASS    ""

// To (use YOUR credentials):
#define MQTT_BROKER  "abc123.s1.eu.hivemq.cloud"
#define MQTT_PORT    8883
#define MQTT_USER    "osmium"
#define MQTT_PASS    "osmium2024"
```

Also add TLS support - replace the WiFiClient with WiFiClientSecure:

```cpp
// At the top, change:
WiFiClient espClient;
// To:
WiFiClientSecure espClient;

// In setup(), before mqtt.setServer(), add:
espClient.setInsecure();  // Skip cert verification (or add root CA)
```

Upload to ESP32.

## How it works now

**Before (HTTPS polling):**
- Dashboard → Server stores command → ESP32 polls every 5s → delay!

**After (MQTT):**
- Dashboard → Server → MQTT broker → ESP32 (instant!)
- ESP32 → MQTT broker → Server → Dashboard updates (instant!)

**MQTT Topics:**
- Command: `osmium/YOUR_DEVICE_ID/command` (receives "on"/"off")
- Status: `osmium/YOUR_DEVICE_ID/status` (publishes "on"/"off")

## Testing

1. Open dashboard: `https://smart-switch-svv7.onrender.com`
2. Click ON/OFF buttons
3. LED should respond **instantly** (no 5-second delay!)
4. Check Render logs to see `[MQTT] Published on to osmium/...`
5. Check Serial Monitor to see `[MQTT] Received: osmium/.../command → on`

## Free tier limits

HiveMQ Cloud Free:
- ✅ 100 connections
- ✅ Unlimited messages up to 10GB/month
- ✅ Perfect for hobby projects
- ✅ No credit card required
- ✅ Never expires

## Alternative: Use public broker (less reliable)

If you don't want to create an account, the code already works with the public broker `broker.hivemq.com:1883`. However:
- ❌ No authentication (anyone can send commands if they know your device ID)
- ❌ Less reliable
- ✅ No setup needed

For production, always use HiveMQ Cloud with credentials!
