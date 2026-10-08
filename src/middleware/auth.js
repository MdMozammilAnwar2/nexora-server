const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User } = require('../models');
const { unauthorized, forbidden } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized('Missing token');
    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch {
      throw unauthorized('Session expired, please log in again');
    }
    const user = await User.findByPk(payload.sub);
    if (!user || !user.isActive) throw unauthorized('Account disabled or not found');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

// global role guard, e.g. requireRole('admin') or requireRole('admin','manager')
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

module.exports = { signToken, requireAuth, requireRole };
