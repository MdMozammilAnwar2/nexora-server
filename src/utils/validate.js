const { badRequest } = require('./errors');

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest(details[0] ? `${details[0].field || 'input'}: ${details[0].message}` : 'Invalid input', details);
  }
  return r.data;
}
module.exports = { parse };
