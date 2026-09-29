// Express 4 doesn't forward rejected promises from an async route handler to
// the error middleware on its own (that's an Express 5 behavior) - wrap every
// async handler with this so a thrown/rejected error actually reaches
// index.js's error handler instead of hanging the request.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
