(function () {
  "use strict";

  // Kaufnebenkosten NRW (Briefing Abschnitt 4a.1). Die Maklercourtage ist ueber das Feld
  // #courtage vom Nutzer einstellbar (Default 3,57 %), Grunderwerbsteuer und Notar-/
  // Grundbuchgebuehren bleiben feste Erfahrungswerte.
  var GRUNDERWERBSTEUER = 0.065;
  var NOTAR_GRUNDBUCH = 0.0175; // Mittelwert 1,5–2,0 %

  // Immer 2 Nachkommastellen (100.000,00 €) statt gerundeter Ganzzahlen, und ohne das
  // von Intl.NumberFormat standardmaessig eingefuegte (geschuetzte) Leerzeichen vor dem
  // Euro-Zeichen -- auf Kundenwunsch, Beispiel: "100.000,00€".
  var euroFormatterIntl = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  var euroFormatter = {
    format: function (value) {
      return euroFormatterIntl.format(value).replace(/[\s\u00a0\u202f]/g, "");
    },
  };

  // Kaufpreis/Eigenkapital sind Text- statt Zahlenfelder, damit der Nutzer beim Tippen
  // sofort die deutsche Tausenderpunkt-Schreibweise sieht (100.000 statt 100000) --
  // ein natives <input type="number"> erlaubt keine solche Formatierung im Feld selbst.
  function parseNumericInput(value) {
    var digits = String(value || "").replace(/[^0-9]/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }

  function formatNumberInputValue(input) {
    var raw = parseNumericInput(input.value);
    input.value = raw ? raw.toLocaleString("de-DE") : "";
    // Cursor nach dem Reformatieren ans Ende setzen -- sonst springt er in manchen
    // Browsern an den Anfang, wenn sich durch neue Tausenderpunkte die Laenge aendert.
    if (document.activeElement === input) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  var form = document.getElementById("calculator-form");
  if (!form) return;

  var kaufpreisInput = document.getElementById("kaufpreis");
  var eigenkapitalInput = document.getElementById("eigenkapital");
  var courtageField = document.getElementById("courtage-field");
  var courtageEnabled = document.getElementById("courtage-enabled");
  var courtageInput = document.getElementById("courtage");
  var courtageHint = document.getElementById("courtage-hint");
  var tilgungInput = document.getElementById("tilgung");
  var tilgungValue = document.getElementById("tilgung-value");
  var zinsbindungGroup = document.getElementById("zinsbindung-group");

  var resultRate = document.getElementById("result-rate");
  var resultRateSub = document.getElementById("result-rate-sub");
  var resultKaufpreis = document.getElementById("result-kaufpreis");
  var resultNebenkosten = document.getElementById("result-nebenkosten");
  var resultNebenkostenPercent = document.getElementById("result-nebenkosten-percent");
  var resultGrunderwerbsteuer = document.getElementById("result-grunderwerbsteuer");
  var resultNotar = document.getElementById("result-notar");
  var resultCourtage = document.getElementById("result-courtage");
  var resultCourtagePercent = document.getElementById("result-courtage-percent");
  var resultEigenkapital = document.getElementById("result-eigenkapital");
  var resultEigenkapitalPercent = document.getElementById("result-eigenkapital-percent");
  var resultDarlehen = document.getElementById("result-darlehen");
  var resultRestschuld = document.getElementById("result-restschuld");
  var resultLaufzeit = document.getElementById("result-laufzeit");
  var splitZinsenBar = document.getElementById("split-zinsen-bar");
  var splitTilgungBar = document.getElementById("split-tilgung-bar");
  var splitZinsenValue = document.getElementById("split-zinsen-value");
  var splitTilgungValue = document.getElementById("split-tilgung-value");
  var ctaAngebot = document.getElementById("cta-angebot");

  var offerLabel = document.getElementById("contact-offer-label");
  var offerImageWrap = document.getElementById("contact-offer-image-wrap");
  var offerImage = document.getElementById("contact-offer-image");
  var offerTitle = document.getElementById("contact-offer-title");
  var offerLocation = document.getElementById("contact-offer-location");
  var offerKaufpreis = document.getElementById("offer-kaufpreis");
  var offerEigenkapital = document.getElementById("offer-eigenkapital");
  var offerZinsbindung = document.getElementById("offer-zinsbindung");
  var offerTilgung = document.getElementById("offer-tilgung");
  var offerRate = document.getElementById("offer-rate");
  var contactOffer = document.getElementById("contact-offer");

  // Wird beim Auswaehlen eines Objekts gesetzt (siehe Objektauswahl weiter unten) und bei
  // manueller Kaufpreis-Aenderung wieder geloescht -- damit die Angebots-Karte kein veraltetes
  // Objektfoto zeigt, wenn der Kaufpreis nicht mehr zu dem ausgewaehlten Objekt passt.
  var selectedEstate = null;
  var settingKaufpreisFromEstate = false;

  var tabManual = document.getElementById("tab-manual");
  var tabEstate = document.getElementById("tab-estate");
  var panelEstate = document.getElementById("panel-estate");

  var selectedEstatePreview = document.getElementById("selected-estate-preview");
  var selectedEstateImage = document.getElementById("selected-estate-image");
  var selectedEstateTitle = document.getElementById("selected-estate-title");
  var selectedEstateCity = document.getElementById("selected-estate-city");

  function updateSelectedEstatePreview() {
    if (!selectedEstatePreview) return;
    if (!selectedEstate) {
      selectedEstatePreview.hidden = true;
      return;
    }
    selectedEstateTitle.textContent = selectedEstate.title || "";
    if (selectedEstate.city) {
      selectedEstateCity.hidden = false;
      selectedEstateCity.textContent = selectedEstate.city;
    } else {
      selectedEstateCity.hidden = true;
    }
    if (selectedEstate.image) {
      selectedEstateImage.src = selectedEstate.image;
      selectedEstateImage.alt = selectedEstate.title || "";
      selectedEstateImage.hidden = false;
    } else {
      selectedEstateImage.hidden = true;
    }
    selectedEstatePreview.hidden = false;
  }

  // Bei Objekten von Parma Immobilien ist die tatsaechliche Courtage im onOffice-Feld
  // "Aussenprovision" (prozent_aussenprovision) hinterlegt und weicht je nach Objekt vom
  // Standardwert ab (z. B. reduzierte Courtage bei Neubauprojekten). Ist ein Objekt
  // ausgewaehlt, wird dieser reale Wert automatisch uebernommen und das Feld gesperrt,
  // damit keine falsche manuelle Angabe die Berechnung verfaelscht.
  function lockCourtage(percent) {
    courtageEnabled.checked = true;
    courtageEnabled.disabled = true;
    courtageInput.value = percent;
    courtageInput.disabled = true;
    courtageHint.hidden = false;
    courtageField.classList.add("is-locked");
  }

  function unlockCourtage() {
    if (!courtageEnabled.disabled) return;
    courtageEnabled.disabled = false;
    courtageInput.disabled = !courtageEnabled.checked;
    courtageHint.hidden = true;
    courtageField.classList.remove("is-locked");
  }

  // Die beiden Ergebnis-Karten (Kaufpreisuebersicht / Monatliche Rate) stehen in einer
  // Flex-Spalte uebereinander und sollen trotz unterschiedlich langem Inhalt gleich gross
  // wirken -- reines CSS greift hier nicht, weil kein gemeinsamer Grid-Container mit freier
  // Hoehe existiert. Deshalb Hoehe per JS angleichen: erst zuruecksetzen (sonst waechst die
  // min-height bei jedem Aufruf weiter), dann beide messen und auf das Maximum setzen.
  var stepCards = document.querySelectorAll(".calc-step-card");

  function syncStepCardHeights() {
    if (!stepCards.length) return;
    stepCards.forEach(function (card) {
      card.style.minHeight = "";
    });
    var max = 0;
    stepCards.forEach(function (card) {
      max = Math.max(max, card.getBoundingClientRect().height);
    });
    stepCards.forEach(function (card) {
      card.style.minHeight = max + "px";
    });
  }

  window.addEventListener("resize", syncStepCardHeights);
  window.addEventListener("load", syncStepCardHeights);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncStepCardHeights);
  }

  function activeZinssatz() {
    var checked = zinsbindungGroup.querySelector("input:checked");
    return checked ? parseFloat(checked.dataset.zins) : 3.7;
  }

  function activeZinsbindung() {
    var checked = zinsbindungGroup.querySelector("input:checked");
    return checked ? parseInt(checked.value, 10) : 10;
  }

  function updateZinsbindungStyles() {
    var options = zinsbindungGroup.querySelectorAll(".zinsbindung-option");
    options.forEach(function (option) {
      var input = option.querySelector("input");
      option.classList.toggle("active", input.checked);
    });
  }

  function restschuldNachZinsbindung(darlehen, zinsProzent, tilgungProzent, jahre) {
    var im = zinsProzent / 100 / 12;
    var monatsrate = (darlehen * (zinsProzent + tilgungProzent)) / 100 / 12;
    var n = jahre * 12;
    if (im === 0) {
      return Math.max(0, darlehen - monatsrate * n);
    }
    var restschuld =
      darlehen * Math.pow(1 + im, n) - monatsrate * ((Math.pow(1 + im, n) - 1) / im);
    return Math.max(0, restschuld);
  }

  function gesamtlaufzeitMonate(darlehen, zinsProzent, tilgungProzent) {
    var im = zinsProzent / 100 / 12;
    var monatsrate = (darlehen * (zinsProzent + tilgungProzent)) / 100 / 12;
    if (monatsrate <= darlehen * im) {
      return Infinity; // Rate tilgt nicht einmal die Zinsen
    }
    if (im === 0) {
      return darlehen / monatsrate;
    }
    return -Math.log(1 - (im * darlehen) / monatsrate) / Math.log(1 + im);
  }

  function formatJahreMonate(monate) {
    if (!isFinite(monate)) return "–";
    var jahre = Math.floor(monate / 12);
    var restMonate = Math.round(monate % 12);
    if (restMonate === 12) {
      jahre += 1;
      restMonate = 0;
    }
    return restMonate > 0 ? jahre + " Jahre, " + restMonate + " Monate" : jahre + " Jahre";
  }

  function recalculate() {
    var kaufpreis = parseNumericInput(kaufpreisInput.value);
    var eigenkapital = parseNumericInput(eigenkapitalInput.value);
    var courtageSatz = courtageEnabled.checked ? (parseFloat(courtageInput.value) || 0) / 100 : 0;
    var tilgung = parseFloat(tilgungInput.value) || 2;
    var zins = activeZinssatz();
    var zinsbindung = activeZinsbindung();

    var grunderwerbsteuer = kaufpreis * GRUNDERWERBSTEUER;
    var notarGrundbuch = kaufpreis * NOTAR_GRUNDBUCH;
    var courtage = kaufpreis * courtageSatz;
    var nebenkostenSatz = GRUNDERWERBSTEUER + NOTAR_GRUNDBUCH + courtageSatz;
    var nebenkosten = grunderwerbsteuer + notarGrundbuch + courtage;
    var finanzierungsbedarf = kaufpreis + nebenkosten;
    var darlehen = Math.max(0, finanzierungsbedarf - eigenkapital);
    var monatsrate = (darlehen * (zins + tilgung)) / 100 / 12;
    var restschuld = restschuldNachZinsbindung(darlehen, zins, tilgung, zinsbindung);
    var laufzeitMonate = gesamtlaufzeitMonate(darlehen, zins, tilgung);

    var zinsanteil = (darlehen * zins) / 100 / 12;
    var tilgungsanteil = Math.max(0, monatsrate - zinsanteil);
    var zinsanteilProzent = monatsrate > 0 ? (zinsanteil / monatsrate) * 100 : 0;
    var tilgungsanteilProzent = monatsrate > 0 ? 100 - zinsanteilProzent : 0;

    resultRate.innerHTML = euroFormatter.format(monatsrate) + " <span>pro Monat</span>";
    resultRateSub.textContent =
      "bei " +
      zins.toFixed(1).replace(".", ",") +
      " % Zinssatz (" +
      zinsbindung +
      " Jahre Zinsbindung) und " +
      tilgung.toFixed(1).replace(".", ",") +
      " % anfänglicher Tilgung";

    resultKaufpreis.textContent = euroFormatter.format(kaufpreis);
    resultNebenkosten.textContent = "+" + euroFormatter.format(nebenkosten);
    resultNebenkostenPercent.textContent = "(" + (nebenkostenSatz * 100).toFixed(2).replace(".", ",") + " %)";
    resultGrunderwerbsteuer.textContent = "+" + euroFormatter.format(grunderwerbsteuer);
    resultNotar.textContent = "+" + euroFormatter.format(notarGrundbuch);
    resultCourtage.textContent = "+" + euroFormatter.format(courtage);
    resultCourtagePercent.textContent = "(" + (courtageSatz * 100).toFixed(2).replace(".", ",") + " %)";
    resultEigenkapital.textContent = "–" + euroFormatter.format(eigenkapital);
    resultEigenkapitalPercent.textContent =
      "(" + (kaufpreis > 0 ? ((eigenkapital / kaufpreis) * 100).toFixed(0) : "0") + " %)";
    resultDarlehen.textContent = euroFormatter.format(darlehen);
    resultRestschuld.textContent = euroFormatter.format(restschuld);
    resultLaufzeit.textContent = formatJahreMonate(laufzeitMonate);

    splitZinsenBar.style.width = zinsanteilProzent + "%";
    splitTilgungBar.style.width = tilgungsanteilProzent + "%";
    splitZinsenValue.textContent = euroFormatter.format(zinsanteil) + " (" + zinsanteilProzent.toFixed(0) + " %)";
    splitTilgungValue.textContent =
      euroFormatter.format(tilgungsanteil) + " (" + tilgungsanteilProzent.toFixed(0) + " %)";

    if (offerLabel) {
      if (selectedEstate) {
        offerLabel.textContent = "Ihr ausgewähltes Objekt";
        offerTitle.hidden = false;
        offerTitle.textContent = selectedEstate.title || "";
        if (selectedEstate.city) {
          offerLocation.hidden = false;
          offerLocation.textContent = selectedEstate.city;
        } else {
          offerLocation.hidden = true;
        }
        if (selectedEstate.image) {
          offerImage.src = selectedEstate.image;
          offerImage.alt = selectedEstate.title || "";
          offerImageWrap.hidden = false;
        } else {
          offerImageWrap.hidden = true;
        }
      } else {
        offerLabel.textContent = "Ihre Finanzierungsanfrage";
        offerTitle.hidden = true;
        offerLocation.hidden = true;
        offerImageWrap.hidden = true;
      }

      offerKaufpreis.textContent = euroFormatter.format(kaufpreis);
      offerEigenkapital.textContent = euroFormatter.format(eigenkapital);
      offerZinsbindung.textContent = zinsbindung + " Jahre (" + zins.toFixed(1).replace(".", ",") + " %)";
      offerTilgung.textContent = tilgung.toFixed(1).replace(".", ",") + " %";
      offerRate.textContent = euroFormatter.format(monatsrate) + " / Monat";

      contactOffer.dataset.payload = JSON.stringify({
        kaufpreis: kaufpreis,
        eigenkapital: eigenkapital,
        zinsbindungJahre: zinsbindung,
        zinssatz: zins,
        tilgungssatz: tilgung,
        monatlicheRate: Math.round(monatsrate),
        estateId: selectedEstate ? selectedEstate.id : null,
        estateTitle: selectedEstate ? selectedEstate.title : null,
      });
    }

    updateSelectedEstatePreview();
    syncStepCardHeights();
  }

  form.addEventListener("input", recalculate);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
  });

  // Tippt der Nutzer den Kaufpreis nach einer Objektauswahl von Hand um, passt der Preis
  // nicht mehr zwingend zum gezeigten Objektfoto -- Auswahl dann zuruecksetzen.
  kaufpreisInput.addEventListener("input", function () {
    if (!settingKaufpreisFromEstate && selectedEstate) {
      selectedEstate = null;
      form.dataset.selectedEstateId = "";
      unlockCourtage();
    }
    formatNumberInputValue(kaufpreisInput);
  });

  eigenkapitalInput.addEventListener("input", function () {
    formatNumberInputValue(eigenkapitalInput);
  });

  tilgungInput.addEventListener("input", function () {
    tilgungValue.textContent = parseFloat(tilgungInput.value).toFixed(1).replace(".", ",") + " %";
  });

  courtageEnabled.addEventListener("change", function () {
    courtageInput.disabled = !courtageEnabled.checked;
    recalculate();
  });

  zinsbindungGroup.addEventListener("change", updateZinsbindungStyles);

  if (ctaAngebot) {
    ctaAngebot.addEventListener("click", function () {
      recalculate();
    });
  }

  // ---------- Tabs: Freie Eingabe / Objekt auswählen ----------

  function activateTab(tab) {
    var isEstate = tab === "estate";
    tabManual.setAttribute("aria-selected", String(!isEstate));
    tabEstate.setAttribute("aria-selected", String(isEstate));
    panelEstate.hidden = !isEstate;
    if (isEstate) loadEstates();
  }

  tabManual.addEventListener("click", function () {
    activateTab("manual");
  });
  tabEstate.addEventListener("click", function () {
    activateTab("estate");
  });

  // ---------- Objektauswahl über onOffice ----------

  var estateSearch = document.getElementById("estate-search");
  var estateResults = document.getElementById("estate-results");
  var estateStatus = document.getElementById("estate-status");
  var estatesCache = null;

  function loadEstates() {
    if (estatesCache) return;
    estateStatus.textContent = "Objekte werden geladen …";
    fetch("/api/estates")
      .then(function (res) {
        if (!res.ok) throw new Error("Antwort " + res.status);
        return res.json();
      })
      .then(function (data) {
        estatesCache = data.estates || [];
        estateStatus.textContent = estatesCache.length
          ? estatesCache.length + " Immobilien verfügbar."
          : "Aktuell sind keine Immobilien für die Objektauswahl freigegeben.";
      })
      .catch(function () {
        estatesCache = [];
        estateStatus.textContent =
          "Objekte konnten nicht geladen werden. Bitte Kaufpreis manuell eingeben.";
      });
  }

  function renderEstateResults(list, heading) {
    estateResults.innerHTML = "";
    if (!list.length) {
      estateResults.hidden = true;
      return;
    }
    if (heading) {
      var headingEl = document.createElement("div");
      headingEl.className = "estate-results-heading";
      headingEl.textContent = heading;
      estateResults.appendChild(headingEl);
    }
    list.slice(0, 8).forEach(function (estate) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "estate-result";

      var metaParts = [
        [estate.street, [estate.zip, estate.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        estate.immoNr ? "ImmoNr " + estate.immoNr : null,
      ].filter(Boolean);

      btn.innerHTML =
        (estate.image
          ? "<img class=\"estate-result-thumb\" src=\"" + escapeHtml(estate.image) + "\" alt=\"\" />"
          : "<span class=\"estate-result-thumb estate-result-thumb-empty\" aria-hidden=\"true\"></span>") +
        "<span class=\"estate-result-text\">" +
        "<span class=\"estate-result-title\">" +
        escapeHtml(estate.title) +
        "</span>" +
        (metaParts.length
          ? "<span class=\"estate-result-meta\">" + escapeHtml(metaParts.join(" · ")) + "</span>"
          : "") +
        "</span><span class=\"price\">" +
        (estate.price ? euroFormatter.format(estate.price) : "–") +
        "</span>";
      btn.addEventListener("click", function () {
        settingKaufpreisFromEstate = true;
        kaufpreisInput.value = estate.price || kaufpreisInput.value;
        formatNumberInputValue(kaufpreisInput);
        settingKaufpreisFromEstate = false;
        estateSearch.value = estate.title;
        estateResults.hidden = true;
        selectedEstate = estate;
        form.dataset.selectedEstateId = estate.id;
        if (estate.provisionPercent != null) {
          lockCourtage(estate.provisionPercent);
        } else {
          unlockCourtage();
        }
        recalculate();
      });
      estateResults.appendChild(btn);
    });
    estateResults.hidden = false;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function renderNewestEstates() {
    var newest = estatesCache
      .slice()
      .filter(function (estate) {
        return !!estate.createdAt;
      })
      .sort(function (a, b) {
        return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
      })
      .slice(0, 5);
    renderEstateResults(newest, "Neu in der Vermarktung");
  }

  estateSearch.addEventListener("input", function () {
    if (!estatesCache) return;
    var query = estateSearch.value.trim().toLowerCase();
    if (!query) {
      renderNewestEstates();
      return;
    }
    var filtered = estatesCache.filter(function (estate) {
      return (
        (estate.title || "").toLowerCase().indexOf(query) !== -1 ||
        (estate.city || "").toLowerCase().indexOf(query) !== -1 ||
        (estate.zip || "").toLowerCase().indexOf(query) !== -1 ||
        (estate.street || "").toLowerCase().indexOf(query) !== -1 ||
        (estate.immoNr || "").toLowerCase().indexOf(query) !== -1
      );
    });
    renderEstateResults(filtered);
  });

  estateSearch.addEventListener("focus", function () {
    if (!estatesCache) return;
    if (estateSearch.value.trim()) {
      estateSearch.dispatchEvent(new Event("input"));
    } else {
      renderNewestEstates();
    }
  });

  document.addEventListener("click", function (e) {
    if (!estateResults.contains(e.target) && e.target !== estateSearch) {
      estateResults.hidden = true;
    }
  });

  formatNumberInputValue(kaufpreisInput);
  formatNumberInputValue(eigenkapitalInput);
  updateZinsbindungStyles();
  recalculate();
})();
