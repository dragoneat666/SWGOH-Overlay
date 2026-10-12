require("dotenv").config();
const { createApp } = require("./app");
const { migrateWithRetry } = require("./migrate");

async function main() {
  if (!process.env.API_TOKEN) {
    console.warn("API_TOKEN is not set - every /api request will be rejected until it is.");
  }
  await migrateWithRetry();

  const port = process.env.PORT || 4001;
  createApp().listen(port, () => {
    console.log(`SWGOH Overlay backend listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
