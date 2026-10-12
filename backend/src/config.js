const path = require("path");

// Paths default to where the Docker image puts things; override with env
// vars when running outside Docker (local dev, tests).
module.exports = {
  uploadDir: process.env.UPLOAD_DIR || "/app/uploads",
  // Built web admin UI (frontend/ -> `npm run build`), served by this same
  // server. Missing in a backend-only checkout, which is fine - the API
  // still works on its own.
  webDir: process.env.WEB_DIR || path.join(__dirname, "..", "public"),
};
