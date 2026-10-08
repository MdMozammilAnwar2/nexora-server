const router = require('express').Router();
const { z } = require('zod');
const { Op } = require('sequelize');
const { sequelize, Sprint, Issue } = require('../models');
const { loadProject, assertManage } = require('../middleware/access');
const { ah, notFound, badRequest } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { logActivity } = require('../utils/events');

async function loadSprint(req) {
  const sprint = await Sprint.findByPk(req.params.id);
  if (!sprint) throw notFound('Sprint not found');
  await loadProject(req, sprint.projectId);
  req.sprint = sprint;
  return sprint;
}

router.patch(
  '/:id',
  ah(async (req, res) => {
    const sprint = await loadSprint(req);
    assertManage(req);
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        goal: z.string().max(2000).nullable().optional(),
        startDate: z.string().date().nullable().optional(),
        endDate: z.string().date().nullable().optional(),
      }),
      req.body
    );
    await sprint.update(data);
    res.json({ sprint });
  })
);

router.post(
  '/:id/start',
  ah(async (req, res) => {
    const sprint = await loadSprint(req);
    assertManage(req);
    if (sprint.status !== 'planned') throw badRequest('Only planned sprints can be started');
    const active = await Sprint.findOne({ where: { projectId: sprint.projectId, status: 'active' } });
    if (active) throw badRequest(`Complete "${active.name}" before starting a new sprint`);
    const today = new Date().toISOString().slice(0, 10);
    const twoWeeks = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    await sprint.update({ status: 'active', startDate: sprint.startDate || today, endDate: sprint.endDate || twoWeeks });
    await logActivity({ userId: req.user.id, projectId: sprint.projectId, action: 'sprint.started', meta: { name: sprint.name } });
    res.json({ sprint });
  })
);

// Complete: unfinished issues go to `moveTo` sprint id, or back to the backlog
router.post(
  '/:id/complete',
  ah(async (req, res) => {
    const sprint = await loadSprint(req);
    assertManage(req);
    if (sprint.status !== 'active') throw badRequest('Only active sprints can be completed');
    const { moveTo } = parse(z.object({ moveTo: z.string().uuid().nullable().optional() }), req.body || {});
    if (moveTo) {
      const target = await Sprint.findOne({ where: { id: moveTo, projectId: sprint.projectId, status: 'planned' } });
      if (!target) throw badRequest('Target sprint must be a planned sprint in this project');
    }
    const moved = await sequelize.transaction(async (t) => {
      const [count] = await Issue.update(
        { sprintId: moveTo || null },
        { where: { sprintId: sprint.id, status: { [Op.ne]: 'done' } }, transaction: t }
      );
      await sprint.update({ status: 'completed', completedAt: new Date() }, { transaction: t });
      return count;
    });
    await logActivity({
      userId: req.user.id,
      projectId: sprint.projectId,
      action: 'sprint.completed',
      meta: { name: sprint.name, movedIssues: moved },
    });
    res.json({ sprint, movedIssues: moved });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const sprint = await loadSprint(req);
    assertManage(req);
    if (sprint.status === 'active') throw badRequest('Complete the sprint before deleting it');
    await Issue.update({ sprintId: null }, { where: { sprintId: sprint.id } });
    await sprint.destroy();
    res.json({ ok: true });
  })
);

module.exports = router;
