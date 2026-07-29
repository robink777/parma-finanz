const { buildAction, callOnOffice, getRecords, fetchEstateImages } = require("../lib/onoffice");

const ACTION_READ = "urn:onoffice-de-ns:smart:2.5:smartml:action:read";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { data: null, expiresAt: 0 };

async function fetchPublishedEstates() {
  // "status" (Status 1) = "1" ist das echte Aktiv-Flag in diesem Account (live geprueft: 109
  // Treffer, davon 99 mit vermarktungsart=kauf). "status2" ist HIER KEIN verlaesslicher
  // Online/Offline-Schalter -- live geprueft (Juli 2026): bei den tatsaechlich
  // veroeffentlichten Objekten steht status2 mal leer, mal "aktive_vermarktung", sogar
  // vereinzelt "reserviert" -- es ist ein CRM-Workflow-Feld, kein Verfuegbarkeits-Flag.
  //
  // WICHTIG (Bugfix Juli 2026): status=1 + vermarktungsart=kauf ALLEIN reicht nicht --
  // das lieferte live 98 Treffer, wovon nur 67 tatsaechlich veroeffentlichen=1 (also auf
  // der eigenen Webseite freigegeben) waren. Die restlichen 31 sind zwar CRM-seitig aktiv,
  // aber nicht fuer die eigene Website vorgesehen und duerfen hier nicht auftauchen --
  // veroeffentlichen ist derselbe Schalter, der schon bei "Top Angebote" (api/top-estates.js)
  // verwendet wird ("Eigene Internetseite" -> "Veroeffentlichen: ja/nein" im onOffice-Backend).
  const filterField = process.env.ONOFFICE_ESTATE_FILTER_FIELD || "status";
  const filterValue = process.env.ONOFFICE_ESTATE_FILTER_VALUE || "1";

  const action = buildAction({
    actionid: ACTION_READ,
    resourcetype: "estate",
    cacheable: true,
    parameters: {
      data: [
        "Id",
        "objekttitel",
        "kaufpreis",
        "ort",
        "plz",
        "strasse",
        "hausnummer",
        "objektnr_extern",
        "wohnflaeche",
        "vermarktungsart",
        "erstellt_am",
        "prozent_aussenprovision",
      ],
      filter: {
        [filterField]: [{ op: "=", val: filterValue }],
        vermarktungsart: [{ op: "=", val: "kauf" }],
        veroeffentlichen: [{ op: "=", val: "1" }],
      },
      // WICHTIG (verifiziert im Schwesterprojekt ~/finanzierungsrechner): listlimit-Werte ueber
      // 500 werden von der onOffice-API NICHT gekappt oder abgelehnt, sondern die API faellt
      // dann still auf ihren Standardwert von 20 Datensaetzen zurueck -- ohne Fehlermeldung.
      // 200 ist hier unkritisch, aber falls dieser Wert spaeter erhoeht wird: nie ueber 500,
      // sonst muesste wie dort ueber steigenden listoffset paginiert werden.
      listlimit: 200,
      listoffset: 0,
      sortby: { objekttitel: "ASC" },
    },
  });

  const results = await callOnOffice([action]);
  const records = getRecords(results[0]);

  const estates = records
    .filter((r) => r.kaufpreis)
    .map((r) => {
      // "prozent_aussenprovision" ist das Feld "Aussenprovision" (Prozentsatz) aus dem
      // onOffice-Backend -- bei Objektauswahl im Rechner soll dieser reale Wert die
      // Maklercourtage-Eingabe automatisch ersetzen statt eines pauschalen Schaetzwerts.
      const provision = Number(r.prozent_aussenprovision);
      return {
        id: r.Id || r.id,
        title: r.objekttitel || "Immobilie",
        price: Number(r.kaufpreis) || null,
        city: r.ort || "",
        zip: r.plz || "",
        street: [r.strasse, r.hausnummer].filter(Boolean).join(" "),
        // "objektnr_extern" (PropNo) ist die extern sichtbare Immobiliennummer (z. B. "DP116"),
        // ueber die Kunden/Berater ein Objekt aus Exposes oder E-Mails wiederfinden.
        immoNr: r.objektnr_extern || "",
        livingArea: r.wohnflaeche ? Number(r.wohnflaeche) : null,
        // "erstellt_am" (Erstellungsdatum in onOffice) statt des eigenen Feldes
        // "Vermarktungsstart am" -- Live-Stichprobe zeigte erstellt_am durchgehend befuellt,
        // das individuelle Vermarktungsstart-Feld dagegen nur bei einem Bruchteil der Objekte.
        createdAt: r.erstellt_am || null,
        provisionPercent: r.prozent_aussenprovision !== "" && !isNaN(provision) ? provision : null,
      };
    });

  // Titelbilder nachladen -- ein einziger Batch-Aufruf fuer alle Objekte statt N Einzelaufrufen.
  // Schlaegt der Bildabruf fehl, soll das die Objektauswahl selbst nicht lahmlegen (die Liste ist
  // auch ohne Bilder nutzbar) -- deshalb eigenes try/catch statt den ganzen Endpoint scheitern zu
  // lassen.
  let images = {};
  try {
    images = await fetchEstateImages(estates.map((e) => e.id));
  } catch (err) {
    console.error("api/estates: Titelbilder konnten nicht geladen werden:", err);
  }

  return estates.map((e) => ({ ...e, image: images[String(e.id)] || null }));
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (!cache.data || Date.now() > cache.expiresAt) {
      const estates = await fetchPublishedEstates();
      cache = { data: estates, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.status(200).json({ estates: cache.data });
  } catch (err) {
    console.error("api/estates error:", err);
    res.status(502).json({ error: "onOffice nicht erreichbar", estates: [] });
  }
};
