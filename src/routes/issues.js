const router = require('express').Router();
const { z } = require('zod');
const { Issue, ProjectMember, Sprint, Comment, Activity, User } = require('../models');
const { loadProject, assertEdit, assertManage } = require('../middleware/access');
const { ah, notFound, badRequest, forbidden } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { logActivity, notify } = require('../utils/events');
const C = require('../utils/constants');
const { issueInclude, userAttrs } = require('./issueHelpers');

async function loadIssue(req) {
  const issue = await Issue.findByPk(req.params.id);
  if (!issue) throw notFound('Issue not found');
  await loadProject(req, issue.projectId);
  req.issue = issue;
  return issue;
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(20000).nullable().optional(),
  type: z.enum(C.ISSUE_TYPES).optional(),
  status: z.enum(C.ISSUE_STATUSES).optional(),
  priority: z.enum(C.PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  position: z.number().optional(),
});

async function applyUpdate(req, data) {
  const issue = req.issue;
  if (data.assigneeId) {
    const m = await ProjectMember.findOne({ where: { projectId: issue.projectId, userId: data.assigneeId } });
    if (!m) throw badRequest('Assignee must be a project member');
  }
  if (data.sprintId) {
    const s = await Sprint.findOne({ where: { id: data.sprintId, projectId: issue.projectId } });
    if (!s) throw badRequest('Sprint does not belong to this project');
  }
  if (data.parentId === issue.id) throw badRequest('An issue cannot be its own parent');

  const changes = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'position') continue;
    const before = issue[k];
    if (JSON.stringify(before ?? null) !== JSON.stringify(v ?? null)) changes[k] = { from: before ?? null, to: v ?? null };
  }
  if (data.status && data.status !== issue.status) data.completedAt = data.status === 'done' ? new Date() : null;
  await issue.update(data);

  if (Object.keys(changes).length) {
    await logActivity({
      userId: req.user.id,
      projectId: issue.projectId,
      issueId: issue.id,
      action: changes.status ? 'issue.status' : 'issue.updated',
      meta: { key: issue.key, title: issue.title, changes },
    });
  }
  if (changes.assigneeId && data.assigneeId) {
    await notify([data.assigneeId], {
      type: 'issue.assigned',
      title: `${issue.key} assigned to you`,
      body: issue.title,
      issueId: issue.id,
      projectId: issue.projectId,
      actorId: req.user.id,
    });
  }
  if (changes.status) {
    await notify([issue.reporterId, issue.assigneeId], {
      type: 'issue.status',
      title: `${issue.key} moved to ${data.status.replace('_', ' ')}`,
      body: issue.title,
      issueId: issue.id,
      projectId: issue.projectId,
      actorId: req.user.id,
    });
  }
  return Issue.findByPk(issue.id, { include: issueInclude(true) });
}

router.get(
  '/:id',
  ah(async (req, res) => {
    await loadIssue(req);
    const issue = await Issue.findByPk(req.issue.id, { include: issueInclude(true) });
    res.json({ issue, myRole: req.projectRole });
  })
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    await loadIssue(req);
    assertEdit(req);
    const data = parse(updateSchema, req.body);
    res.json({ issue: await applyUpdate(req, data) });
  })
);

// Drag & drop on the board: { status, position, sprintId? }
router.post(
  '/:id/move',
  ah(async (req, res) => {
    await loadIssue(req);
    assertEdit(req);
    const data = parse(
      z.object({
        status: z.enum(C.ISSUE_STATUSES).optional(),
        position: z.number(),
        sprintId: z.string().uuid().nullable().optional(),
      }),
      req.body
    );
    res.json({ issue: await applyUpdate(req, data) });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    await loadIssue(req);
    // reporters can delete their own issues; managers/admins can delete any
    const isManager = ['admin', 'manager'].includes(req.projectRole);
    if (!isManager && req.issue.reporterId !== req.user.id) throw forbidden('Only the reporter or a manager can delete this issue');
    assertEdit(req);
    await logActivity({
      userId: req.user.id,
      projectId: req.issue.projectId,
      action: 'issue.deleted',
      meta: { key: req.issue.key, title: req.issue.title },
    });
    await req.issue.destroy();
    res.json({ ok: true });
  })
);

/* ---------- comments ---------- */
router.get(
  '/:id/comments',
  ah(async (req, res) => {
    await loadIssue(req);
    const comments = await Comment.findAll({
      where: { issueId: req.issue.id },
      include: [{ model: User, as: 'author', attributes: userAttrs }],
      order: [['createdAt', 'ASC']],
    });
    res.json({ comments });
  })
);

router.post(
  '/:id/comments',
  ah(async (req, res) => {
    await loadIssue(req);
    if (req.projectRole === 'viewer' && req.user.role === 'viewer') throw forbidden('Viewers cannot comment');
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
    const comment = await Comment.create({ issueId: req.issue.id, userId: req.user.id, body });
    await logActivity({
      userId: req.user.id,
      projectId: req.issue.projectId,
      issueId: req.issue.id,
      action: 'comment.added',
      meta: { key: req.issue.key, title: req.issue.title },
    });
    await notify([req.issue.reporterId, req.issue.assigneeId], {
      type: 'comment',
      title: `${req.user.name} commented on ${req.issue.key}`,
      body: body.slice(0, 200),
      issueId: req.issue.id,
      projectId: req.issue.projectId,
      actorId: req.user.id,
    });
    const full = await Comment.findByPk(comment.id, { include: [{ model: User, as: 'author', attributes: userAttrs }] });
    res.status(201).json({ comment: full });
  })
);

router.get(
  '/:id/activity',
  ah(async (req, res) => {
    await loadIssue(req);
    const activity = await Activity.findAll({
      where: { issueId: req.issue.id },
      include: [{ model: User, as: 'user', attributes: userAttrs }],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    res.json({ activity });
  })
);

module.exports = router;
