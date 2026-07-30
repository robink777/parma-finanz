(function () {
  "use strict";

  var form = document.getElementById("contact-form");
  if (!form) return;

  var status = document.getElementById("form-status");
  var contactOffer = document.getElementById("contact-offer");
  var submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var vorname = document.getElementById("c-vorname").value.trim();
    var name = document.getElementById("c-name").value.trim();
    var phone = document.getElementById("c-phone").value.trim();
    var email = document.getElementById("c-email").value.trim();
    var anliegen = document.getElementById("c-anliegen").value;
    var consent = document.getElementById("c-consent").checked;

    status.dataset.state = "";
    status.textContent = "";

    if (!vorname || !name || (!phone && !email)) {
      status.dataset.state = "error";
      status.textContent = "Bitte Vorname, Name sowie Telefon oder E-Mail angeben.";
      return;
    }
    if (!consent) {
      status.dataset.state = "error";
      status.textContent = "Bitte der Datenverarbeitung zustimmen.";
      return;
    }

    var calc = null;
    if (contactOffer && contactOffer.dataset.payload) {
      try {
        calc = JSON.parse(contactOffer.dataset.payload);
      } catch (err) {
        calc = null;
      }
    }

    var payload = {
      vorname: vorname,
      name: name,
      phone: phone,
      email: email,
      anliegen: anliegen,
      consent: consent,
      calc: calc,
    };

    submitBtn.disabled = true;
    status.textContent = "Anfrage wird gesendet …";

    fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Unbekannter Fehler");
          return data;
        });
      })
      .then(function () {
        status.dataset.state = "success";
        status.textContent = "Danke! Wir melden uns innerhalb von 24 Stunden bei Ihnen.";
        form.reset();
      })
      .catch(function (err) {
        status.dataset.state = "error";
        status.textContent =
          "Anfrage konnte nicht gesendet werden (" + err.message + "). Bitte telefonisch oder erneut versuchen.";
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });
})();
