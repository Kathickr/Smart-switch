# ESP32 Control Server

A Node.js server + dashboard to control your ESP32 LED via BLE provisioning and HTTPS polling.

## Features
- Turn LED ON/OFF from browser
- See device online/offline status (updates every 3s)
- Schedule LED commands at specific times

## Deploy to Render.com (Free)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/esp32-server.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to https://render.com → Sign up / Log in with GitHub
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Name**: esp32-control (or any name)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Click **Create Web Service**
6. Wait ~2 minutes → you get a URL like `https://esp32-control.onrender.com`

### Step 3: Update ESP32 Code
In your Arduino sketch, change:
```cpp
#define SERVER_ADDRESS  "https://esp32-control.onrender.com"
```
(use your actual Render URL)

## Local Testing
```bash
npm install
npm start
# Open http://localhost:3000
```

## ESP32 Endpoints
- `GET  /device/command?id=DEVICE_ID` — ESP32 polls this every 3s
- `POST /device/status`               — ESP32 reports LED state

## Dashboard API
- `GET  /api/devices`                 — list all devices
- `POST /api/command`                 — send LED command
- `GET  /api/logs/:deviceId`          — activity log
- `GET/POST/PATCH/DELETE /api/schedules` — manage schedules
