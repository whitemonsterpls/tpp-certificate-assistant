'use strict';

const path = require('path');
const JSZip = require('jszip');
const {
  containsCyrillic,
  decimalForCertificate,
  normalizeEnglish,
  normalizeWhitespace,
  translateKnownRussian
} = require('./normalizer');

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

async function extractDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file('word/document.xml');
  if (!document) throw new Error('The DOCX does not contain word/document.xml');
  let xml = await document.async('string');
  xml = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t');
  return normalizeWhitespace(decodeXml(xml.replace(/<[^>]+>/g, ' ')), true);
}

function extractLegacyDocText(buffer) {
  const decoded = buffer.toString('utf16le');
  const runs = decoded.match(/[\p{L}\p{N}\p{P}\p{Zs}\t\r\n]{6,}/gu) || [];
  const cleaned = runs
    .map((run) => normalizeWhitespace(run, true))
    .filter((run) => /[A-Za-zА-Яа-я]/u.test(run));

  let start = cleaned.findIndex((line) => /З\s*А\s*Я\s*В\s*К\s*А/u.test(line));
  if (start < 0) start = cleaned.findIndex((line) => /Отправитель\s*:/iu.test(line));
  if (start < 0) throw new Error('Could not locate the application text in the legacy DOC file');

  let end = cleaned.findIndex((line, index) => index > start && /Основной шрифт абзаца|Microsoft Office Word/u.test(line));
  if (end < 0) end = Math.min(cleaned.length, start + 80);
  let text = cleaned.slice(start, end).join('\n');
  const contact = text.match(/Контактный телефон\s*:[\s\S]*?(?:доб\.?\s*[\d-]+|\d[\d\s()-]{5,})/iu);
  if (contact) text = text.slice(0, contact.index + contact[0].length);
  return text;
}

async function extractWordText(fileName, buffer) {
  const extension = path.extname(fileName).toLowerCase();
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (extension === '.docx' || isZip) return extractDocxText(buffer);
  if (extension === '.doc') return extractLegacyDocText(buffer);
  throw new Error('Supported formats: .doc and .docx');
}

function between(text, start, end) {
  const startMatch = start.exec(text);
  if (!startMatch) return '';
  const tail = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(tail);
  return normalizeWhitespace(endMatch ? tail.slice(0, endMatch.index) : tail, true);
}

function preferEnglishFragment(value) {
  const lines = normalizeWhitespace(value, true).split('\n').filter(Boolean);
  const english = lines.filter((line) => /[A-Za-z]{3}/.test(line) && !containsCyrillic(line));
  return normalizeEnglish(english.join(' '));
}

function parseExporter(text, warnings) {
  const section = between(text, /Отправитель\s*:/iu, /Получатель\s*:/iu);
  const companyStart = section.search(/(?:Joint\s+stock\s+company|JSC|LLC|Limited|Company)\b/i);
  if (companyStart >= 0) return normalizeEnglish(section.slice(companyStart));
  warnings.push('В данных отправителя не найден полный английский фрагмент; применена транслитерация.');
  return translateKnownRussian(section);
}

function parseConsignee(text, warnings) {
  const section = between(text, /Получатель\s*:/iu, /Контракт|Contract/iu);
  if (!section) return '';
  const english = preferEnglishFragment(section);
  if (!containsCyrillic(section) && english) return english;
  warnings.push('Адрес получателя переведён и транслитерирован автоматически — его нужно проверить.');
  return normalizeEnglish(translateKnownRussian(section));
}

function parseContracts(text) {
  const lines = [];
  const contract = text.match(/(?:Контракт\s*)?Contract\s*(?:No\s*)?([A-Z0-9/-]+)\s*dd\.?\s*(\d{2}\.\d{2}\.\d{4})/iu);
  const subcontract = text.match(/Subcontract\s*(?:No\s*)?([A-Z0-9/-]+)\s*dd\.?\s*(\d{2}\.\d{2}\.\d{4})/iu);
  if (contract) lines.push(`Contract No ${contract[1]} dd. ${contract[2]}`);
  if (subcontract) lines.push(`Subcontract No ${subcontract[1]} dd. ${subcontract[2]}`);
  return lines.join('\n');
}

