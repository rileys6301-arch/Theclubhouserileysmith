import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes        from './routes/auth.js';
import userRoutes        from './routes/users.js';
import roundRoutes       from './routes/rounds.js';
import courseRoutes      from './routes/courses.js';
import socialRoutes      from './routes/social.js';
import noticeRoutes      from './routes/notices.js';
import competitionRoutes from './routes/competitions.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3001;
const PROD = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: PROD ? false : (process.env.CLIENT_URL || 'http://localhost:5173'),
  credentials: true,
}));
app.use(express.json());

// ── API routes ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth',         authRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/rounds',       roundRoutes);
app.use('/api/courses',      courseRoutes);
app.use('/api/social',       socialRoutes);
app.use('/api/notices',      noticeRoutes);
app.use('/api/competitions', competitionRoutes);

// ── Serve React frontend in production ──────────────────────────────────────
if (PROD) {
  const distDir = path.join(__dirname, '../frontend/dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`The Circuit server running on port ${PORT}`);
});
