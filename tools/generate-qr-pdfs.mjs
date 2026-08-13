import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputFile = join(root, '.private', 'students.json');
const outputDir = join(root, 'pdf-output');
const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

if (!existsSync(inputFile)) throw new Error('Execute “npm run import:students” primeiro.');
if (!existsSync(fontPath)) throw new Error(`Fonte necessária não encontrada: ${fontPath}`);

const students = JSON.parse(readFileSync(inputFile, 'utf8'));
const classes = [...new Set(students.map((student) => student.className))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
mkdirSync(outputDir, { recursive: true });

const A4 = { width: 595.28, height: 841.89 };
const columns = 3;
const rows = 8;
const marginX = 20;
const marginY = 20;
const gap = 5;
const labelWidth = (A4.width - marginX * 2 - gap * (columns - 1)) / columns;
const labelHeight = (A4.height - marginY * 2 - gap * (rows - 1)) / rows;
const perPage = columns * rows;

function safeClassName(className) {
  return className.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function labelData(student) {
  return {
    ...student,
    qr: await QRCode.toBuffer(`VST1:${student.qrToken}`, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#101512', light: '#ffffff' }
    })
  };
}

function drawLabel(doc, student, indexOnPage) {
  const column = indexOnPage % columns;
  const row = Math.floor(indexOnPage / columns);
  const x = marginX + column * (labelWidth + gap);
  const y = marginY + row * (labelHeight + gap);
  const qrSize = 76;

  doc.save();
  doc.roundedRect(x, y, labelWidth, labelHeight, 6).lineWidth(0.45).dash(2, { space: 2 }).strokeColor('#aab2ad').stroke();
  doc.undash();
  doc.image(student.qr, x + 7, y + (labelHeight - qrSize) / 2, { width: qrSize, height: qrSize });

  const textX = x + 90;
  const textWidth = labelWidth - 98;
  doc.font(fontPath).fillColor('#151b18');
  doc.fontSize(8.6).font(fontPath).text(student.name, textX, y + 15, {
    width: textWidth,
    height: 42,
    ellipsis: true,
    lineGap: 1
  });
  doc.fontSize(7.2).fillColor('#4f5a54').text(student.className, textX, y + labelHeight - 29, { width: textWidth });
  doc.fontSize(6.2).fillColor('#7b8580').text(`Vistos · RA ${student.ra}`, textX, y + labelHeight - 17, { width: textWidth });
  doc.restore();
}

async function createPdf(filePath, groups, title) {
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0, info: { Title: title, Author: 'Vistos' } });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);

  for (const group of groups) {
    const labels = await Promise.all(group.map(labelData));
    for (let start = 0; start < labels.length; start += perPage) {
      doc.addPage({ size: 'A4', margin: 0 });
      labels.slice(start, start + perPage).forEach((student, index) => drawLabel(doc, student, index));
    }
  }

  doc.end();
  await new Promise((resolvePromise, reject) => {
    stream.on('finish', resolvePromise);
    stream.on('error', reject);
  });
}

for (const className of classes) {
  const group = students.filter((student) => student.className === className).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  await createPdf(join(outputDir, `qr-codes-${safeClassName(className)}.pdf`), [group], `QR codes — ${className}`);
}

const allGroups = classes.map((className) => students.filter((student) => student.className === className).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
await createPdf(join(outputDir, 'qr-codes-todas-as-turmas.pdf'), allGroups, 'QR codes — Todas as turmas');

writeFileSync(join(outputDir, 'LEIA-ME-IMPRESSAO.txt'), [
  'VISTOS — QR CODES PARA ADESIVOS',
  '',
  'Imprima em papel A4 adesivo, tamanho real (100%).',
  'Desative opções como “Ajustar à página” ou “Redimensionar”.',
  'As linhas pontilhadas indicam onde recortar.',
  'Faça primeiro uma página de teste e confirme a leitura com o celular.',
  '',
  `Total: ${students.length} alunos`,
  ...classes.map((className) => `${className}: ${students.filter((student) => student.className === className).length} QR codes`),
  ''
].join('\n'), 'utf8');

console.log(`PDFs gerados em ${outputDir}`);
classes.forEach((className) => console.log(`- qr-codes-${safeClassName(className)}.pdf`));
console.log('- qr-codes-todas-as-turmas.pdf');
