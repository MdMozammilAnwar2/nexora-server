const { Activity, Notification } = require('../models');

async function logActivity({ userId, projectId, issueId = null, action, meta = {} }, t) {
  try {
    await Activity.create({ userId, projectId, issueId, action, meta }, { transaction: t });
  } catch (e) {
    console.error('activity log failed', e.message);
  }
}

async function notify(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))].filter((u) => u !== payload.actorId);
  if (!ids.length) return;
  try {
    await Notification.bulkCreate(ids.map((userId) => ({ ...payload, userId })));
  } catch (e) {
    console.error('notify failed', e.message);
  }
}

module.exports = { logActivity, notify };
