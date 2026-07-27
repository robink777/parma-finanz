const { buildAction, callOnOffice, getRecords, fetchEstateImages } = require("../lib/onoffice");

const ACTION_READ = "urn:onoffice-de-ns:smart:2.5:smartml:action:read";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { data: null, expiresAt: 0 };

// Klartext fuer "objektart" -- vollstaendige Liste (11 Werte) gegen den echten Feldkatalog
// geprueft (resourcetype "fields", Juli 2026).
const OBJEKTART_LABELS = {
  zimmer: "Zimmer",
  haus: "Haus",
  wohnung: "Wohnung",
  grundstueck: "Grundstück",
  buero_praxen: "Büro/Praxen",
  einzelhandel: "Laden/Einzelhandel",
  gastgewerbe: "Gastgewerbe",
  hallen_lager_prod: "Hallen/Lager/Produktion",
  land_und_forstwirtschaft: "Land/Forstwirtschaft",
  freizeitimmbilien_gewerblich: "Freizeitimmobilie (gewerblich)",
  sonstige: "Sonstige",
};

// Baut den Slug fuer die Parma-Immobilien-Detailseite (/detailseite/{id}-{slug}/). Live
// verifiziert (Juli 2026): das WordPress-Routing dieser Seite wertet ausschliesslich die
// numerische ID im Pfad aus -- ein Aufruf mit absichtlich falschem Slug
// (/detailseite/2627-falscher-slug-test/) lieferte trotzdem HTTP 200 mit dem korrekten Objekt.
// Der Slug muss also nicht exakt dem echten WordPress-Slug entsprechen, nur URL-sicher sein.
function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function fetchTopEstates() {
  // Die vom Kunden in onOffice genutzten Vermarktungs-Checkboxen "top_angebot" und
  // "veroeffentlichen" (Abschnitt "Eigene Internetseite") tauchen NICHT im normalen
  // API-Feldkatalog (resourcetype "fields") auf, funktionieren aber live nachweislich als
  // regulaere Filter-/Datenfelder auf resourcetype "estate" (Juli 2026 gegen den Account
  // getestet: 8 Treffer, exakt deckungsgleich mit den auf parmaimmobilien.de unter "Top
  // Angebote" angezeigten Objekten).
  const action = buildAction({
    actionid: ACTION_READ,
    resourcetype: "estate",
    cacheable: true,
    parameters: {
      data: ["Id", "objekttitel", "kaufpreis", "ort", "objektart"],
      filter: {
        status: [{ op: "=", val: "1" }],
        top_angebot: [{ op: "=", val: "1" }],
        veroeffentlichen: [{ op: "=", val: "1" }],
      },
      listlimit: 30,
      sortby: { objekttitel: "ASC" },
    },
  });

  const results = await callOnOffice([action]);
  const records = getRecords(results[0]);

  const estates = records
    .filter((r) => r.kaufpreis)
    .map((r) => {
      const id = r.Id || r.id;
      const title = r.objekttitel || "Immobilie";
      return {
        id,
        title,
        price: Number(r.kaufpreis) || null,
        city: r.ort || "",
        objektart: r.objektart ? OBJEKTART_LABELS[r.objektart] || r.objektart : null,
        link: `https://www.parmaimmobilien.de/detailseite/${id}-${slugify(title)}/`,
      };
    });

  let images = {};
  try {
    // Groesser als die 120x120-Dropdown-Thumbnails in api/estates.js -- diese Bilder werden
    // als 280x180-Karten im Slider angezeigt.
    images = await fetchEstateImages(
      estates.map((e) => e.id),
      "560x360"
    );
  } catch (err) {
    console.error("api/top-estates: Titelbilder konnten nicht geladen werden:", err);
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
      const estates = await fetchTopEstates();
      cache = { data: estates, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.status(200).json({ estates: cache.data });
  } catch (err) {
    console.error("api/top-estates error:", err);
    res.status(502).json({ error: "onOffice nicht erreichbar", estates: [] });
  }
};
