/**
 * Creates / updates all database tables. Run this from your PC whenever the models change
 * (needed for serverless hosts like Vercel, which don't run the startup sync):
 *   npm run db:sync
 */
const { sequelize } = require('../models');

(async () => {
  await sequelize.authenticate();
  console.log('✓ Connected');
  await sequelize.sync({ alter: true });
  console.log('✓ Tables created / updated');
  await sequelize.close();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
