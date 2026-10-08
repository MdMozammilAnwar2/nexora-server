const router = require('express').Router();
const { Notification, User, Issue } = require('../models');
const { ah, notFound } = require('../utils/errors');

router.get(
  '/',
  ah(async (req, res) => {
    const notifications = await Notification.findAll({
      where: { userId: req.user.id },
      include: [
        { model: User, as: 'actor', attributes: ['id', 'name', 'avatarColor'] },
        { model: Issue, as: 'issue', attributes: ['id', 'key', 'title'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    const unread = await Notification.count({ where: { userId: req.user.id, read: false } });
    res.json({ notifications, unread });
  })
);

router.post(
  '/read-all',
  ah(async (req, res) => {
    await Notification.update({ read: true }, { where: { userId: req.user.id, read: false } });
    res.json({ ok: true });
  })
);

router.patch(
  '/:id/read',
  ah(async (req, res) => {
    const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) throw notFound();
    await n.update({ read: true });
    res.json({ notification: n });
  })
);

module.exports = router;
