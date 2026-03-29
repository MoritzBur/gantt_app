require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

// Validate required env vars before doing anything else
const always = ['SESSION_SECRET'];
const googleOnly = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const backend = process.env.CALENDAR_BACKEND || 'ical';
const required = backend === 'google' ? [...always, ...googleOnly] : always;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`\n❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in your values.\n`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
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
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../client/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n✅ Gantt server running at http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   Frontend dev server: http://localhost:5173`);
  }
  console.log(`   Press Ctrl+C to stop.\n`);
});
