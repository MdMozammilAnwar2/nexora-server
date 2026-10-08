const router = require('express').Router();
const { z } = require('zod');
const { Op, fn, col } = require('sequelize');
const { sequelize, Project, ProjectMember, User, Sprint, Issue, Activity } = require('../models');
const { loadProject, assertEdit, assertManage } = require('../middleware/access');
const { ah, forbidden, conflict, notFound, badRequest } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { logActivity, notify } = require('../utils/events');
const C = require('../utils/constants');
const { issueInclude } = require('./issueHelpers');

const userAttrs = ['id', 'name', 'email', 'avatarColor', 'title', 'role'];

/* ---------- list projects visible to me ---------- */
router.get(
  '/',
  ah(async (req, res) => {
    const where = { isArchived: req.query.archived === 'true' };
    const include = [
      { model: User, as: 'lead', attributes: userAttrs },
      { model: ProjectMember, as: 'members', include: [{ model: User, as: 'user', attributes: userAttrs }] },
    ];
    let projects;
    if (req.user.role === 'admin') {
      projects = await Project.findAll({ where, include, order: [['createdAt', 'DESC']] });
    } else {
      const mine = await ProjectMember.findAll({ where: { userId: req.user.id }, attributes: ['projectId'] });
      where.id = mine.map((m) => m.projectId);
      projects = await Project.findAll({ where, include, order: [['createdAt', 'DESC']] });
    }
    // issue counts per project
    const ids = projects.map((p) => p.id);
    const counts = ids.length
      ? await Issue.findAll({
          where: { projectId: ids },
          attributes: ['projectId', 'status', [fn('COUNT', col('id')), 'count']],
          group: ['projectId', 'status'],
          raw: true,
        })
      : [];
    const out = projects.map((p) => {
      const j = p.toJSON();
      const mine = counts.filter((c) => c.projectId === p.id);
      j.issueCount = mine.reduce((s, c) => s + Number(c.count), 0);
      j.doneCount = mine.filter((c) => c.status === 'done').reduce((s, c) => s + Number(c.count), 0);
      return j;
    });
    res.json({ projects: out });
  })
);

/* ---------- create project (admin / manager) ---------- */
router.post(
  '/',
  ah(async (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) throw forbidden('Only admins and managers can create projects');
    const data = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        key: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'must be 2-10 letters/numbers, starting with a letter'),
        description: z.string().max(5000).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        memberIds: z.array(z.string().uuid()).optional(),
      }),
      req.body
    );
    if (await Project.findOne({ where: { key: data.key } })) throw conflict(`Project key ${data.key} is already used`);
    const project = await sequelize.transaction(async (t) => {
      const p = await Project.create(
        { name: data.name, key: data.key, description: data.description, color: data.color, leadId: req.user.id },
        { transaction: t }
      );
      const memberIds = [...new Set([req.user.id, ...(data.memberIds || [])])];
      await ProjectMember.bulkCreate(
        memberIds.map((userId) => ({ projectId: p.id, userId, role: userId === req.user.id ? 'manager' : 'member' })),
        { transaction: t }
      );
      await logActivity({ userId: req.user.id, projectId: p.id, action: 'project.created', meta: { name: p.name } }, t);
      return p;
    });
    res.status(201).json({ project });
  })
);

/* ---------- single project ---------- */
router.get(
  '/:projectId',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    const project = await Project.findByPk(req.project.id, {
      include: [
        { model: User, as: 'lead', attributes: userAttrs },
        { model: ProjectMember, as: 'members', include: [{ model: User, as: 'user', attributes: userAttrs }] },
        { model: Sprint, as: 'sprints', where: { status: { [Op.ne]: 'completed' } }, required: false },
      ],
      order: [[{ model: Sprint, as: 'sprints' }, 'createdAt', 'ASC']],
    });
    res.json({ project, myRole: req.projectRole });
  })
);

router.patch(
  '/:projectId',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    assertManage(req);
    const data = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().max(5000).nullable().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        leadId: z.string().uuid().optional(),
        isArchived: z.boolean().optional(),
      }),
      req.body
    );
    await req.project.update(data);
    await logActivity({ userId: req.user.id, projectId: req.project.id, action: 'project.updated', meta: data });
    res.json({ project: req.project });
  })
);

