(function () {
  "use strict";

  var track = document.getElementById("top-slider-track");
  var status = document.getElementById("top-slider-status");
  if (!track) return;

  // Muss mit den Default-Werten im Finanzierungsrechner (js/calculator.js) uebereinstimmen,
  // damit "durchschnittliche Rate" auf der ganzen Seite dieselbe Bedeutung hat: 10 Jahre
  // Zinsbindung (3,7 %) + 2 % anfaengliche Tilgung, Nebenkosten NRW (Briefing 4a.1).
  var ZINSSATZ = 3.7;
  var TILGUNG = 2;
  var NEBENKOSTEN_SATZ = 0.065 + 0.0175 + 0.0357;

  var euroFormatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  function monatlicheRate(kaufpreis) {
    var darlehen = kaufpreis * (1 + NEBENKOSTEN_SATZ);
    return (darlehen * (ZINSSATZ + TILGUNG)) / 100 / 12;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function renderCard(estate) {
    var card = document.createElement("article");
    card.className = "top-card";

    var imageHtml = estate.image
      ? '<img class="top-card-image" src="' + escapeHtml(estate.image) + '" alt="" />'
      : '<div class="top-card-image top-card-image-empty" aria-hidden="true"></div>';

    var metaParts = [
      estate.price ? euroFormatter.format(estate.price) : null,
      estate.city || null,
      estate.objektart || null,
    ].filter(Boolean);

    card.innerHTML =
      imageHtml +
      '<div class="top-card-body">' +
      '<p class="top-card-rate">ab ' +
      euroFormatter.format(monatlicheRate(estate.price)) +
      " <span>/Monat*</span></p>" +
      '<p class="top-card-meta">' +
      escapeHtml(metaParts.join(" · ")) +
      "</p>" +
      '<h4 class="top-card-title">' +
      escapeHtml(estate.title) +
      "</h4>" +
      '<a class="btn btn-secondary btn-block" href="' +
      escapeHtml(estate.link) +
      '" target="_blank" rel="noopener">Zum Objekt bei Parma Immobilien</a>' +
      "</div>";

    return card;
  }

  fetch("/api/top-estates")
    .then(function (res) {
      if (!res.ok) throw new Error("Antwort " + res.status);
      return res.json();
    })
    .then(function (data) {
      var estates = (data.estates || []).filter(function (e) {
        return e.price;
      });
      track.innerHTML = "";
      if (!estates.length) {
        document.getElementById("top-angebote").hidden = true;
        return;
      }
      estates.forEach(function (estate) {
        track.appendChild(renderCard(estate));
      });
      var disclaimer = document.createElement("p");
      disclaimer.className = "small top-slider-disclaimer";
      disclaimer.textContent =
        "*Unverbindlicher Richtwert bei 10 Jahren Zinsbindung (3,7 %) und 2 % anfänglicher Tilgung, inkl. Kaufnebenkosten NRW.";
      track.parentElement.parentElement.appendChild(disclaimer);
    })
    .catch(function () {
      document.getElementById("top-angebote").hidden = true;
    });

  var slider = document.querySelector(".slider");
  var prevBtn = document.querySelector(".slider-prev");
  var nextBtn = document.querySelector(".slider-next");

  function scrollByCard(direction) {
    var card = track.querySelector(".top-card");
    var amount = card ? card.getBoundingClientRect().width + 24 : 300;
    track.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  if (prevBtn && nextBtn) {
    prevBtn.addEventListener("click", function () {
      scrollByCard(-1);
    });
    nextBtn.addEventListener("click", function () {
      scrollByCard(1);
    });
  }
})();
