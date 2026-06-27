/**
 * contractExport.js — Skootlink Rental Agreement PDF generator
 * Uses jsPDF direct drawing (same pattern as cvExport.ts in Crosssa).
 *
 * Usage:
 *   import { downloadContractPDF } from '@/lib/contractExport';
 *   downloadContractPDF(contractText, rentalId, vehicleInfo);
 *
 * Place at: src/lib/contractExport.js
 */
import { jsPDF } from 'jspdf';

// ── Page geometry (mm, A4) ────────────────────────────────────────────────────
const PW     = 210;
const PH     = 297;
const ML     = 18;   // margin left
const MR     = 18;   // margin right
const MT     = 20;   // margin top (first page, below header)
const BODY_W = PW - ML - MR;
const LINE_H = 5.5;
const FOOTER_Y = PH - 10;
const BOTTOM   = FOOTER_Y - 4;

// ── Colour helpers ────────────────────────────────────────────────────────────
const PRIMARY  = [15,  116, 209];   // #0f74d1  Skootlink blue
const DARK     = [17,  17,  17];
const MID      = [80,  80,  80];
const LIGHT    = [130, 130, 130];
const RULE_CLR = [220, 228, 236];

function tc(p, [r, g, b]) { p.setTextColor(r, g, b); }
function dc(p, [r, g, b]) { p.setDrawColor(r, g, b); }
function fc(p, [r, g, b]) { p.setFillColor(r, g, b); }

// ── Header block (drawn on every page) ───────────────────────────────────────
function drawHeader(p, pageNum, totalPages, rentalId, vehicleInfo) {
  // Blue top bar
  fc(p, PRIMARY); p.rect(0, 0, PW, 12, 'F');

  // Logo text
  p.setFont('helvetica', 'bold');
  p.setFontSize(13);
  tc(p, [255, 255, 255]);
  p.text('Skootlink', ML, 8.5);

  // Tagline
  p.setFont('helvetica', 'normal');
  p.setFontSize(7.5);
  tc(p, [179, 217, 255]);
  p.text('Vehicle Rental Platform', ML + 34, 8.5);

  // Page number top-right
  p.setFont('helvetica', 'normal');
  p.setFontSize(7);
  tc(p, [179, 217, 255]);
  p.text(`Page ${pageNum} of ${totalPages}`, PW - MR, 8.5, { align: 'right' });

  // Document title row
  p.setFont('helvetica', 'bold');
  p.setFontSize(11);
  tc(p, DARK);
  p.text('VEHICLE RENTAL AGREEMENT', ML, 20);

  // Rental ref + vehicle info on the right
  if (rentalId || vehicleInfo) {
    p.setFont('helvetica', 'normal');
    p.setFontSize(7.5);
    tc(p, LIGHT);
    const meta = [rentalId ? `Ref: #${String(rentalId).slice(0, 8)}` : '', vehicleInfo].filter(Boolean).join('  ·  ');
    p.text(meta, PW - MR, 20, { align: 'right' });
  }

  // Rule under title
  dc(p, RULE_CLR);
  p.setLineWidth(0.3);
  p.line(ML, 23, PW - MR, 23);
}

// ── Footer (drawn on every page) ─────────────────────────────────────────────
function drawFooter(p, dateStr) {
  dc(p, RULE_CLR);
  p.setLineWidth(0.2);
  p.line(ML, FOOTER_Y, PW - MR, FOOTER_Y);

  p.setFont('helvetica', 'normal');
  p.setFontSize(6.5);
  tc(p, LIGHT);
  p.text('Skootlink (Pty) Ltd  ·  www.skootlink.co.za  ·  help@skootlink.co.za', ML, FOOTER_Y + 4);
  p.text(`Generated ${dateStr}`, PW - MR, FOOTER_Y + 4, { align: 'right' });
}

// ── Main export function ──────────────────────────────────────────────────────
/**
 * @param {string} contractText  — the raw plain-text contract (from rentals.contract_text)
 * @param {string|number} rentalId  — used in filename and header ref
 * @param {string} vehicleInfo  — e.g. "Toyota Corolla (2021)" shown in header
 */
