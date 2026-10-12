// Thin wrapper around the self-hosted SWGoH Comlink service. Comlink itself
// handles the (mostly unauthenticated) calls to the actual game API - see
// https://github.com/swgoh-utils/swgoh-comlink and docs/ARCHITECTURE.md.
const COMLINK_URL = () => process.env.COMLINK_URL || "http://comlink:3000";

async function post(path, body, timeoutMs = 30000) {
  let res;
  try {
    res = await fetch(`${COMLINK_URL()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Couldn't reach Comlink at ${COMLINK_URL()} (${err.message})`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Comlink ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function fetchPlayerByAllyCode(allyCode) {
  return post("/player", { payload: { allyCode: String(allyCode) }, enums: false });
}

// { latestGamedataVersion, latestLocalizationBundleVersion, ... }
async function fetchMetadata() {
  return post("/metadata", {});
}

// Game data segment 3 holds the `units` collection (every unit at every
// star level, with skills/stats/categories). It's large, hence the long
// timeout - this is only called from the occasional admin "import units"
// action, never from the overlay.
async function fetchUnitDefinitions(gameDataVersion) {
  const data = await post(
    "/data",
    { payload: { version: gameDataVersion, includePveUnits: false, requestSegment: 3 }, enums: false },
    180000
  );
  if (!Array.isArray(data.units)) {
    throw new Error("Comlink /data response had no units collection");
  }
  return data.units;
}

// Returns the English localization file as a { KEY: "Display text" } map.
// Comlink returns it as { "Loc_ENG_US.txt": "KEY|Value\n..." } when asked
// for a single language, unzipped.
async function fetchEnglishLocalization(localizationVersion) {
  const bundle = await post(
    "/localization",
    { payload: { id: `${localizationVersion}:ENG_US` }, unzip: true },
    120000
  );
  const fileName = Object.keys(bundle).find((k) => /ENG_US/i.test(k)) || Object.keys(bundle)[0];
  if (!fileName || typeof bundle[fileName] !== "string") {
    throw new Error("Comlink /localization response had no English text file");
  }
  return parseLocalization(bundle[fileName]);
}

function parseLocalization(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("|");
    if (sep <= 0) continue;
    map.set(line.slice(0, sep), line.slice(sep + 1));
  }
  return map;
}

module.exports = {
  fetchPlayerByAllyCode,
  fetchMetadata,
  fetchUnitDefinitions,
  fetchEnglishLocalization,
  parseLocalization,
};
