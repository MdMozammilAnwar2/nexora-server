const { Sequelize } = require('sequelize');
const env = require('./env');

const ssl = env.DB_SSL
  ? env.DB_CA_CERT
    ? { require: true, rejectUnauthorized: true, ca: env.DB_CA_CERT }
    : { require: true, rejectUnauthorized: false }
  : false;

const common = {
  dialect: 'postgres',
  // explicit driver so serverless hosts (Vercel) include it in the function bundle
  dialectModule: require('pg'),
  logging: env.NODE_ENV === 'development' && process.env.SQL_LOG === 'true' ? console.log : false,
  dialectOptions: ssl ? { ssl } : {},
  pool: { max: env.DB_POOL_MAX, min: 0, acquire: 30000, idle: 10000 },
  define: { underscored: true },
};

const sequelize = env.DATABASE_URL
  ? new Sequelize(env.DATABASE_URL, common)
  : new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, { ...common, host: env.DB_HOST, port: env.DB_PORT });

module.exports = sequelize;
