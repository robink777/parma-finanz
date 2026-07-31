const { buildAction, callOnOffice, getRecords } = require("../lib/onoffice");
const { sendMail } = require("../lib/mailer");

const ACTION_CREATE = "urn:onoffice-de-ns:smart:2.5:smartml:action:create";
const ACTION_READ = "urn:onoffice-de-ns:smart:2.5:smartml:action:read";
const ACTION_MODIFY = "urn:onoffice-de-ns:smart:2.5:smartml:action:modify";

// Interner onOffice-Schluessel des Kontaktart-Werts "Interessent Parma Finanz" (Feld
// ArtDaten, im onOffice-Backend angelegt: indMulti3498Select6688). Ohne gesetzten Wert
// wuerde die Kontaktart einfach nicht gesetzt.
const KONTAKTART_INTERESSENT_FINANZ = process.env.ONOFFICE_KONTAKTART_FINANZ_KEY;

const ANLIEGEN_LABELS = {
  neukauf: "Neukauf",
  anschlussfinanzierung: "Anschlussfinanzierung",
  modernisierung: "Modernisierung",
};

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

// onOffice bietet das "Deals"-Modul (Pipeline/Vertriebsprozess) aktuell noch nicht ueber die
// API an (live geprueft, Juli 2026) -- ein Deal kann also nicht automatisch angelegt werden.
// Die Verknuepfung der Mail mit der Adresse laeuft ueber das onOffice-Outlook-Add-in
// ("Zuordnen/Anlegen" direkt in der E-Mail), ebenfalls ein manueller Schritt. Diese Zeilen
// sind deshalb die Handlungsanweisung fuer den Vertriebler, beides manuell nachzuholen (der
// Kontakt/die Adresse wird weiterhin automatisch in onOffice angelegt, siehe unten -- nur die
// Mail-Verknuepfung und der Deal selbst nicht).
function buildHandlungsanweisung() {
  return [
    "Sie haben eine Finanzierungsanfrage erhalten.",
    "Bitte ordnen Sie diese E-Mail der Adresse zu -> Zuordnen/Anlegen",
    "Bitte erstellen Sie einen neuen Deal -> Deal anlegen -> Finanzierungen",
  ].join("\n");
}

// Der E-Mail-Text enthaelt (anders als der onOffice-Datensatz) auch die Kontaktdaten direkt --
// wer die Mail liest, hat sonst keinen unmittelbaren CRM-Zugriff und soll trotzdem sofort
// zurueckrufen/-schreiben koennen.
function buildEmailText({ name, phone, email, anliegen, message, calc }) {
  const lines = [];
  lines.push(buildHandlungsanweisung());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`Name: ${name}`);
  if (phone) lines.push(`Telefon: ${phone}`);
  if (email) lines.push(`E-Mail: ${email}`);
  lines.push(`Anliegen: ${ANLIEGEN_LABELS[anliegen] || anliegen || "unbekannt"}`);
  if (message) lines.push(`Nachricht: ${message}`);
  lines.push(...buildCalcLines(calc));
  return lines.join("\n");
}

// Mindeststandard fuer die Dublettenpruefung (auf Kundenwunsch): Telefonnummer + Name +
// Vorname exakt uebereinstimmend, statt sich (wie onOffice es per checkDuplicate-Flag
// standardmaessig macht) nur auf die E-Mail zu verlassen -- damit auch bereits bekannte
// Adressen ohne hinterlegte E-Mail wiedergefunden werden. Ist keine Telefonnummer angegeben
// (Formular erlaubt Telefon ODER E-Mail), wird ersatzweise nach der E-Mail gesucht.
async function findDuplicateAddress({ phone, vorname, nachname, email }) {
  const filter = {};
  if (phone) {
    filter.Telefon1 = [{ op: "=", val: phone }];
    filter.Name = [{ op: "=", val: nachname }];
    filter.Vorname = [{ op: "=", val: vorname }];
  } else if (email) {
    filter.Email = [{ op: "=", val: email }];
  } else {
    return null;
  }

  const action = buildAction({
    actionid: ACTION_READ,
    resourcetype: "address",
    parameters: {
      // "Id" ist beim Adressmodul KEIN gueltiges Datenfeld (im Unterschied zum Estate-Modul) --
      // die Record-ID kommt bei getRecords() ohnehin immer automatisch ueber record.id mit,
      // unabhaengig davon, was hier angefordert wird. Live gegen die API verifiziert: mit "Id"
      // im data-Array schlaegt die Anfrage mit "Unknown field" fehl.
      data: ["ArtDaten"],
      filter,
      listlimit: 1,
    },
  });
  const results = await callOnOffice([action]);
  const records = getRecords(results[0]);
  return records[0] || null;
}

// Multiselect-Felder liefert onOffice bei read() als pipe-getrennten String (z.B.
// "|Interessent Kauf|Käufer|"), nicht als Array -- live verifiziert ("Invalid multiselect
// key" beim Zurueckschreiben, weil sonst der gesamte String samt Pipe-Zeichen als ein
// einzelner, ungueltiger Schluessel behandelt wurde).
function parseArtDaten(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return value.split("|").map((s) => s.trim()).filter(Boolean);
  return value ? [value] : [];
}

