const express = require('express');
const cron    = require('node-cron');
const path    = require('path');
const mqtt    = require('mqtt');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── MQTT Setup ──────────────────────────────────────────────────────────────
// CHANGE THESE to your HiveMQ credentials
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://ed1bcddd2b4246cc97f7ad8dc0c7dfbf.s1.eu.hivemq.cloud:8883';
const MQTT_USER   = process.env.MQTT_USER   || 'Osmium';
const MQTT_PASS   = process.env.MQTT_PASS   || 'Proto2026';

const mqttClient = mqtt.connect(MQTT_BROKER, {
  username: MQTT_USER,
  password: MQTT_PASS,
  clientId: 'osmium-server-' + Math.random().toString(16).slice(2, 8)
});

mqttClient.on('connect', () => {
  console.log('[MQTT] Connected to broker');
  mqttClient.subscribe('osmium/+/status', (err) => {
    if (!err) console.log('[MQTT] Subscribed to osmium/+/status');
  });
});

mqttClient.on('message', (topic, message) => {
  const parts = topic.split('/');
  if (parts.length === 3 && parts[0] === 'osmium' && parts[2] === 'status') {
    const deviceId = parts[1];
    const status = message.toString() === 'on';
    const dev = getDevice(deviceId);
    dev.status = status;
    dev.lastSeen = new Date().toISOString();
    addLog(deviceId, `Status update via MQTT: LED ${status ? 'ON' : 'OFF'}`);
    console.log(`[MQTT] Device ${deviceId} status: ${status ? 'ON' : 'OFF'}`);
  }
});

mqttClient.on('error', (err) => {
  console.error('[MQTT] Connection error:', err.message);
});

// ─── State ───────────────────────────────────────────────────────────────────
const devices = {};       // { deviceId: { status, lastSeen, command, logs[] } }
let   schedules = [];     // [{ id, label, cronExpr, command, enabled }]
const activeCronJobs = {};

function getDevice(id) {
  if (!devices[id]) {
    devices[id] = {
      id,
      status: false,
      lastSeen: null,
      command: 'none',
      logs: []
    };
  }
  return devices[id];
}

function addLog(id, msg) {
  const dev = getDevice(id);
  dev.logs.unshift({ time: new Date().toISOString(), msg });
  if (dev.logs.length > 50) dev.logs.pop();
}

function isOnline(dev) {
  if (!dev.lastSeen) return false;
  return (Date.now() - new Date(dev.lastSeen).getTime()) < 10000; // 10s timeout
}

// ─── ESP32 Endpoints ─────────────────────────────────────────────────────────

// ESP32 polls this every 3 seconds
app.get('/device/command', (req, res) => {
  const id  = req.query.id || 'unknown';
  const dev = getDevice(id);
  dev.lastSeen = new Date().toISOString();

  const cmd = dev.command;
  if (cmd !== 'none') {
    addLog(id, `Command sent: ${cmd}`);
    dev.command = 'none'; // clear after sending once
  }

  res.json({ command: cmd });
});

// ESP32 posts status updates here
app.post('/device/status', (req, res) => {
  const { device: id, status } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing device id' });

  const dev    = getDevice(id);
  dev.status   = status;
  dev.lastSeen = new Date().toISOString();
  addLog(id, `Status update: LED ${status ? 'ON' : 'OFF'}`);

  res.json({ ok: true });
});

// ─── Dashboard API ────────────────────────────────────────────────────────────

// List all devices
app.get('/api/devices', (req, res) => {
  const list = Object.values(devices).map(d => ({
    ...d,
    online: isOnline(d)
  }));
  res.json(list);
});

// Send command to device (via MQTT)
app.post('/api/command', (req, res) => {
  const { deviceId, command } = req.body;
  if (!deviceId || !command) return res.status(400).json({ error: 'Missing fields' });

  const topic = `osmium/${deviceId}/command`;
  mqttClient.publish(topic, command, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[MQTT] Publish error:`, err);
      return res.status(500).json({ error: 'MQTT publish failed' });
    }
    addLog(deviceId, `Command sent via MQTT: ${command}`);
    console.log(`[MQTT] Published ${command} to ${topic}`);
    res.json({ ok: true, sent: command, via: 'MQTT' });
  });
});

// Get logs for a device
app.get('/api/logs/:deviceId', (req, res) => {
  const dev = devices[req.params.deviceId];
  res.json(dev ? dev.logs : []);
});

// ─── Schedule API ─────────────────────────────────────────────────────────────

function buildCron(hour, minute) {
  return `${minute} ${hour} * * *`;
}

function startCronJob(schedule) {
  if (activeCronJobs[schedule.id]) {
    activeCronJobs[schedule.id].stop();
  }
  if (!schedule.enabled) return;

  const job = cron.schedule(schedule.cronExpr, () => {
    Object.keys(devices).forEach(id => {
      const topic = `osmium/${id}/command`;
      mqttClient.publish(topic, schedule.command, { qos: 1 });
      addLog(id, `Scheduled command via MQTT: ${schedule.command} (${schedule.label})`);
    });
    console.log(`[CRON] ${schedule.label} → ${schedule.command} (sent via MQTT)`);
  });
  activeCronJobs[schedule.id] = job;
}

// Get all schedules
app.get('/api/schedules', (req, res) => res.json(schedules));

// Add schedule
app.post('/api/schedules', (req, res) => {
  const { label, hour, minute, command } = req.body;
  if (label === undefined || hour === undefined || minute === undefined || !command) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const schedule = {
    id:       Date.now().toString(),
    label,
    hour:     parseInt(hour),
    minute:   parseInt(minute),
    command,
    cronExpr: buildCron(parseInt(hour), parseInt(minute)),
    enabled:  true
  };
  schedules.push(schedule);
  startCronJob(schedule);
  
  // Push schedule to ALL devices via MQTT
  Object.keys(devices).forEach(deviceId => {
    const topic = `osmium/${deviceId}/schedule`;
    const msg = `${label},${hour},${minute},${command},1`;
    mqttClient.publish(topic, msg, { qos: 1 });
    console.log(`[MQTT] Sent schedule to ${deviceId}: ${msg}`);
  });
  
  res.json(schedule);
});

// Toggle schedule on/off
app.patch('/api/schedules/:id', (req, res) => {
  const s = schedules.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.enabled = req.body.enabled !== undefined ? req.body.enabled : !s.enabled;
  startCronJob(s);
  res.json(s);
});

// Delete schedule
app.delete('/api/schedules/:id', (req, res) => {
  const idx = schedules.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (activeCronJobs[req.params.id]) {
    activeCronJobs[req.params.id].stop();
    delete activeCronJobs[req.params.id];
  }
  schedules.splice(idx, 1);
  res.json({ ok: true });
});

// ─── Serve Dashboard ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ESP32 Control Server running on port ${PORT}`);

  // Keep Render free tier alive — ping self every 5 minutes
  const https = require('https');
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    https.get(SELF_URL, (res) => {
      console.log(`[KEEPALIVE] ping ${res.statusCode}`);
    }).on('error', () => {
      console.log('[KEEPALIVE] ping failed — server may be waking up');
    });
  }, 5 * 60 * 1000);
});