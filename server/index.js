require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const store = require('./data-store');

const ENV_PATH = path.join(__dirname, '../.env');
const isProduction = process.env.GANTT_APP_MODE === 'production' || process.env.NODE_ENV === 'production';

// Validate required env vars before doing anything else
const always = ['SESSION_SECRET'];
const googleOnly = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const backend = process.env.CALENDAR_BACKEND || 'ical';
const required = backend === 'google' ? [...always, ...googleOnly] : always;

if (!fs.existsSync(ENV_PATH)) {
  console.error('\nERROR: No .env file was found.');
  console.error(`Create ${ENV_PATH} from .env.example before starting the app.\n`);
}

for (const key of required) {
  if (!process.env[key]) {
    console.error(`\nERROR: Missing required environment variable: ${key}`);
    console.error(`Copy ${path.basename(ENV_PATH)}.example to ${path.basename(ENV_PATH)} and fill in your values.\n`);
    process.exit(1);
  }
}

if (process.env.SESSION_SECRET === 'change-this-to-any-long-random-string') {
  console.warn('\nWARNING: SESSION_SECRET is still using the example value.');
  console.warn('Set it to your own random string in .env when convenient.\n');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: isProduction ? false : 'http://localhost:5173',
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set true if using HTTPS
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// API routes
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/state', require('./routes/state'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/git', require('./routes/git'));

app.post('/api/restart', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 200);
});

// In production, serve the built Vite frontend
if (isProduction) {
  const distPath = path.join(__dirname, '../client/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(PORT, () => {
  console.log(`\n✅ Gantt server running at http://localhost:${PORT}`);
  if (!isProduction) {
    console.log(`   Frontend dev server: http://localhost:5173`);
  }
  console.log(`   Data directory: ${store.DATA_DIR}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERROR: Port ${PORT} is already in use.`);
    console.error('Stop the other process or set PORT in .env and try again.');
    if (backend === 'google') {
      console.error('If you change PORT, update the Google OAuth redirect URI to match the new localhost port.');
    }
    console.error('');
    process.exit(1);
  }

  console.error('\nERROR: Failed to start the server.');
  console.error(err);
  process.exit(1);
});
