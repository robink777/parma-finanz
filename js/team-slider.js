(function () {
  "use strict";

  // Eigenes, kleines Script statt js/slider.js mitzunutzen: js/slider.js bindet ueber
  // document.querySelector(".slider-prev"/".slider-next") nur den JEWEILS ERSTEN Treffer im
  // gesamten Dokument -- mit zwei Slidern auf der Seite (Top-Angebote + Team) wuerden die
  // Team-Buttons sonst nichts tun. Deshalb hier gescoped auf #team-slider.
  var track = document.getElementById("team-slider-track");
  if (!track) return;

  var container = document.getElementById("team-slider");
  var prevBtn = container.querySelector(".slider-prev");
  var nextBtn = container.querySelector(".slider-next");

  function scrollByCard(direction) {
    var card = track.querySelector(".team-card");
    var amount = card ? card.getBoundingClientRect().width + 24 : 240;
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
