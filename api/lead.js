const { buildAction, callOnOffice, getRecords } = require("../lib/onoffice");
const { sendMail } = require("../lib/mailer");

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

function buildCalcLines(calc) {
  const lines = [];
  if (!calc) return lines;
  lines.push("");
  lines.push("Rechner-Ergebnis (unverbindlich):");
  if (calc.kaufpreis) lines.push(`- Kaufpreis: ${euro(calc.kaufpreis)}`);
  if (calc.eigenkapital) lines.push(`- Eigenkapital: ${euro(calc.eigenkapital)}`);
  if (calc.zinsbindungJahre) lines.push(`- Zinsbindung: ${calc.zinsbindungJahre} Jahre (${calc.zinssatz} %)`);
  if (calc.tilgungssatz) lines.push(`- Anfängliche Tilgung: ${calc.tilgungssatz} %`);
  if (calc.monatlicheRate) lines.push(`- Monatliche Rate: ${euro(calc.monatlicheRate)}`);
  if (calc.estateId) lines.push(`- Ausgewählte Immobilie (onOffice-Id): ${calc.estateId}`);
  return lines;
}

function buildTaskDescription({ anliegen, message, calc }) {
  const lines = [];
  lines.push(`Anliegen: ${ANLIEGEN_LABELS[anliegen] || anliegen || "unbekannt"}`);
  if (message) lines.push(`Nachricht: ${message}`);
  lines.push(...buildCalcLines(calc));
  lines.push("");
  lines.push("Quelle: Kontaktformular parmafinanz.de");
  return lines.join("\n");
}

// Der E-Mail-Text enthaelt (anders als die onOffice-Aufgabe) auch die Kontaktdaten direkt --
// wer die Mail liest, hat sonst keinen unmittelbaren CRM-Zugriff und soll trotzdem sofort
// zurueckrufen/-schreiben koennen.
function buildEmailText({ name, phone, email, anliegen, message, calc }) {
  const lines = [];
  lines.push("Neue Finanzierungsanfrage über parmafinanz.de");
  lines.push("");
  lines.push(`Name: ${name}`);
  if (phone) lines.push(`Telefon: ${phone}`);
  if (email) lines.push(`E-Mail: ${email}`);
  lines.push(`Anliegen: ${ANLIEGEN_LABELS[anliegen] || anliegen || "unbekannt"}`);
  if (message) lines.push(`Nachricht: ${message}`);
  lines.push(...buildCalcLines(calc));
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

  // Die E-Mail an info@parmafinanz.de ist die verbindliche Kernfunktion des Formulars --
  // schlaegt sie fehl, muss die Anfrage als fehlgeschlagen gelten, selbst wenn onOffice
  // (weiter unten) erreichbar waere. Deshalb zuerst und ohne Fallback versucht.
  try {
    await sendMail({
      subject: `Finanzierungsanfrage: ${name}`,
      text: buildEmailText({ name, phone, email, anliegen, message, calc }),
      replyTo: email || undefined,
    });
  } catch (mailErr) {
    console.error("api/lead: E-Mail konnte nicht gesendet werden:", mailErr);
    res.status(502).json({ error: "Anfrage konnte nicht per E-Mail übermittelt werden. Bitte telefonisch oder erneut versuchen." });
    return;
  }

  // onOffice-Uebertragung (Adresse + Aufgabe) ist Komfort fuer die CRM-Pflege, aber nicht
  // mehr die Bedingung fuer eine erfolgreiche Anfrage -- die Mail ist bereits raus. Ein
  // Fehler hier wird daher nur geloggt, nicht an den Nutzer als Fehlschlag gemeldet.
  let addressId = null;
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
    addressId = addressRecords[0] && addressRecords[0].id;

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
  } catch (onofficeErr) {
    console.error("api/lead: onOffice-Übertragung fehlgeschlagen:", onofficeErr);
  }

  res.status(200).json({ ok: true, addressId });
};
