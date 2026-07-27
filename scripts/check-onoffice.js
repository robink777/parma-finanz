// Einmaliges Diagnose-Skript: prueft die onOffice-Verbindung direkt, ohne Vercel dev/Server.
// Aufruf: node scripts/check-onoffice.js
const fs = require("node:fs");
const path = require("node:path");

function loadEnv(file) {
  const full = path.join(__dirname, "..", file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}
loadEnv(".env");

const { buildAction, callOnOffice, getRecords } = require("../lib/onoffice");

async function main() {
  console.log("Token gesetzt:", !!process.env.ONOFFICE_API_TOKEN);
  console.log("Secret gesetzt:", !!process.env.ONOFFICE_API_SECRET);

  const filterField = process.env.ONOFFICE_ESTATE_FILTER_FIELD || "status";
  const filterValue = process.env.ONOFFICE_ESTATE_FILTER_VALUE || "1";

  const action = buildAction({
    actionid: "urn:onoffice-de-ns:smart:2.5:smartml:action:read",
    resourcetype: "estate",
    parameters: {
      data: ["Id", "objekttitel", "kaufpreis", "ort", "vermarktungsart", filterField],
      filter: {
        [filterField]: [{ op: "=", val: filterValue }],
        vermarktungsart: [{ op: "=", val: "kauf" }],
      },
      listlimit: 10,
    },
  });

  try {
    const results = await callOnOffice([action]);
    const records = getRecords(results[0]);
    console.log("\nErfolg. Anzahl Treffer (max 10 angefordert):", records.length);
    console.log(JSON.stringify(records, null, 2));
  } catch (err) {
    console.error("\nFehler beim Aufruf:", err.message);
    process.exitCode = 1;
  }
}

main();
