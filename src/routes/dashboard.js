const router = require('express').Router();
const { Op, fn, col } = require('sequelize');
const { Issue, Project, ProjectMember, Activity, User } = require('../models');
const { ah } = require('../utils/errors');
const { issueInclude, userAttrs } = require('./issueHelpers');

router.get(
  '/',
  ah(async (req, res) => {
    const uid = req.user.id;
    let projectIds;
    if (req.user.role === 'admin') {
      projectIds = (await Project.findAll({ where: { isArchived: false }, attributes: ['id'] })).map((p) => p.id);
    } else {
      projectIds = (await ProjectMember.findAll({ where: { userId: uid }, attributes: ['projectId'] })).map((m) => m.projectId);
    }
    const scope = { projectId: projectIds };
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 864e5);

    const [myOpen, overdue, doneThisWeek, statusRows, myIssues, activity] = await Promise.all([
      Issue.count({ where: { ...scope, assigneeId: uid, status: { [Op.ne]: 'done' } } }),
      Issue.count({ where: { ...scope, assigneeId: uid, status: { [Op.ne]: 'done' }, dueDate: { [Op.lt]: today } } }),
      Issue.count({ where: { ...scope, status: 'done', completedAt: { [Op.gte]: weekAgo } } }),
      Issue.findAll({ where: scope, attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true }),
      Issue.findAll({
        where: { ...scope, assigneeId: uid, status: { [Op.ne]: 'done' } },
        include: [...issueInclude(), { model: Project, as: 'project', attributes: ['id', 'name', 'key', 'color'] }],
        order: [['updatedAt', 'DESC']],
        limit: 20,
      }),
      Activity.findAll({
        where: scope,
        include: [
          { model: User, as: 'user', attributes: userAttrs },
          { model: Project, as: 'project', attributes: ['id', 'name', 'key', 'color'] },
        ],
        order: [['createdAt', 'DESC']],
        limit: 25,
      }),
    ]);

    res.json({
      stats: {
        projects: projectIds.length,
        myOpen,
        overdue,
        doneThisWeek,
        byStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.count)])),
      },
      myIssues,
      activity,
    });
  })
);

module.exports = router;
