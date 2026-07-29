# Parma Finanz – Landingpage

One-Page-Landingpage für Parma Finanz (parmafinanz.de) mit Finanzierungsrechner und
onOffice-Anbindung (Objektauswahl + Lead-Übertragung). Reines HTML/CSS/JS, keine Build-Tools
nötig; die onOffice-Anbindung läuft über zwei Vercel-Serverless-Functions (`/api/estates`,
`/api/lead`), damit API-Token/-Secret nie im Frontend landen.

## Projektstruktur

```
index.html            One-Pager (Hero, Rechner, Vorteile, Standorte, Kontakt, FAQ)
impressum.html         Platzhalter, vor Livegang von Robin auszufüllen
datenschutz.html        Platzhalter, vor Livegang von Robin auszufüllen
css/style.css          CI-konformes Stylesheet (Parma-Design-Skill)
js/calculator.js       Rechner-Logik + Objektauswahl (ruft /api/estates)
js/form.js              Kontaktformular (ruft /api/lead)
api/estates.js          Vercel Function: liest freigegebene Immobilien aus onOffice
api/lead.js             Vercel Function: legt Adresse + Aufgabe in onOffice an
lib/onoffice.js         HMAC-v2-Signierung + onOffice-API-Client
assets/logos/           Original-Logo-Dateien (Parma Finanz + Parma Immobilien)
```

## Lokal starten

Voraussetzung: [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`), damit die
`/api`-Functions lokal mitlaufen (ein reiner statischer Server reicht nicht, da dort kein
Node-Backend für die onOffice-Calls läuft).

```bash
vercel dev
```

Ohne Vercel CLI könnt ihr `index.html` trotzdem direkt öffnen/über einen simplen statischen
Server ausliefern – Layout und Rechner-Mathematik funktionieren dann, die Objektauswahl und der
Formularversand melden aber einen Fehler, weil `/api/*` fehlt.

## onOffice-Anbindung einrichten

1. In onOffice: **Extras → Einstellungen → Benutzer** einen neuen, dedizierten API-Benutzer für
   dieses Web-Projekt anlegen (separat vom bestehenden MCP-Zugang) und Token + Secret erzeugen.
2. Diesem API-Benutzer **nur** Zugriff auf die für die Webseite freigegebenen Immobilien sowie
   Schreibzugriff auf Adressen/Aufgaben geben (siehe Briefing Abschnitt 4a.3).
3. `.env.example` nach `.env` kopieren und Werte eintragen:
   ```
   ONOFFICE_API_TOKEN=…
   ONOFFICE_API_SECRET=…
   ```
4. **Filter für die Objektauswahl** (`api/estates.js`, live geprüft Juli 2026): `status = 1`
   (Status 1 = Active, siehe `ONOFFICE_ESTATE_FILTER_FIELD` / `ONOFFICE_ESTATE_FILTER_VALUE` in
   `.env`) UND `vermarktungsart = kauf` UND `veroeffentlichen = 1`. Der dritte Teil
   (`veroeffentlichen`, das "Eigene Internetseite" → "Veröffentlichen: ja/nein"-Feld im
   onOffice-Backend) ist entscheidend – ohne ihn tauchten live 31 von 98 Objekten auf, die zwar
   CRM-seitig aktiv, aber nicht für die eigene Website freigegeben waren. `status2` ist **kein**
   verlässliches Online/Offline-Kriterium (CRM-Workflow-Feld, u.a. auch bei veröffentlichten
   Objekten leer oder "reserviert").
5. Optional: `ONOFFICE_TASK_ASSIGNEE_LOGIN` setzen (loginName aus onOffice, z. B. `Robin`), damit
   neue Leads automatisch als Aufgabe einem Berater zugewiesen werden. Leer lassen für
   Standard-Zuweisung.

Die Signierung (HMAC-Version 2) und das Request-/Response-Format in `lib/onoffice.js` sind gegen
die offizielle Doku unter apidoc.onoffice.de verifiziert, aber **noch nicht gegen einen echten
Request mit euren neuen Zugangsdaten getestet** – bitte nach dem Deployment einmal `/api/estates`
aufrufen und die Rückgabe prüfen.

## Deployment (Vercel + Strato-Domain)

1. Projekt zu GitHub pushen (oder direkt via `vercel` CLI deployen).
2. In Vercel: Projekt importieren, Environment Variables aus `.env` im Vercel-Dashboard eintragen
   (**nicht** die `.env`-Datei committen – sie ist in `.gitignore`).
3. Domain `parmafinanz.de` bleibt bei Strato registriert. Bei Strato nur die DNS-Einträge auf
   Vercel umbiegen (Vercel zeigt nach dem Hinzufügen der Domain im Projekt die nötigen A-/CNAME-
   Records an).
4. SSL wird von Vercel automatisch bereitgestellt.

## Offene Punkte vor Livegang (aus Briefing Abschnitt 8)

- [ ] Exakte Rechtsform/Firmierung Parma Finanz → `impressum.html` ausfüllen
- [ ] IHK-Registrierungsnummer (§ 34i, ggf. § 34k) → `impressum.html`
- [ ] Telefonnummer/E-Mail für Impressum & Datenschutzerklärung ergänzen
- [ ] onOffice-API-Filter für "im Rechner auswählbare Objekte" bestätigen (siehe oben, Punkt 4)
- [ ] Sicherstellen, dass die gewünschten Immobilien in onOffice entsprechend markiert sind
- [ ] Social-Proof-Sektion: Platzhalter durch echte Google-/ProvenExpert-Bewertungen ersetzen
      (oder Sektion entfernen, falls noch keine vorhanden sind)
- [ ] Entscheidung zu Analytics (z. B. Plausible) → Datenschutzerklärung entsprechend ergänzen
- [ ] `.env` mit den produktiven Zugangsdaten ausschließlich in Vercel als Environment Variable
      hinterlegen, niemals ins Repo committen
