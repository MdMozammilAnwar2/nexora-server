const env = require('./config/env');
const app = require('./app');
const { sequelize } = require('./models');

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✓ Database connected');
    if (env.DB_SYNC === 'alter') await sequelize.sync({ alter: true });
    else if (env.DB_SYNC === 'safe') await sequelize.sync();
    console.log(`✓ Schema ready (DB_SYNC=${env.DB_SYNC})`);
    const server = app.listen(env.PORT, () => console.log(`✓ Nexora API listening on :${env.PORT}`));
    const shutdown = () => server.close(() => sequelize.close().then(() => process.exit(0)));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (e) {
    console.error('✗ Failed to start:', e.message);
    process.exit(1);
  }
}
start();
