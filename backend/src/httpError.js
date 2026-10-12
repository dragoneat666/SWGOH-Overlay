// Throw one of these from a route handler to send a specific status code and
// message (instead of the generic 500) - index.js's error handler reads
// `status` and `body`.
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.body = { error: message, ...extra };
  }
}

const badRequest = (message, extra) => new HttpError(400, message, extra);
const notFound = (message = "not found") => new HttpError(404, message);
const conflict = (message, extra) => new HttpError(409, message, extra);

module.exports = { HttpError, badRequest, notFound, conflict };
