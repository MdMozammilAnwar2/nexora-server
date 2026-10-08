const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { Op } = require('sequelize');
const { User } = require('../models');
const { requireRole } = require('../middleware/auth');
const { ah, conflict, notFound, badRequest } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { ROLES, COLORS } = require('../utils/constants');

// Any signed-in user can list users (for assigning / adding members)
router.get(
  '/',
  ah(async (req, res) => {
    const where = {};
    if (req.query.q) {
      const q = `%${req.query.q}%`;
      where[Op.or] = [{ name: { [Op.iLike]: q } }, { email: { [Op.iLike]: q } }];
    }
    if (req.user.role !== 'admin') where.isActive = true;
    const users = await User.findAll({ where, order: [['name', 'ASC']], limit: 500 });
    res.json({ users });
  })
);

// Admin: create user with a role
router.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(8).max(128),
        role: z.enum(ROLES).default('member'),
        title: z.string().trim().max(120).optional(),
      }),
      req.body
    );
    if (await User.findOne({ where: { email: data.email } })) throw conflict('Email already registered');
    const user = await User.create({
      ...data,
      passwordHash: await bcrypt.hash(data.password, 10),
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
    const json = user.toJSON();
    delete json.passwordHash;
    res.status(201).json({ user: json });
  })
);

// Admin: change role / title / active / reset password
router.patch(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        role: z.enum(ROLES).optional(),
        title: z.string().trim().max(120).nullable().optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(8).max(128).optional(),
      }),
      req.body
    );
    const user = await User.findByPk(req.params.id);
    if (!user) throw notFound('User not found');
    if (user.id === req.user.id && (data.role && data.role !== 'admin' || data.isActive === false))
      throw badRequest('You cannot demote or deactivate yourself');
    if (data.password) {
      user.passwordHash = await bcrypt.hash(data.password, 10);
      delete data.password;
    }
    Object.assign(user, data);
    await user.save();
    const json = user.toJSON();
    delete json.passwordHash;
    res.json({ user: json });
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    if (req.params.id === req.user.id) throw badRequest('You cannot delete yourself');
    const user = await User.findByPk(req.params.id);
    if (!user) throw notFound('User not found');
    await user.destroy();
    res.json({ ok: true });
  })
);

module.exports = router;