router.delete(
  '/:projectId',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    if (req.projectRole !== 'admin') throw forbidden('Only admins can delete projects');
    await req.project.destroy();
    res.json({ ok: true });
  })
);

/* ---------- members ---------- */
router.get(
  '/:projectId/members',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    const members = await ProjectMember.findAll({
      where: { projectId: req.project.id },
      include: [{ model: User, as: 'user', attributes: userAttrs }],
      order: [[{ model: User, as: 'user' }, 'name', 'ASC']],
    });
    res.json({ members });
  })
);

router.post(
  '/:projectId/members',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    assertManage(req);
    const data = parse(
      z.object({ userId: z.string().uuid(), role: z.enum(C.PROJECT_ROLES).default('member') }),
      req.body
    );
    const user = await User.findByPk(data.userId);
    if (!user) throw notFound('User not found');
    const [member, created] = await ProjectMember.findOrCreate({
      where: { projectId: req.project.id, userId: user.id },
      defaults: { role: data.role },
    });
    if (!created) await member.update({ role: data.role });
    await logActivity({ userId: req.user.id, projectId: req.project.id, action: 'member.added', meta: { name: user.name } });
    await notify([user.id], {
      type: 'project.added',
      title: `You were added to ${req.project.name}`,
      body: `${req.user.name} added you as ${data.role}`,
      projectId: req.project.id,
      actorId: req.user.id,
    });
    res.status(created ? 201 : 200).json({ member });
  })
);

router.patch(
  '/:projectId/members/:userId',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    assertManage(req);
    const { role } = parse(z.object({ role: z.enum(C.PROJECT_ROLES) }), req.body);
    const member = await ProjectMember.findOne({ where: { projectId: req.project.id, userId: req.params.userId } });
    if (!member) throw notFound('Member not found');
    await member.update({ role });
    res.json({ member });
  })
);

router.delete(
  '/:projectId/members/:userId',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    assertManage(req);
    const member = await ProjectMember.findOne({ where: { projectId: req.project.id, userId: req.params.userId } });
    if (!member) throw notFound('Member not found');
    if (member.role === 'manager') {
      const managers = await ProjectMember.count({ where: { projectId: req.project.id, role: 'manager' } });
      if (managers <= 1) throw badRequest('A project needs at least one manager');
    }
    await member.destroy();
    res.json({ ok: true });
  })
);

/* ---------- sprints ---------- */
router.get(
  '/:projectId/sprints',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    const where = { projectId: req.project.id };
    if (req.query.status) where.status = req.query.status;
    const sprints = await Sprint.findAll({ where, order: [['createdAt', 'ASC']] });
    res.json({ sprints });
  })
);

router.post(
  '/:projectId/sprints',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    assertManage(req);
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        goal: z.string().max(2000).optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }),
      req.body
    );
    const n = (await Sprint.count({ where: { projectId: req.project.id } })) + 1;
    const sprint = await Sprint.create({ ...data, name: data.name || `${req.project.key} Sprint ${n}`, projectId: req.project.id });
    await logActivity({ userId: req.user.id, projectId: req.project.id, action: 'sprint.created', meta: { name: sprint.name } });
    res.status(201).json({ sprint });
  })
);

/* ---------- issues ---------- */
router.get(
  '/:projectId/issues',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    const where = { projectId: req.project.id };
    const { status, assigneeId, type, priority, q, sprintId, backlog } = req.query;
    if (status) where.status = status.split(',');
    if (type) where.type = type.split(',');
    if (priority) where.priority = priority.split(',');
    if (assigneeId) where.assigneeId = assigneeId === 'me' ? req.user.id : assigneeId === 'none' ? null : assigneeId;
    if (backlog === 'true') where.sprintId = null;
    else if (sprintId === 'active') {
      const active = await Sprint.findOne({ where: { projectId: req.project.id, status: 'active' } });
      where.sprintId = active ? active.id : null;
    } else if (sprintId) where.sprintId = sprintId;
    if (q) where[Op.or] = [{ title: { [Op.iLike]: `%${q}%` } }, { key: { [Op.iLike]: `%${q}%` } }];
    const issues = await Issue.findAll({ where, include: issueInclude(), order: [['position', 'ASC'], ['createdAt', 'ASC']] });
    res.json({ issues });
  })
);

