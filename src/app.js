const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError, DatabaseError } = require('sequelize');
const env = require('./config/env');
const { requireAuth } = require('./middleware/auth');
const { ApiError } = require('./utils/errors');

const app = express();
app.set('trust proxy', 1); // behind Render / Railway / Nginx
app.use(helmet());
// app.use(
//   cors({
//     origin: (origin, cb) => {
//       // mobile apps & Electron (file://) send no origin
//       if (!origin || env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
//       cb(new ApiError(403, `Origin ${origin} not allowed by CORS`));
//     },
//     credentials: true,
//   })
// );
const allowedOrigins = (env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header
      // Example: Postman, mobile apps, server-to-server
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.trim().replace(/\/$/, '');

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      console.error('❌ CORS blocked:', origin);
      console.error('Allowed origins:', allowedOrigins);

      return callback(new Error(`CORS blocked: ${origin}`));
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept'
    ],

    optionsSuccessStatus: 204
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.isProd ? 'combined' : 'dev'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });

app.get('/', (req, res) => res.json({ name: 'Nexora API', status: 'ok' }));
app.get('/api/health', async (req, res) => {
  try {
    await require('./models').sequelize.authenticate();
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/projects', requireAuth, require('./routes/projects'));
app.use('/api/issues', requireAuth, require('./routes/issues'));
app.use('/api/sprints', requireAuth, require('./routes/sprints'));
app.use('/api/comments', requireAuth, require('./routes/comments'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/notifications', requireAuth, require('./routes/notifications'));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof UniqueConstraintError) return res.status(409).json({ error: 'Already exists' });
  if (err instanceof ForeignKeyConstraintError) return res.status(400).json({ error: 'Referenced record does not exist' });
  if (err instanceof ValidationError) return res.status(400).json({ error: err.errors?.[0]?.message || 'Invalid data' });
  if (err instanceof DatabaseError && /invalid input syntax for type uuid/.test(err.message))
    return res.status(400).json({ error: 'Invalid id' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: env.isProd ? 'Something went wrong' : err.message });
});

module.exports = app;