function parseTransport(text, warnings) {
  const block = between(text, /Вид транспорта\s*:/iu, /Количество мест/iu);
  const routeStart = block.search(/(?:г\.\s*)?Москва|Russia|Россия/iu);
  const method = normalizeEnglish(routeStart >= 0 ? block.slice(0, routeStart) : block);
  const routeArea = routeStart >= 0 ? block.slice(routeStart) : '';
  let route = '';
  if (routeArea) {
    route = translateKnownRussian(routeArea)
      .replace(/^Moscow\s*\(Russia\)/i, 'Russia')
      .replace(/Russian Federation/gi, 'Russia');
    if (containsCyrillic(routeArea)) warnings.push('Маршрут приведён к названиям стран — проверьте его перед заполнением.');
  }
  return normalizeEnglish([method, route].filter(Boolean).join('\n'), true);
}

function parsePackage(text) {
  const section = between(text, /Количество мест и вид упаковки\s*:/iu, /Наименование товара/iu);
  if (!section) return { count: '', type: '' };
  const raw = normalizeWhitespace(section);
  const count = raw.match(/\d+/)?.[0] || '';
  const englishPart = raw.includes('/') ? raw.split('/').pop() : translateKnownRussian(raw.replace(/^\s*\d+\s*[-:]?\s*/, ''));
  return { count, type: normalizeEnglish(englishPart) };
}

function parseGoods(text, warnings) {
  const section = between(text, /Наименование товара[^:]*\s*:/iu, /Вес брутто\s*:/iu);
  if (!section) return [];
  const normalized = normalizeWhitespace(section, true);
  const matches = [...normalized.matchAll(/(?:^|\n)\s*(\d+)\.\s*([\s\S]*?)(?=(?:\n\s*\d+\.)|$)/g)];
  const chunks = matches.length ? matches.map((m) => ({ number: m[1], text: m[2] })) : [{ number: '1', text: normalized }];

  return chunks.map((chunk) => {
    const englishMatch = chunk.text.match(/\/\s*([A-Za-z][\s\S]*)/);
    let description = englishMatch ? englishMatch[1] : chunk.text;
    description = description
      .replace(/код\s*\/\s*code/giu, 'code')
      .replace(/\s*-\s*(\d+)\s*шт\.?\s*\/\s*Pcs\.?/giu, ' - $1 pcs.');
    if (containsCyrillic(description)) {
      warnings.push(`Для товара ${chunk.number} не найдено чистое английское описание; применена транслитерация.`);
      description = translateKnownRussian(description);
    }
    description = normalizeEnglish(description)
      .replace(/\s+[-:]?\s*(\d+)\s+pcs?\.?$/i, ' - $1 pcs.')
      .replace(/ - 1 pcs\.$/i, ' - 1 pc.');
    return { number: chunk.number, description };
  });
}

function inferCountries(text, warnings) {
  let importingCountry = '';
  if (/Турецк(?:ую|ая|ой)? Республик|\bТурция\b|\bTurkey\b/iu.test(text)) importingCountry = 'Turkey';
  let origin = '';
  if (/Moscow|Москва|Russia|Россия/iu.test(text)) {
    origin = 'Russia';
    warnings.push('Страна происхождения Russia определена из адреса отправителя и контекста заявки.');
  }
  return { importingCountry, origin };
}

function parseApplication(text, sourceName = '') {
  const warnings = [];
  const packages = parsePackage(text);
  const goods = parseGoods(text, warnings);
  const gross = decimalForCertificate(text.match(/Вес брутто\s*:\s*([^\n]+)/iu)?.[1]);
  const net = decimalForCertificate(text.match(/Вес нетто\s*:\s*([^\n]+)/iu)?.[1]);
  const countries = inferCountries(text, warnings);

  const items = goods.map((item, index) => ({
    ...item,
    packageCount: index === 0 ? packages.count : '',
    packageType: index === 0 ? packages.type : '',
    grossWeightKg: index === 0 ? gross : '',
    netWeightKg: index === 0 ? net : ''
  }));

  return {
    sourceName,
    certificateLanguage: 'English',
    exporter: parseExporter(text, warnings),
    consignee: parseConsignee(text, warnings),
    transportRoute: parseTransport(text, warnings),
    officialUse: '',
    countryOfOrigin: countries.origin,
    supplementaryDetails: parseContracts(text),
    items,
    importingCountry: countries.importingCountry,
    declarationPlace: '',
    declarationDate: '',
    warnings: [...new Set(warnings)],
    sourceText: normalizeWhitespace(text, true)
  };
}

async function parseWordApplication(fileName, buffer) {
  const text = await extractWordText(fileName, buffer);
  return parseApplication(text, fileName);
}

module.exports = {
  extractDocxText,
  extractLegacyDocText,
  extractWordText,
  parseApplication,
  parseWordApplication
};
