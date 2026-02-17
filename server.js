process.env.TZ = 'Asia/Kolkata';
const express = require('express');
const cron    = require('node-cron');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Send command to device
app.post('/api/command', (req, res) => {
  const { deviceId, command } = req.body;
  if (!deviceId || !command) return res.status(400).json({ error: 'Missing fields' });

  const dev   = getDevice(deviceId);
  dev.command = command;
  addLog(deviceId, `Manual command queued: ${command}`);

  res.json({ ok: true, queued: command });
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
      getDevice(id).command = schedule.command;
      addLog(id, `Scheduled command: ${schedule.command} (${schedule.label})`);
    });
    console.log(`[CRON] ${schedule.label} → ${schedule.command}`);
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
});
