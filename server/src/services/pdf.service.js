// Server-side PDF rendering with PDFKit: real, selectable, ATS-readable text
// (no images of text). Three templates mirror the React live preview.
import PDFDocument from 'pdfkit';

const TEMPLATES = {
  classic: {
    font: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic',
    size: 10.5, nameSize: 22, headingSize: 11, margin: 50, accent: '#111111', align: 'center', gap: 4, rule: true,
  },
  modern: {
    font: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique',
    size: 10, nameSize: 24, headingSize: 10.5, margin: 48, accent: '#1d4ed8', align: 'left', gap: 5, rule: true,
  },
  compact: {
    font: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique',
    size: 9.2, nameSize: 18, headingSize: 9.6, margin: 36, accent: '#0f172a', align: 'center', gap: 2.5, rule: true,
  },
};

const TEXT = '#1f2937';
const MUTED = '#4b5563';

// Standard PDF fonts use WinAnsi encoding; replace characters they cannot draw.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function sanitize(value) {
  return Array.from(String(value || ''))
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) return ch;
      return '?';
    })
    .join('')
    .trim();
}

const joinParts = (parts, sep = ' | ') => parts.map((p) => sanitize(p)).filter(Boolean).join(sep);
const range = (start, end, current) => joinParts([start, current ? 'Present' : end], ' - ');
const href = (url) => (url && /^https?:\/\//i.test(url) ? url : url ? `https://${url}` : undefined);

export function renderResumePdf(resume) {
  const t = TEMPLATES[resume.template] || TEMPLATES.classic;
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: t.margin, bottom: t.margin, left: t.margin, right: t.margin },
    info: {
      Title: sanitize(resume.title || 'Resume'),
      Author: sanitize(resume.personal?.fullName || ''),
      Creator: 'RoleFit AI',
    },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - t.margin * 2;
  const left = t.margin;
  const p = resume.personal || {};

  const ensureSpace = (needed) => {
    if (doc.y + needed > doc.page.height - t.margin) doc.addPage();
  };

  // Header
  doc.font(t.bold).fontSize(t.nameSize).fillColor(t.accent).text(sanitize(p.fullName || resume.title || 'Your Name'), left, doc.y, { width, align: t.align });
  if (p.headline) doc.font(t.font).fontSize(t.size + 1.5).fillColor(MUTED).text(sanitize(p.headline), { width, align: t.align });
  const contact = joinParts([p.email, p.phone, p.location]);
  if (contact) doc.moveDown(0.15).font(t.font).fontSize(t.size - 0.5).fillColor(TEXT).text(contact, { width, align: t.align });
  const links = joinParts([p.linkedin, p.github, p.website]);
  if (links) doc.font(t.font).fontSize(t.size - 0.5).fillColor(TEXT).text(links, { width, align: t.align });
  doc.moveDown(0.4);

  const heading = (label) => {
    ensureSpace(t.headingSize + 40);
    doc.moveDown(t.gap / 6);
    doc.font(t.bold).fontSize(t.headingSize).fillColor(t.accent).text(label.toUpperCase(), left, doc.y, { width, characterSpacing: 0.6 });
    if (t.rule) {
      const y = doc.y + 1;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(t.accent).stroke();
      doc.y = y + 3;
    }
  };

  // Title on the left, dates right-aligned on the same baseline.
  const entryLine = (title, subtitle, dates) => {
    ensureSpace(t.size * 3);
    const y = doc.y;
    const dateText = sanitize(dates);
    doc.font(t.font).fontSize(t.size);
    const dateWidth = dateText ? doc.widthOfString(dateText) + 8 : 0;
    if (dateText) doc.fillColor(MUTED).text(dateText, left, y, { width, align: 'right', lineBreak: false });
    doc.font(t.bold).fontSize(t.size).fillColor(TEXT).text(sanitize(title) || ' ', left, y, { width: width - dateWidth });
    if (subtitle) doc.font(t.italic).fontSize(t.size).fillColor(MUTED).text(sanitize(subtitle), left, doc.y, { width: width - dateWidth });
  };

  const bullets = (items) => {
    for (const item of (items || []).map(sanitize).filter(Boolean)) {
      ensureSpace(t.size * 2);
      doc.font(t.font).fontSize(t.size).fillColor(TEXT).text(`•  ${item}`, left + 10, doc.y, { width: width - 10, indent: -8, paragraphGap: 1 });
    }
  };

  const paragraph = (text) => {
    if (!text) return;
    doc.font(t.font).fontSize(t.size).fillColor(TEXT).text(sanitize(text), left, doc.y, { width, align: 'left' });
  };

  const gap = () => doc.moveDown(t.gap / 10);

  if (resume.summary) {
    heading('Summary');
    paragraph(resume.summary);
  }

  const technical = resume.skills?.technical || [];
  const interpersonal = resume.skills?.interpersonal || [];
  if (technical.length || interpersonal.length) {
    heading('Skills');
    const row = (label, values) => {
      if (!values.length) return;
      doc.font(t.bold).fontSize(t.size).fillColor(TEXT).text(`${label}: `, left, doc.y, { width, continued: true });
      doc.font(t.font).text(sanitize(values.join(', ')));
    };
    row('Technical', technical);
    row('Interpersonal', interpersonal);
  }

  if (resume.experience?.length) {
    heading('Experience');
    for (const e of resume.experience) {
      entryLine(joinParts([e.role, e.organization], ', '), joinParts([e.type, e.location], ' | '), range(e.startDate, e.endDate, e.current));
      bullets(e.bullets);
      gap();
    }
  }

  if (resume.projects?.length) {
    heading('Projects');
    for (const pr of resume.projects) {
      entryLine(joinParts([pr.name, pr.role], ', '), joinParts([(pr.technologies || []).join(', ')]), range(pr.startDate, pr.endDate));
      if (pr.link) doc.font(t.font).fontSize(t.size - 0.5).fillColor(MUTED).text(sanitize(pr.link), left, doc.y, { width, link: href(pr.link), underline: false });
      bullets(pr.bullets);
      gap();
    }
  }

  if (resume.education?.length) {
    heading('Education');
    for (const ed of resume.education) {
      entryLine(sanitize(ed.institution), joinParts([joinParts([ed.degree, ed.field], ', '), ed.grade && `Grade: ${ed.grade}`, ed.location], ' | '), range(ed.startDate, ed.endDate));
      if (ed.details) bullets([ed.details]);
      gap();
    }
  }

  if (resume.certifications?.length) {
    heading('Certifications');
    bullets(resume.certifications.map((c) => joinParts([c.name, c.issuer, c.date], ' - ')));
  }

  if (resume.achievements?.length) {
    heading('Achievements');
    bullets(resume.achievements.map((a) => joinParts([a.title, a.description, a.date], ' - ')));
  }

  if (resume.links?.length) {
    heading('Links');
    bullets(resume.links.map((l) => joinParts([l.label, l.url], ': ')));
  }

  doc.end();
  return done;
}

export function safeFilename(value, fallback = 'Resume') {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return base || fallback;
}
