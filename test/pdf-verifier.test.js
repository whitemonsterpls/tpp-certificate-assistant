'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPdfText, verifyPdf } = require('../src/pdf-verifier');

function createTextPdf(text) {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 8 Tf 36 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

const expected = {
  exporter: 'Example Export Ltd', consignee: 'Example Import', countryOfOrigin: 'Russia', importingCountry: 'Turkey',
  items: [{ description: 'Industrial equipment KKS: 10ABC80AX001', grossWeightKg: '430.00', netWeightKg: '250.00' }]
};

test('extracts text from a generated certificate PDF', async () => {
  const text = await extractPdfText(createTextPdf('CERTIFICATE OF ORIGIN Example Export Ltd 10ABC80AX001'));
  assert.match(text, /CERTIFICATE OF ORIGIN/);
  assert.match(text, /10ABC80AX001/);
});

test('accepts a matching English PDF', async () => {
  const pdf = createTextPdf('CERTIFICATE OF ORIGIN Example Export Ltd Example Import Russia Turkey 10ABC80AX001 430.00 250.00');
  const result = await verifyPdf(pdf, expected);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('reports missing values when the PDF belongs to another shipment', async () => {
  const result = await verifyPdf(createTextPdf('CERTIFICATE OF ORIGIN Another shipment'), expected);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('items[0].description'));
});
