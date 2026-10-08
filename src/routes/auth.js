const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { User } = require('../models');
const env = require('../config/env');
const { signToken, requireAuth } = require('../middleware/auth');
const { ah, unauthorized, forbidden, conflict, badRequest } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { COLORS } = require('../utils/constants');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const publicUser = (u) => {
  const o = u.toJSON();
  delete o.passwordHash;
  return o;
};

router.post(
  '/register',
  ah(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(8, 'must be at least 8 characters').max(128),
      }),
      req.body
    );
    const count = await User.count();
    // First account ever created becomes the admin. After that, signup can be disabled.
    if (count > 0 && !env.ALLOW_SIGNUP) throw forbidden('Self sign-up is disabled. Ask an admin to invite you.');
    if (await User.findOne({ where: { email: data.email } })) throw conflict('Email already registered');
    const user = await User.create({
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 10),
      role: count === 0 ? 'admin' : 'member',
      avatarColor: pick(COLORS),
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  ah(async (req, res) => {
    const data = parse(
      z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }),
      req.body
    );
    const user = await User.scope('withPassword').findOne({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash)))
      throw unauthorized('Invalid email or password');
    if (!user.isActive) throw forbidden('Your account has been deactivated');
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.patch(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        title: z.string().trim().max(120).nullable().optional(),
        avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      }),
      req.body
    );
    await req.user.update(data);
    res.json({ user: req.user });
  })
);

router.post(
  '/change-password',
  requireAuth,
  ah(async (req, res) => {
    const data = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }),
      req.body
    );
    const user = await User.scope('withPassword').findByPk(req.user.id);
    if (!(await bcrypt.compare(data.currentPassword, user.passwordHash)))
      throw badRequest('Current password is incorrect');
    user.passwordHash = await bcrypt.hash(data.newPassword, 10);
    await user.save();
    res.json({ ok: true });
  })
);

module.exports = router;
