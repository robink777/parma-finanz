const nodemailer = require("nodemailer");

let cachedTransporter = null;

// Versand ueber ein bestehendes Strato-Postfach (SMTP_USER/SMTP_PASS), damit keine
// zusaetzliche Anmeldung bei einem E-Mail-Dienst noetig ist -- die Mails von Parma Finanz
// liegen ohnehin bei Strato. Konfiguration ausschliesslich ueber Vercel-Umgebungsvariablen,
// niemals im Code oder Repo.
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP_USER/SMTP_PASS sind nicht konfiguriert.");
  }

  const host = process.env.SMTP_HOST || "smtp.strato.de";
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return cachedTransporter;
}

async function sendMail({ subject, text, replyTo }) {
  const transporter = getTransporter();
  // MAIL_FROM optional ueberschreibbar, faellt aber auf den authentifizierten Absender zurueck --
  // Strato (wie die meisten SMTP-Provider) verlangt in der Regel, dass "From" zum eingeloggten
  // Postfach passt, sonst landet die Mail im Spam oder wird abgelehnt.
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const to = process.env.MAIL_TO || "info@parmafinanz.de";

  await transporter.sendMail({
    from,
    to,
    replyTo: replyTo || undefined,
    subject,
    text,
  });
}

module.exports = { sendMail };