router.post(
  '/:projectId/issues',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    assertEdit(req);
    const data = parse(
      z.object({
        title: z.string().trim().min(1).max(255),
        description: z.string().max(20000).optional(),
        type: z.enum(C.ISSUE_TYPES).default('task'),
        status: z.enum(C.ISSUE_STATUSES).default('todo'),
        priority: z.enum(C.PRIORITIES).default('medium'),
        assigneeId: z.string().uuid().nullable().optional(),
        sprintId: z.string().uuid().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
        storyPoints: z.number().int().min(0).max(100).nullable().optional(),
        dueDate: z.string().date().nullable().optional(),
        labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
      }),
      req.body
    );
    if (data.assigneeId) {
      const m = await ProjectMember.findOne({ where: { projectId: req.project.id, userId: data.assigneeId } });
      if (!m) throw badRequest('Assignee must be a project member');
    }
    if (data.sprintId) {
      const s = await Sprint.findOne({ where: { id: data.sprintId, projectId: req.project.id } });
      if (!s) throw badRequest('Sprint does not belong to this project');
    }
    const issue = await sequelize.transaction(async (t) => {
      const p = await Project.findByPk(req.project.id, { transaction: t, lock: t.LOCK.UPDATE });
      p.issueSeq += 1;
      await p.save({ transaction: t });
      const maxPos = (await Issue.max('position', { where: { projectId: p.id, status: data.status }, transaction: t })) || 0;
      const i = await Issue.create(
        {
          ...data,
          projectId: p.id,
          number: p.issueSeq,
          key: `${p.key}-${p.issueSeq}`,
          reporterId: req.user.id,
          position: maxPos + 1000,
          completedAt: data.status === 'done' ? new Date() : null,
        },
        { transaction: t }
      );
      await logActivity(
        { userId: req.user.id, projectId: p.id, issueId: i.id, action: 'issue.created', meta: { key: i.key, title: i.title } },
        t
      );
      return i;
    });
    if (issue.assigneeId)
      await notify([issue.assigneeId], {
        type: 'issue.assigned',
        title: `${issue.key} assigned to you`,
        body: issue.title,
        issueId: issue.id,
        projectId: req.project.id,
        actorId: req.user.id,
      });
    const full = await Issue.findByPk(issue.id, { include: issueInclude() });
    res.status(201).json({ issue: full });
  })
);

/* ---------- activity feed ---------- */
router.get(
  '/:projectId/activity',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    const activity = await Activity.findAll({
      where: { projectId: req.project.id },
      include: [{ model: User, as: 'user', attributes: userAttrs }],
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json({ activity });
  })
);

/* ---------- project report ---------- */
router.get(
  '/:projectId/stats',
  ah(async (req, res) => {
    await loadProject(req, req.params.projectId);
    const pid = req.project.id;
    const [byStatus, byType, byPriority, byAssignee] = await Promise.all(
      ['status', 'type', 'priority', 'assigneeId'].map((g) =>
        Issue.findAll({ where: { projectId: pid }, attributes: [g, [fn('COUNT', col('id')), 'count']], group: [g], raw: true })
      )
    );
    const active = await Sprint.findOne({ where: { projectId: pid, status: 'active' } });
    let sprint = null;
    if (active) {
      const issues = await Issue.findAll({ where: { sprintId: active.id }, attributes: ['status', 'storyPoints'], raw: true });
      sprint = {
        ...active.toJSON(),
        total: issues.length,
        done: issues.filter((i) => i.status === 'done').length,
        points: issues.reduce((s, i) => s + (i.storyPoints || 0), 0),
        pointsDone: issues.filter((i) => i.status === 'done').reduce((s, i) => s + (i.storyPoints || 0), 0),
      };
    }
    const toMap = (rows, k) => Object.fromEntries(rows.map((r) => [r[k] ?? 'unassigned', Number(r.count)]));
    res.json({
      byStatus: toMap(byStatus, 'status'),
      byType: toMap(byType, 'type'),
      byPriority: toMap(byPriority, 'priority'),
      byAssignee: toMap(byAssignee, 'assigneeId'),
      activeSprint: sprint,
    });
  })
);

module.exports = router;
