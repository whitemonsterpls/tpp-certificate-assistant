'use strict';

const { pathToFileURL } = require('url');
const { containsCyrillic, normalizeWhitespace } = require('./normalizer');

async function loadPdfJs() {
  const resolved = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  return import(pathToFileURL(resolved).href);
}

async function extractPdfText(buffer) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  return normalizeWhitespace(pages.join('\n'), true);
}

function simplify(value = '') {
  return normalizeWhitespace(value).toLowerCase().replace(/["'.,:;()]/g, '').replace(/\s+/g, ' ');
}

function expectedChecks(data) {
  const checks = [];
  const add = (field, value, token) => {
    if (token) checks.push({ field, value, token });
  };
  add('exporter', data.exporter, data.exporter?.split(',')[0]);
  add('consignee', data.consignee, data.consignee?.split(/[ ,]/).filter(Boolean).slice(0, 2).join(' '));
  add('countryOfOrigin', data.countryOfOrigin, data.countryOfOrigin);
  add('importingCountry', data.importingCountry, data.importingCountry);
  for (const [index, item] of (data.items || []).entries()) {
    const kks = item.description?.match(/\b\d{2}[A-Z0-9]{6,}\b/i)?.[0];
    add(`items[${index}].description`, item.description, kks || item.description?.split(' ').slice(0, 3).join(' '));
    add(`items[${index}].grossWeightKg`, item.grossWeightKg, item.grossWeightKg);
    add(`items[${index}].netWeightKg`, item.netWeightKg, item.netWeightKg);
  }
  return checks;
}

async function verifyPdf(buffer, expected) {
  const text = await extractPdfText(buffer);
  const haystack = simplify(text).replace(/,/g, '.');
  const checks = expectedChecks(expected).map((check) => {
    const token = simplify(check.token).replace(/,/g, '.');
    return { ...check, found: Boolean(token && haystack.includes(token)) };
  });
  const cyrillic = [...new Set((text.match(/[\u0400-\u052f]+/gu) || []))];
  return {
    ok: !containsCyrillic(text) && checks.every((check) => check.found),
    pageText: text,
    cyrillic,
    checks,
    missing: checks.filter((check) => !check.found).map((check) => check.field)
  };
}

module.exports = { extractPdfText, verifyPdf };
