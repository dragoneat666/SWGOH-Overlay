// Thin wrapper around the self-hosted SWGoH Comlink service. Comlink itself
// handles the (mostly unauthenticated) calls to the actual game API - see
// https://github.com/swgoh-utils/swgoh-comlink and docs/ARCHITECTURE.md.
const fetch = require("node-fetch");

const COMLINK_URL = process.env.COMLINK_URL || "http://comlink:3000";

async function fetchPlayerByAllyCode(allyCode) {
  const res = await fetch(`${COMLINK_URL}/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: { allyCode: String(allyCode) } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Comlink /player failed (${res.status}): ${body}`);
  }

  return res.json();
}

module.exports = { fetchPlayerByAllyCode };
