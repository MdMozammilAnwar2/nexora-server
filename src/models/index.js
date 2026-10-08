const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const C = require('../utils/constants');

const id = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };

/* ---------------- User ---------------- */
const User = sequelize.define(
  'User',
  {
    id,
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(160), allowNull: false, unique: true, validate: { isEmail: true } },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM(...C.ROLES), allowNull: false, defaultValue: 'member' },
    title: { type: DataTypes.STRING(120) },
    avatarColor: { type: DataTypes.STRING(16), defaultValue: '#6366F1' },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    lastLoginAt: { type: DataTypes.DATE },
  },
  {
    tableName: 'users',
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withPassword: { attributes: {} } },
  }
);

/* ---------------- Project ---------------- */
const Project = sequelize.define(
  'Project',
  {
    id,
    key: { type: DataTypes.STRING(10), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    description: { type: DataTypes.TEXT },
    color: { type: DataTypes.STRING(16), defaultValue: '#6366F1' },
    issueSeq: { type: DataTypes.INTEGER, defaultValue: 0 },
    isArchived: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  { tableName: 'projects' }
);

const ProjectMember = sequelize.define(
  'ProjectMember',
  {
    id,
    role: { type: DataTypes.ENUM(...C.PROJECT_ROLES), allowNull: false, defaultValue: 'member' },
  },
  { tableName: 'project_members', indexes: [{ unique: true, fields: ['project_id', 'user_id'] }] }
);

/* ---------------- Sprint ---------------- */
const Sprint = sequelize.define(
  'Sprint',
  {
    id,
    name: { type: DataTypes.STRING(120), allowNull: false },
    goal: { type: DataTypes.TEXT },
    startDate: { type: DataTypes.DATEONLY },
    endDate: { type: DataTypes.DATEONLY },
    status: { type: DataTypes.ENUM(...C.SPRINT_STATUSES), defaultValue: 'planned' },
    completedAt: { type: DataTypes.DATE },
  },
  { tableName: 'sprints' }
);

/* ---------------- Issue ---------------- */
const Issue = sequelize.define(
  'Issue',
  {
    id,
    number: { type: DataTypes.INTEGER, allowNull: false },
    key: { type: DataTypes.STRING(24), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT },
    type: { type: DataTypes.ENUM(...C.ISSUE_TYPES), defaultValue: 'task' },
    status: { type: DataTypes.ENUM(...C.ISSUE_STATUSES), defaultValue: 'todo' },
    priority: { type: DataTypes.ENUM(...C.PRIORITIES), defaultValue: 'medium' },
    storyPoints: { type: DataTypes.INTEGER },
    dueDate: { type: DataTypes.DATEONLY },
    labels: { type: DataTypes.ARRAY(DataTypes.STRING(40)), defaultValue: [] },
    position: { type: DataTypes.DOUBLE, defaultValue: 0 },
    completedAt: { type: DataTypes.DATE },
  },
  {
    tableName: 'issues',
    indexes: [
      { unique: true, fields: ['project_id', 'number'] },
      { fields: ['project_id', 'status'] },
      { fields: ['assignee_id'] },
      { fields: ['sprint_id'] },
    ],
  }
);

/* ---------------- Comment ---------------- */
const Comment = sequelize.define(
  'Comment',
  { id, body: { type: DataTypes.TEXT, allowNull: false } },
  { tableName: 'comments' }
);

/* ---------------- Activity ---------------- */
const Activity = sequelize.define(
  'Activity',
  {
    id,
    action: { type: DataTypes.STRING(60), allowNull: false },
    meta: { type: DataTypes.JSONB, defaultValue: {} },
  },
  { tableName: 'activities', updatedAt: false, indexes: [{ fields: ['project_id'] }, { fields: ['issue_id'] }] }
);

/* ---------------- Notification ---------------- */
const Notification = sequelize.define(
  'Notification',
  {
    id,
    type: { type: DataTypes.STRING(40), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    body: { type: DataTypes.TEXT },
    read: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  { tableName: 'notifications', indexes: [{ fields: ['user_id', 'read'] }] }
);

/* ---------------- Associations ---------------- */
User.hasMany(ProjectMember, { foreignKey: 'userId', onDelete: 'CASCADE' });
ProjectMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Project.hasMany(ProjectMember, { foreignKey: 'projectId', as: 'members', onDelete: 'CASCADE' });
ProjectMember.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
Project.belongsTo(User, { foreignKey: 'leadId', as: 'lead' });

Project.hasMany(Sprint, { foreignKey: 'projectId', as: 'sprints', onDelete: 'CASCADE' });
Sprint.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

Project.hasMany(Issue, { foreignKey: 'projectId', as: 'issues', onDelete: 'CASCADE' });
Issue.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });
Sprint.hasMany(Issue, { foreignKey: 'sprintId', as: 'issues' });
Issue.belongsTo(Sprint, { foreignKey: 'sprintId', as: 'sprint', onDelete: 'SET NULL' });
Issue.belongsTo(User, { foreignKey: 'assigneeId', as: 'assignee', onDelete: 'SET NULL' });
Issue.belongsTo(User, { foreignKey: 'reporterId', as: 'reporter', onDelete: 'SET NULL' });
Issue.belongsTo(Issue, { foreignKey: 'parentId', as: 'parent', onDelete: 'SET NULL' });
Issue.hasMany(Issue, { foreignKey: 'parentId', as: 'children' });

Issue.hasMany(Comment, { foreignKey: 'issueId', as: 'comments', onDelete: 'CASCADE' });
Comment.belongsTo(Issue, { foreignKey: 'issueId', as: 'issue' });
Comment.belongsTo(User, { foreignKey: 'userId', as: 'author', onDelete: 'CASCADE' });

Activity.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'SET NULL' });
Activity.belongsTo(Project, { foreignKey: 'projectId', as: 'project', onDelete: 'CASCADE' });
Activity.belongsTo(Issue, { foreignKey: 'issueId', as: 'issue', onDelete: 'CASCADE' });
Project.hasMany(Activity, { foreignKey: 'projectId', onDelete: 'CASCADE' });
Issue.hasMany(Activity, { foreignKey: 'issueId', onDelete: 'CASCADE' });

Notification.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'actorId', as: 'actor', onDelete: 'SET NULL' });
Notification.belongsTo(Issue, { foreignKey: 'issueId', as: 'issue', onDelete: 'CASCADE' });
Notification.belongsTo(Project, { foreignKey: 'projectId', as: 'project', onDelete: 'CASCADE' });

module.exports = { sequelize, User, Project, ProjectMember, Sprint, Issue, Comment, Activity, Notification };
