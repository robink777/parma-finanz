const { buildAction, callOnOffice, getRecords } = require("../lib/onoffice");

const ACTION_CREATE = "urn:onoffice-de-ns:smart:2.5:smartml:action:create";

const ANLIEGEN_LABELS = {
  neukauf: "Neukauf",
  anschlussfinanzierung: "Anschlussfinanzierung",
  modernisierung: "Modernisierung",
};

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length === 1) return { vorname: "", name: parts[0] };
  return { vorname: parts.slice(0, -1).join(" "), name: parts[parts.length - 1] };
}

function euro(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    value
  );
}

function buildTaskDescription({ anliegen, message, calc }) {
  const lines = [];
  lines.push(`Anliegen: ${ANLIEGEN_LABELS[anliegen] || anliegen || "unbekannt"}`);
  if (message) lines.push(`Nachricht: ${message}`);
  if (calc) {
    lines.push("");
    lines.push("Rechner-Ergebnis (unverbindlich):");
    if (calc.kaufpreis) lines.push(`- Kaufpreis: ${euro(calc.kaufpreis)}`);
    if (calc.eigenkapital) lines.push(`- Eigenkapital: ${euro(calc.eigenkapital)}`);
    if (calc.zinsbindungJahre) lines.push(`- Zinsbindung: ${calc.zinsbindungJahre} Jahre (${calc.zinssatz} %)`);
    if (calc.tilgungssatz) lines.push(`- Anfängliche Tilgung: ${calc.tilgungssatz} %`);
    if (calc.monatlicheRate) lines.push(`- Monatliche Rate: ${euro(calc.monatlicheRate)}`);
    if (calc.estateId) lines.push(`- Ausgewählte Immobilie (onOffice-Id): ${calc.estateId}`);
  }
  lines.push("");
  lines.push("Quelle: Kontaktformular parmafinanz.de");
  return lines.join("\n");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { name, phone, email, anliegen, message, calc, consent } = body;

  if (!consent) {
    res.status(400).json({ error: "Einwilligung zur Datenverarbeitung fehlt." });
    return;
  }
  if (!name || (!phone && !email)) {
    res.status(400).json({ error: "Name und mindestens Telefon oder E-Mail werden benötigt." });
    return;
  }

  const { vorname, name: nachname } = splitName(name);

  try {
    const addressAction = buildAction({
      actionid: ACTION_CREATE,
      resourcetype: "address",
      parameters: {
        Vorname: vorname,
        Name: nachname,
        email: email || undefined,
        phone: phone || undefined,
        default_phone: phone || undefined,
        // checkDuplicate aktiviert die Dublettenpruefung ueberhaupt erst (onOffice prueft
        // standardmaessig auf "email"; im Enterprise-Account ggf. zusaetzliche Kriterien).
        // noOverrideByDuplicate bewusst NICHT gesetzt (Default false): wird eine Dublette
        // gefunden, wird der bestehende Kontakt mit den neuen Angaben aktualisiert statt
        // unveraendert zu bleiben -- bei einer erneuten Anfrage sind z.B. Telefonnummer/E-Mail
        // dann aktuell.
        checkDuplicate: true,
      },
    });

    const addressResults = await callOnOffice([addressAction]);
    const addressRecords = getRecords(addressResults[0]);
    const addressId = addressRecords[0] && addressRecords[0].id;

    try {
      const taskParameters = {
        data: {
          Betreff: `Finanzierungsanfrage: ${name}`,
          Aufgabe: buildTaskDescription({ anliegen, message, calc }),
          Prio: 2,
          Status: 1,
        },
      };
      if (addressId) taskParameters.relatedAddressId = addressId;
      const assignee = process.env.ONOFFICE_TASK_ASSIGNEE_LOGIN;
      if (assignee) {
        taskParameters.data.Verantwortung = assignee;
        taskParameters.data.Bearbeiter = assignee;
      }

      await callOnOffice([
        buildAction({
          actionid: ACTION_CREATE,
          resourcetype: "task",
          parameters: taskParameters,
        }),
      ]);
    } catch (taskErr) {
      // Adresse ist angelegt, das ist das Wichtigste fuer den Nutzer.
      // Fehler bei der Aufgabe nur serverseitig loggen, nicht die Anfrage scheitern lassen.
      console.error("api/lead: Aufgabe konnte nicht angelegt werden:", taskErr);
    }

    res.status(200).json({ ok: true, addressId });
  } catch (err) {
    console.error("api/lead error:", err);
    res.status(502).json({ error: "Anfrage konnte nicht übertragen werden. Bitte später erneut versuchen." });
  }
};
