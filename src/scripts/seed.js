/**
 * Usage:
 *   ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=Secret123 npm run seed     -> creates/updates admin
 *   npm run seed:demo                                                -> + demo users, project, sprint, issues
 */
const bcrypt = require('bcryptjs');
const { sequelize, User, Project, ProjectMember, Sprint, Issue } = require('../models');

async function upsertUser({ name, email, password, role, title, avatarColor }) {
  let u = await User.findOne({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 10);
  if (u) await u.update({ role, passwordHash });
  else u = await User.create({ name, email, passwordHash, role, title, avatarColor });
  return u;
}

(async () => {
  await sequelize.authenticate();
  await sequelize.sync();

  const admin = await upsertUser({
    name: process.env.ADMIN_NAME || 'Admin',
    email: (process.env.ADMIN_EMAIL || 'admin@nexora.app').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
    role: 'admin',
    title: 'Administrator',
    avatarColor: '#6366F1',
  });
  console.log(`✓ Admin: ${admin.email}`);

  if (process.argv.includes('--demo')) {
    const pm = await upsertUser({ name: 'Priya Sharma', email: 'manager@nexora.app', password: 'Manager@123', role: 'manager', title: 'Project Manager', avatarColor: '#EC4899' });
    const dev = await upsertUser({ name: 'Rahul Verma', email: 'dev@nexora.app', password: 'Member@123', role: 'member', title: 'Developer', avatarColor: '#14B8A6' });
    const des = await upsertUser({ name: 'Sana Khan', email: 'design@nexora.app', password: 'Member@123', role: 'member', title: 'Designer', avatarColor: '#F97316' });
    const viewer = await upsertUser({ name: 'Client Viewer', email: 'viewer@nexora.app', password: 'Viewer@123', role: 'viewer', title: 'Stakeholder', avatarColor: '#3B82F6' });

    let project = await Project.findOne({ where: { key: 'NEX' } });
    if (!project) {
      project = await Project.create({ key: 'NEX', name: 'Nexora Launch', description: 'Ship v1 of the Nexora platform across web, desktop and mobile.', color: '#6366F1', leadId: pm.id });
      await ProjectMember.bulkCreate([
        { projectId: project.id, userId: admin.id, role: 'manager' },
        { projectId: project.id, userId: pm.id, role: 'manager' },
        { projectId: project.id, userId: dev.id, role: 'member' },
        { projectId: project.id, userId: des.id, role: 'member' },
        { projectId: project.id, userId: viewer.id, role: 'viewer' },
      ]);
      const sprint = await Sprint.create({ projectId: project.id, name: 'NEX Sprint 1', goal: 'Core flows working end-to-end', status: 'active', startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) });
      const items = [
        ['Design system & color tokens', 'story', 'done', 'high', des, 3, true],
        ['Login & onboarding screens', 'story', 'in_review', 'high', des, 5, true],
        ['JWT auth API', 'task', 'done', 'highest', dev, 3, true],
        ['Kanban board drag & drop', 'story', 'in_progress', 'high', dev, 8, true],
        ['Crash when issue has no assignee', 'bug', 'todo', 'highest', dev, 2, true],
        ['Push notifications on mobile', 'story', 'todo', 'medium', dev, 5, true],
        ['Sprint reports & burndown', 'story', 'todo', 'medium', null, 8, false],
        ['Dark mode polish', 'task', 'todo', 'low', des, 2, false],
        ['Play Store listing assets', 'task', 'todo', 'medium', des, 3, false],
      ];
      let n = 0;
      for (const [title, type, status, priority, who, pts, inSprint] of items) {
        n += 1;
        await Issue.create({ projectId: project.id, number: n, key: `NEX-${n}`, title, type, status, priority, assigneeId: who?.id || null, reporterId: pm.id, storyPoints: pts, sprintId: inSprint ? sprint.id : null, position: n * 1000, completedAt: status === 'done' ? new Date() : null });
      }
      await project.update({ issueSeq: n });
    }
    console.log('✓ Demo data ready. Logins: manager@nexora.app / Manager@123, dev@nexora.app / Member@123, viewer@nexora.app / Viewer@123');
  }
  await sequelize.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
