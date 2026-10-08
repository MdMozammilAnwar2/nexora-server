const { Project, ProjectMember } = require('../models');
const { notFound, forbidden } = require('../utils/errors');

/**
 * Effective project role:
 *   admin (global)  -> 'admin'
 *   member row      -> 'manager' | 'member' | 'viewer'
 * A global 'viewer' is always capped at read-only.
 */
async function resolveProjectRole(user, projectId) {
  if (user.role === 'admin') return 'admin';
  const m = await ProjectMember.findOne({ where: { projectId, userId: user.id } });
  if (!m) return null;
  if (user.role === 'viewer') return 'viewer';
  return m.role;
}

const canEdit = (role) => ['admin', 'manager', 'member'].includes(role);
const canManage = (role) => ['admin', 'manager'].includes(role);

async function loadProject(req, projectId) {
  const project = await Project.findByPk(projectId);
  if (!project) throw notFound('Project not found');
  const role = await resolveProjectRole(req.user, project.id);
  if (!role) throw forbidden('You are not a member of this project');
  req.project = project;
  req.projectRole = role;
  return project;
}

function assertEdit(req) {
  if (!canEdit(req.projectRole)) throw forbidden('Read-only access to this project');
}
function assertManage(req) {
  if (!canManage(req.projectRole)) throw forbidden('Only project managers can do this');
}

module.exports = { resolveProjectRole, loadProject, assertEdit, assertManage, canEdit, canManage };
