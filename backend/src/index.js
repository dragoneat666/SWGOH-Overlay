require("dotenv").config();
const { createApp } = require("./app");
const { migrateWithRetry } = require("./migrate");
const { refreshFingerprints } = require("./faceFingerprints");

async function main() {
  if (!process.env.API_TOKEN) {
    console.warn("API_TOKEN is not set - every /api request will be rejected until it is.");
  }
  await migrateWithRetry();
  try {
    await refreshFingerprints();
  } catch (err) {
    // Faces just won't be recognized until this works - don't block the API.
    console.error("Updating face fingerprints failed:", err);
  }

  const port = process.env.PORT || 4001;
  createApp().listen(port, () => {
    console.log(`SWGOH Overlay backend listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