export function downloadContractPDF(contractText, rentalId = '', vehicleInfo = '') {
  const p = new jsPDF({ unit: 'mm', format: 'a4' });

  const dateStr = new Date().toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // ── First pass: collect all output lines with their styles ─────────────────
  // We need total page count before drawing so we can stamp "Page X of Y".
  const rawLines = contractText.split('\n');

  // Map each raw line to a style bucket
  const styled = []; // { text, style: 'h1'|'h2'|'body'|'bullet'|'blank' }

  for (const raw of rawLines) {
    const line = raw; // preserve leading spaces for indented bullets
    const trimmed = line.trim();

    if (!trimmed) {
      styled.push({ text: '', style: 'blank' });
      continue;
    }

    // All-caps short line → section heading
    if (trimmed === trimmed.toUpperCase() && trimmed.length < 80 && !/^\d+\./.test(trimmed) && !/^[•–\-]/.test(trimmed)) {
      styled.push({ text: trimmed, style: 'h1' });
      continue;
    }

    // Numbered clause (e.g. "1. VEHICLE DETAILS" or "8.3 Driver's Right")
    if (/^\d+[\.\d]*\s+[A-Z]/.test(trimmed)) {
      styled.push({ text: trimmed, style: 'h2' });
      continue;
    }

    // Bullet / dash
    if (/^[•–\-]/.test(trimmed) || /^–/.test(line.slice(0, 6))) {
      styled.push({ text: trimmed, style: 'bullet' });
      continue;
    }

    styled.push({ text: trimmed, style: 'body' });
  }

  // ── Measure total pages (dry run) ─────────────────────────────────────────
  let dryY = MT + 8;
  let dryPages = 1;

  const advanceDry = (h) => {
    dryY += h;
    if (dryY > BOTTOM) { dryPages++; dryY = MT + 8; }
  };

  for (const { text, style } of styled) {
    if (style === 'blank') { advanceDry(LINE_H * 0.5); continue; }
    if (style === 'h1')   { advanceDry(LINE_H + 2); continue; }
    if (style === 'h2')   { advanceDry(LINE_H + 1); continue; }
    // body / bullet — may wrap
    p.setFont('helvetica', 'normal');
    p.setFontSize(9);
    const maxW = style === 'bullet' ? BODY_W - 5 : BODY_W;
    const lines = p.splitTextToSize(text, maxW);
    advanceDry(lines.length * LINE_H + (style === 'body' ? 0.5 : 0));
  }

  const totalPages = dryPages;

  // ── Second pass: draw ──────────────────────────────────────────────────────
  let currentPage = 1;
  let y = MT + 8; // start below header

  drawHeader(p, currentPage, totalPages, rentalId, vehicleInfo);
  drawFooter(p, dateStr);

  const newPage = () => {
    p.addPage();
    currentPage++;
    drawHeader(p, currentPage, totalPages, rentalId, vehicleInfo);
    drawFooter(p, dateStr);
    return MT + 8;
  };

  const checkY = (needed) => {
    if (y + needed > BOTTOM) { y = newPage(); }
  };

  for (const { text, style } of styled) {
    if (style === 'blank') {
      y += LINE_H * 0.5;
      continue;
    }

    if (style === 'h1') {
      checkY(LINE_H + 5);
      // Blue underline accent
      fc(p, PRIMARY);
      p.rect(ML, y - 3.5, 3, LINE_H - 0.5, 'F');

      p.setFont('helvetica', 'bold');
      p.setFontSize(9.5);
      tc(p, PRIMARY);
      p.text(text, ML + 5, y);
      y += LINE_H + 2;
      continue;
    }

    if (style === 'h2') {
      checkY(LINE_H + 3);
      p.setFont('helvetica', 'bold');
      p.setFontSize(9);
      tc(p, DARK);
      p.text(text, ML, y);
      y += LINE_H + 1;
      continue;
    }

    if (style === 'bullet') {
      p.setFont('helvetica', 'normal');
      p.setFontSize(9);
      const lines = p.splitTextToSize(text, BODY_W - 5);
      checkY(lines.length * LINE_H);
      // Bullet dot
      fc(p, MID);
      p.circle(ML + 1.5, y - 1.5, 0.8, 'F');
      tc(p, MID);
      for (let i = 0; i < lines.length; i++) {
        p.text(lines[i], ML + 4, y);
        y += LINE_H;
      }
      continue;
    }

    // body
    p.setFont('helvetica', 'normal');
    p.setFontSize(9);
    tc(p, MID);
    const lines = p.splitTextToSize(text, BODY_W);
    checkY(lines.length * LINE_H);
    for (const ln of lines) {
      p.text(ln, ML, y);
      y += LINE_H;
    }
    y += 0.5;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const safeName = vehicleInfo
    ? vehicleInfo.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
    : 'contract';
  const filename = `skootlink_rental_${safeName}_${String(rentalId).slice(0, 8) || 'agreement'}.pdf`;
  p.save(filename);
}
