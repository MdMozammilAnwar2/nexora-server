require('dotenv').config();
const fs = require('fs');
const path = require('path');

function readCa() {
  if (process.env.DB_CA_CERT) return process.env.DB_CA_CERT.replace(/\\n/g, '\n');
  const p = process.env.DB_CA_CERT_PATH;
  if (p) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
  }
  return null;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || (NODE_ENV === 'production' ? null : 'dev-only-secret-change-me');
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

module.exports = {
  NODE_ENV,
  isProd: NODE_ENV === 'production',
  PORT: Number(process.env.PORT || 5000),
  DATABASE_URL: process.env.DATABASE_URL || null,
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: Number(process.env.DB_PORT || 5432),
  DB_NAME: process.env.DB_NAME || 'defaultdb',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_SSL: process.env.DB_SSL !== 'false',
  DB_CA_CERT: readCa(),
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX || 10),
  // 'alter' = auto-update tables (dev), 'safe' = create missing tables only, 'none' = skip
  DB_SYNC: process.env.DB_SYNC || 'safe',
  JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  ALLOW_SIGNUP: process.env.ALLOW_SIGNUP !== 'false',
};
