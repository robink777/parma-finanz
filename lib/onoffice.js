const crypto = require("node:crypto");

const API_URL = "https://api.onoffice.de/api/latest/api.php";

// Wie im Schwesterprojekt (~/finanzierungsrechner, lib/onoffice/client.ts) beobachtet:
// api.onoffice.de zeigt gelegentlich einen rein transienten Verbindungsfehler
// (ConnectTimeoutError beim Verbindungsaufbau) statt eines inhaltlichen API-Fehlers.
// 1 Erstversuch + 2 Wiederholungen mit kurzer Wartezeit fangen das ab, ohne das Verhalten
// bei echten (inhaltlichen) Fehlern zu veraendern.
const MAX_VERSUCHE = 3;
const WARTEZEIT_MS = 500;

function createHmac(secret, timestamp, token, resourcetype, actionid) {
  const base = String(timestamp) + token + resourcetype + actionid;
  return crypto.createHmac("sha256", secret).update(base).digest("base64");
}

// Gibt eine UNSIGNIERTE Action zurueck (kein timestamp/hmac) -- die Signierung passiert erst
// in callOnOffice, und zwar bei jedem (Wiederholungs-)Versuch neu: ein HMAC ueber einen
// mehrere Sekunden alten Timestamp koennte je nach Serverkonfiguration abgelehnt werden.
function buildAction({ actionid, resourcetype, resourceid = "", identifier = "", cacheable, parameters = {} }) {
  return { actionid, resourcetype, resourceid, identifier, cacheable, parameters };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetch() wirft bei Netzwerkproblemen (Verbindungsaufbau/-abbruch, DNS, Timeout) einen
// TypeError ("fetch failed") -- das ist der Fall, der wiederholt werden soll. Inhaltliche
// Fehler (HTTP-Status, onOffice status.code >= 400) werden bewusst NICHT wiederholt.
function istTransienterFehler(err) {
  return err instanceof TypeError && err.message === "fetch failed";
}

/**
 * Sendet eine oder mehrere onOffice-Actions und gibt response.results zurück.
 * Wirft bei HTTP-Fehlern, bei status.code >= 400 auf oberster Ebene (z.B. komplett
 * fehlgeschlagene Authentifizierung -- ohne diesen Check waere das Ergebnis still eine leere
 * Trefferliste statt eines Fehlers) und bei result.status.errorcode != 0 je Action.
 */
async function callOnOffice(actions) {
  const token = process.env.ONOFFICE_API_TOKEN;
  const secret = process.env.ONOFFICE_API_SECRET;
  if (!token || !secret) {
    throw new Error("ONOFFICE_API_TOKEN / ONOFFICE_API_SECRET nicht gesetzt.");
  }

  let letzterFehler;

  for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signedActions = actions.map((action) => ({
        ...action,
        timestamp,
        hmac: createHmac(secret, timestamp, token, action.resourcetype, action.actionid),
        hmac_version: "2",
      }));

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, request: { actions: signedActions } }),
      });

      if (!res.ok) {
        throw new Error(`onOffice API HTTP ${res.status}`);
      }

      const json = await res.json();

      if (json?.status && json.status.code >= 400) {
        throw new Error(`onOffice API Fehler: ${json.status.message} (Code ${json.status.errorcode})`);
      }

      const results = json?.response?.results || [];
      for (const result of results) {
        const errorcode = result?.status?.errorcode;
        if (errorcode !== undefined && errorcode !== 0) {
          throw new Error(
            `onOffice Action ${result.actionid}/${result.resourcetype} Fehler: ${result.status.message || errorcode}`
          );
        }
      }

      return results;
    } catch (err) {
      letzterFehler = err;
      if (!istTransienterFehler(err) || versuch === MAX_VERSUCHE) {
        throw err;
      }
      console.warn(
        `onOffice API: transienter Verbindungsfehler (Versuch ${versuch}/${MAX_VERSUCHE}), wiederhole in ${WARTEZEIT_MS}ms...`,
        err
      );
      await wait(WARTEZEIT_MS);
    }
  }

  throw letzterFehler;
}

/**
 * onOffice liefert "elements" je nach API-Version als Objekt {feld: wert}
 * oder als Array von Ein-Feld-Objekten. Diese Funktion normalisiert beides.
 */
function extractElements(record) {
  const elements = record?.elements;
  if (!elements) return {};
  if (Array.isArray(elements)) {
    return Object.assign({}, ...elements);
  }
  return elements;
}

function getRecords(result) {
  const records = result?.data?.records || [];
  return records.map((record) => ({
    id: record.id,
    ...extractElements(record),
  }));
}

const ACTION_GET = "urn:onoffice-de-ns:smart:2.5:smartml:action:get";

// Bilder sind kein Feld des Estate-Datensatzes, sondern ein eigener Resourcetype
// ("estatepictures"). Live gegen den Account geprueft: jedes "record" traegt "elements" als
// ARRAY (ein einzelnes Bildobjekt {estateid, type, url}), NICHT als Feld-Objekt wie bei
// estate/address -- getRecords()/extractElements() sind hier absichtlich NICHT einsetzbar, da
// sie mehrere Bildobjekte faelschlich zu einem verschmelzen wuerden. Genutzt von mehreren
// Endpunkten (api/estates.js, api/top-estates.js), daher hier zentral statt dupliziert.
async function fetchEstateImages(estateIds, size = "120x120") {
  if (!estateIds.length) return {};

  const action = buildAction({
    actionid: ACTION_GET,
    resourcetype: "estatepictures",
    cacheable: true,
    parameters: {
      estateids: estateIds.map(Number),
      categories: ["Titelbild", "Foto"],
      size,
      language: "DEU",
    },
  });

  const results = await callOnOffice([action]);
  const records = results[0]?.data?.records || [];
  const pictures = records.flatMap((r) => (Array.isArray(r.elements) ? r.elements : []));

  const map = {};
  for (const id of estateIds) {
    const idStr = String(id);
    const picsForEstate = pictures.filter((p) => String(p.estateid) === idStr);
    const titelbild = picsForEstate.find((p) => p.type === "Titelbild") || picsForEstate[0];
    if (titelbild) map[idStr] = titelbild.url;
  }
  return map;
}

module.exports = { buildAction, callOnOffice, getRecords, fetchEstateImages };
