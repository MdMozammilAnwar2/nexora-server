const { User, Sprint, Issue } = require('../models');

const userAttrs = ['id', 'name', 'email', 'avatarColor', 'title'];

const issueInclude = (full = false) => {
  const inc = [
    { model: User, as: 'assignee', attributes: userAttrs },
    { model: User, as: 'reporter', attributes: userAttrs },
    { model: Sprint, as: 'sprint', attributes: ['id', 'name', 'status'] },
  ];
  if (full) {
    inc.push({ model: Issue, as: 'parent', attributes: ['id', 'key', 'title', 'type'] });
    inc.push({ model: Issue, as: 'children', attributes: ['id', 'key', 'title', 'type', 'status', 'priority'] });
  }
  return inc;
};

module.exports = { issueInclude, userAttrs };