// ArtDaten ist ein Mehrfachauswahlfeld -- beim Aktualisieren eines bestehenden Kontakts sollen
// vorhandene Kategorien (z.B. "Käufer Parma" aus dem Immobiliengeschäft) erhalten bleiben,
// "Interessent Parma Finanz" wird nur ergaenzt statt alles zu ueberschreiben.
function mergeArtDaten(existing, keyToAdd) {
  if (!keyToAdd) return null;
  const list = parseArtDaten(existing);
  if (!list.includes(keyToAdd)) list.push(keyToAdd);
  return list;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  // "vorname" und "name" (Nachname) kommen als getrennte Formularfelder -- wichtig fuer die
  // Dublettenpruefung (Telefon+Name+Vorname), die auf exaktem Feldabgleich beruht und mit einem
  // zusammengesetzten "Vor- und Nachname"-Feld unzuverlaessig waere (Mehrfachvornamen,
  // Nachnamen mit Leerzeichen etc. liessen sich nicht zuverlaessig auftrennen).
  const { vorname, name, phone, email, anliegen, message, calc, consent } = body;
  const fullName = [vorname, name].filter(Boolean).join(" ");

  if (!consent) {
    res.status(400).json({ error: "Einwilligung zur Datenverarbeitung fehlt." });
    return;
  }
  if (!vorname || !name || (!phone && !email)) {
    res.status(400).json({ error: "Vorname, Name und mindestens Telefon oder E-Mail werden benötigt." });
    return;
  }

  // Die E-Mail an info@parmafinanz.de ist die verbindliche Kernfunktion des Formulars --
  // schlaegt sie fehl, muss die Anfrage als fehlgeschlagen gelten, selbst wenn onOffice
  // (weiter unten) erreichbar waere. Deshalb zuerst und ohne Fallback versucht.
  try {
    await sendMail({
      subject: `Finanzierungsanfrage: ${fullName}`,
      text: buildEmailText({ name: fullName, phone, email, anliegen, message, calc }),
      replyTo: email || undefined,
    });
  } catch (mailErr) {
    console.error("api/lead: E-Mail konnte nicht gesendet werden:", mailErr);
    res.status(502).json({ error: "Anfrage konnte nicht per E-Mail übermittelt werden. Bitte telefonisch oder erneut versuchen." });
    return;
  }

  // onOffice-Uebertragung (nur noch Adresse, KEINE Aufgabe mehr -- der Deal wird laut
  // Handlungsanweisung in der Mail manuell angelegt) ist Komfort fuer die CRM-Pflege, aber
  // nicht mehr die Bedingung fuer eine erfolgreiche Anfrage -- die Mail ist bereits raus. Ein
  // Fehler hier wird daher nur geloggt, nicht an den Nutzer als Fehlschlag gemeldet.
  let addressId = null;
  try {
    const duplicate = await findDuplicateAddress({ phone, vorname, nachname: name, email });
    const artDaten = mergeArtDaten(duplicate ? duplicate.ArtDaten : null, KONTAKTART_INTERESSENT_FINANZ);

    if (duplicate) {
      // Bekannte Adresse gefunden (Telefon+Name+Vorname, oder ersatzweise E-Mail) --
      // aktualisieren statt einen neuen, doppelten Datensatz anzulegen. E-Mail/Telefon werden
      // hier bewusst NICHT mit aktualisiert: das sind bei onOffice Kommunikationsfelder mit
      // eigenem Add/Edit-Format (nicht einfach ueberschreibbar wie z.B. ArtDaten) -- live
      // verifiziert, dass ein einfacher Plain-Value-Modify dafuer fehlschlaegt bzw. bei
      // "action: add" jedes Mal einen zusaetzlichen Eintrag anlegt statt den bestehenden zu
      // ersetzen. ArtDaten ist dagegen ein normales Mehrfachauswahlfeld und per Modify direkt
      // setzbar.
      addressId = duplicate.id;

      if (artDaten) {
        await callOnOffice([
          buildAction({
            actionid: ACTION_MODIFY,
            resourcetype: "address",
            // Fuer "modify" erwartet onOffice die Record-ID als "resourceid" (NICHT
            // "identifier"), und -- wie bei "create" -- KEINEN "data"-Wrapper um die Felder
            // (beides live verifiziert; abweichende Formen scheitern mit "Unknown field"/
            // "Missing or invalid attribute: resourceid").
            resourceid: String(addressId),
            parameters: { ArtDaten: artDaten },
          }),
        ]);
      }
    } else {
      const addressAction = buildAction({
        actionid: ACTION_CREATE,
        resourcetype: "address",
        parameters: {
          Vorname: vorname,
          Name: name,
          email: email || undefined,
          phone: phone || undefined,
          default_phone: phone || undefined,
          ...(artDaten ? { ArtDaten: artDaten } : {}),
        },
      });

      const addressResults = await callOnOffice([addressAction]);
      const addressRecords = getRecords(addressResults[0]);
      addressId = addressRecords[0] && addressRecords[0].id;
    }
  } catch (onofficeErr) {
    console.error("api/lead: onOffice-Übertragung fehlgeschlagen:", onofficeErr);
  }

  res.status(200).json({ ok: true, addressId });
};
