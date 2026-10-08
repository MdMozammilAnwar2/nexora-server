const router = require('express').Router();
const { z } = require('zod');
const { Comment, Issue } = require('../models');
const { loadProject } = require('../middleware/access');
const { ah, notFound, forbidden } = require('../utils/errors');
const { parse } = require('../utils/validate');

async function load(req) {
  const c = await Comment.findByPk(req.params.id);
  if (!c) throw notFound('Comment not found');
  const issue = await Issue.findByPk(c.issueId);
  await loadProject(req, issue.projectId);
  return c;
}

router.patch(
  '/:id',
  ah(async (req, res) => {
    const c = await load(req);
    if (c.userId !== req.user.id) throw forbidden('You can only edit your own comments');
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
    await c.update({ body });
    res.json({ comment: c });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const c = await load(req);
    if (c.userId !== req.user.id && !['admin', 'manager'].includes(req.projectRole))
      throw forbidden('You can only delete your own comments');
    await c.destroy();
    res.json({ ok: true });
  })
);

module.exports = router;
