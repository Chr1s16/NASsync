const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const JOBS_FILE = '/data/jobs.json';

if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true });

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

const activeSyncs = {};
const sseClients = {};

function broadcast(jobId, event) {
  const clients = sseClients[jobId] || [];
  const data = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach(res => { try { res.write(data); } catch {} });
}

// --- Jobs CRUD ---
app.get('/api/jobs', (req, res) => {
  const jobs = loadJobs();
  jobs.forEach(j => {
    if (activeSyncs[j.id]) {
      j.status = activeSyncs[j.id].status;
      j.stats = activeSyncs[j.id].stats;
    }
  });
  res.json(jobs);
});

app.post('/api/jobs', (req, res) => {
  const { name, source, destination, options } = req.body;
  if (!name || !source || !destination) return res.status(400).json({ error: 'Missing fields' });
  const jobs = loadJobs();
  const job = {
    id: Date.now().toString(),
    name,
    source,
    destination,
    options: options || { delete: false, checksum: false, dryRun: false },
    status: 'idle',
    lastRun: null,
    lastResult: null
  };
  jobs.push(job);
  saveJobs(jobs);
  res.json(job);
});

app.put('/api/jobs/:id', (req, res) => {
  const jobs = loadJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  jobs[idx] = { ...jobs[idx], ...req.body, id: jobs[idx].id };
  saveJobs(jobs);
  res.json(jobs[idx]);
});

app.delete('/api/jobs/:id', (req, res) => {
  let jobs = loadJobs();
  jobs = jobs.filter(j => j.id !== req.params.id);
  saveJobs(jobs);
  res.json({ ok: true });
});

// --- Sync control ---
app.post('/api/jobs/:id/start', (req, res) => {
  const jobs = loadJobs();
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (activeSyncs[job.id]?.status === 'running') return res.status(409).json({ error: 'Already running' });

  if (!fs.existsSync(job.source)) return res.status(400).json({ error: `Source path does not exist: ${job.source}` });
  if (!fs.existsSync(job.destination)) return res.status(400).json({ error: `Destination path does not exist: ${job.destination}` });

  const args = [
    '-rlth', '--progress', '--stats',
    '--no-perms', '--no-owner', '--no-group', '--omit-dir-times',
  ];
  if (job.options?.delete) args.push('--delete');
  if (job.options?.checksum) args.push('--checksum');
  if (job.options?.dryRun) args.push('--dry-run');

  const src = job.source.endsWith('/') ? job.source : job.source + '/';
  const dst = job.destination.endsWith('/') ? job.destination : job.destination + '/';
  args.push(src, dst);

  const syncState = {
    status: 'running',
    logs: [],
    stats: { filesTransferred: 0, totalSize: '', speed: '', elapsed: '', progress: 0 },
    startTime: Date.now()
  };
  activeSyncs[job.id] = syncState;

  const proc = spawn('rsync', args);
  syncState.process = proc;

  proc.stdout.on('data', chunk => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      syncState.logs.push({ time: new Date().toISOString(), text: line });
      if (syncState.logs.length > 2000) syncState.logs.shift();

      const progressMatch = line.match(/(\d+)%/);
      if (progressMatch) syncState.stats.progress = parseInt(progressMatch[1]);

      const speedMatch = line.match(/([\d,]+\.\d+\s+\w+\/s)/);
      if (speedMatch) syncState.stats.speed = speedMatch[1];

      const filesMatch = line.match(/Number of files transferred:\s+(\d+)/);
      if (filesMatch) syncState.stats.filesTransferred = parseInt(filesMatch[1]);

      const sizeMatch = line.match(/Total transferred file size:\s+([\d,.\s\w]+)/);
      if (sizeMatch) syncState.stats.totalSize = sizeMatch[1].trim();

      broadcast(job.id, { type: 'log', line, stats: syncState.stats });
    });
  });

  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    syncState.logs.push({ time: new Date().toISOString(), text: '[ERR] ' + text, error: true });
    broadcast(job.id, { type: 'log', line: '[ERR] ' + text, error: true });
  });

  proc.on('close', code => {
    syncState.status = code === 0 ? 'done' : code === null ? 'stopped' : 'error';
    syncState.endTime = Date.now();
    syncState.stats.elapsed = ((syncState.endTime - syncState.startTime) / 1000).toFixed(1) + 's';

    const jobs2 = loadJobs();
    const idx = jobs2.findIndex(j => j.id === job.id);
    if (idx !== -1) {
      jobs2[idx].status = 'idle';
      jobs2[idx].lastRun = new Date().toISOString();
      jobs2[idx].lastResult = syncState.status;
      saveJobs(jobs2);
    }

    broadcast(job.id, { type: 'done', status: syncState.status, stats: syncState.stats });
    setTimeout(() => { delete activeSyncs[job.id]; }, 30000);
  });

  res.json({ ok: true, message: 'Sync started' });
});

app.post('/api/jobs/:id/stop', (req, res) => {
  const sync = activeSyncs[req.params.id];
  if (!sync || sync.status !== 'running') return res.status(400).json({ error: 'Not running' });
  sync.process.kill('SIGTERM');
  sync.status = 'stopping';
  res.json({ ok: true, message: 'Stop signal sent' });
});

app.get('/api/jobs/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients[req.params.id]) sseClients[req.params.id] = [];
  sseClients[req.params.id].push(res);

  const sync = activeSyncs[req.params.id];
  if (sync) {
    sync.logs.slice(-100).forEach(l => {
      res.write(`data: ${JSON.stringify({ type: 'log', line: l.text, error: l.error })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: 'status', status: sync.status, stats: sync.stats })}\n\n`);
  }

  req.on('close', () => {
    sseClients[req.params.id] = (sseClients[req.params.id] || []).filter(r => r !== res);
  });
});

app.get('/api/jobs/:id/status', (req, res) => {
  const sync = activeSyncs[req.params.id];
  if (!sync) return res.json({ status: 'idle' });
  res.json({ status: sync.status, stats: sync.stats, logCount: sync.logs.length });
});

app.get('/api/drives', (req, res) => {
  const proc = spawn('df', ['-h', '--output=target,size,used,avail,pcent']);
  let out = '';
  proc.stdout.on('data', d => out += d);
  proc.on('close', () => {
    const lines = out.trim().split('\n').slice(1);
    const drives = lines.map(l => {
      const parts = l.trim().split(/\s+/);
      return { mount: parts[0], size: parts[1], used: parts[2], avail: parts[3], pct: parts[4] };
    }).filter(d => d.mount && d.mount !== 'tmpfs' && !d.mount.startsWith('/proc'));
    res.json(drives);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NAS Sync running on :${PORT}`));
