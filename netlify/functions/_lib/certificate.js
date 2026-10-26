const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const A = require("./assets");
let QRCode = null;
try { QRCode = require("qrcode"); } catch (e) { /* QR is optional: the verification URL is printed either way */ }

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { ink: hex("#14122b"), purple: hex("#5b21b6"), deep: hex("#2a1263"), gold: hex("#b08d57"), muted: hex("#6b6a85") };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function prettyDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// A4 landscape (841.89 x 595.28 pt). All content sits inside a 31pt margin, so it prints without cropping.
// Uses the PDF standard fonts (no font files to ship). Names are limited to English letters at checkout.
async function renderCertificate({ name, course, issuedOn, certId, verifyUrl }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of Enrollment - ${course}`);
  pdf.setAuthor("Scale It Now");
  pdf.setSubject(`Certificate ${certId}`);
  const W = 841.89, H = 595.28, cx = W / 2;
  const page = pdf.addPage([W, H]);

  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifI = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const serifB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const clean = (t) => String(t).normalize("NFC").replace(/[^\x20-\x7E]/g, "");
  const center = (t, f, size, y, color, x = cx) => {
    t = clean(t);
    page.drawText(t, { x: x - f.widthOfTextAtSize(t, size) / 2, y, size, font: f, color });
  };

  // Frame: deep purple outer, fine gold inner, gold corner dots
  page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: C.deep, borderWidth: 5 });
  page.drawRectangle({ x: 31, y: 31, width: W - 62, height: H - 62, borderColor: C.gold, borderWidth: 0.8 });
  for (const [x, y] of [[31, 31], [W - 31, 31], [31, H - 31], [W - 31, H - 31]])
    page.drawCircle({ x, y, size: 3.2, color: C.gold });

  // Logo: your uploaded file (public/assets/logo.jpg)
  const logo = await pdf.embedJpg(Buffer.from(A.logo, "base64"));
  const lh = 112, lw = (logo.width / logo.height) * lh;
  page.drawImage(logo, { x: cx - lw / 2, y: H - 50 - lh, width: lw, height: lh });

  center("Certificate of Enrollment", serifB, 38, 386, C.deep);
  page.drawLine({ start: { x: cx - 45, y: 371 }, end: { x: cx + 45, y: 371 }, thickness: 1, color: C.gold });
  center("This certificate confirms that", sans, 11, 349, C.muted);

  let size = 46;
  const nm = clean(name);
  while (serifI.widthOfTextAtSize(nm, size) > 560 && size > 22) size -= 1;
  center(nm, serifI, size, 299, C.purple);
  page.drawLine({ start: { x: cx - 230, y: 287 }, end: { x: cx + 230, y: 287 }, thickness: 0.8, color: C.gold });

  center("has enrolled in the online course", sans, 11, 263, C.ink);
  let cs = 30;
  while (serifB.widthOfTextAtSize(clean(course), cs) > 620 && cs > 18) cs -= 1;
  center(course, serifB, cs, 228, C.deep);
  center("an online course by Scale It Now", sans, 10, 208, C.muted);

  center("Issued on purchase and enrollment. This certificate does not certify completion of the course lessons.", sans, 7, 38, C.muted);

  // Bottom row: date | QR | certificate ID
  const left = 96, right = W - 96;
  page.drawText("Date of issue", { x: left, y: 112, size: 8.5, font: sans, color: C.muted });
  page.drawText(prettyDate(issuedOn), { x: left, y: 95, size: 12, font: sansB, color: C.ink });
  const idW = sansB.widthOfTextAtSize(certId, 12);
  const lab = "Certificate ID";
  page.drawText(lab, { x: right - sans.widthOfTextAtSize(lab, 8.5), y: 112, size: 8.5, font: sans, color: C.muted });
  page.drawText(certId, { x: right - idW, y: 95, size: 12, font: sansB, color: C.ink });

  if (QRCode) {
    const qr = await pdf.embedPng(await QRCode.toBuffer(verifyUrl, { margin: 0, width: 300, color: { dark: "#14122b", light: "#ffffff" } }));
    page.drawImage(qr, { x: cx - 31, y: 72, width: 62, height: 62 });
    center("Scan to verify", sans, 7.5, 62, C.muted);
    center(verifyUrl, sans, 7, 49, C.muted);
  } else {
    center("Verify this certificate at", sans, 8, 100, C.muted);
    center(verifyUrl, sans, 8, 86, C.ink);
  }
  return pdf.save();
}
module.exports = { renderCertificate };
