export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Please sign in to continue.') {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'The requested resource was not found.') {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(message) {
    return new ApiError(409, 'conflict', message);
  }

  static unavailable(message, code = 'service_unavailable') {
    return new ApiError(503, code, message);
  }
}
