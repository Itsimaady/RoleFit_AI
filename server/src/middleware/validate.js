import { ApiError } from '../utils/errors.js';

function formatIssues(error) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Validates request parts with zod schemas. Parsed (stripped) values replace
 * the raw input, so unknown fields never reach controllers (mass-assignment guard).
 * Parsed query/params are exposed on req.valid because Express 5 makes req.query read-only.
 */
export function validate({ body, params, query } = {}) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    for (const [part, schema] of [['params', params], ['query', query], ['body', body]]) {
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const message = part === 'params' ? 'Invalid identifier.' : 'Please check the highlighted fields.';
        return next(new ApiError(400, part === 'params' ? 'invalid_id' : 'validation_error', message, formatIssues(result.error)));
      }
      req.valid[part] = result.data;
      if (part === 'body') req.body = result.data;
    }
    return next();
  };
}
