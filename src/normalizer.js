'use strict';

const CYRILLIC_RE = /[\u0400-\u052f]/u;

const TRANSLIT = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'Zh', З: 'Z', И: 'I', Й: 'Y',
  К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F',
  Х: 'Kh', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Shch', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

function normalizePunctuation(value = '') {
  return String(value)
    .replace(/[«»„“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/№/g, 'No')
    .replace(/\u00a0/g, ' ')
    .replace(/[İI]/g, 'I')
    .replace(/[ı]/g, 'i')
    .replace(/[Ş]/g, 'S')
    .replace(/[ş]/g, 's')
    .replace(/[Ğ]/g, 'G')
    .replace(/[ğ]/g, 'g')
    .replace(/[Ç]/g, 'C')
    .replace(/[ç]/g, 'c')
    .replace(/[Ö]/g, 'O')
    .replace(/[ö]/g, 'o')
    .replace(/[Ü]/g, 'U')
    .replace(/[ü]/g, 'u');
}

function normalizeWhitespace(value = '', multiline = false) {
  const text = normalizePunctuation(value).replace(/\r/g, '');
  if (!multiline) return text.replace(/\s+/g, ' ').trim();
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function containsCyrillic(value = '') {
  return CYRILLIC_RE.test(String(value));
}

function transliterate(value = '') {
  return normalizePunctuation(value)
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('');
}

function translateKnownRussian(value = '') {
  let text = normalizePunctuation(value);
  const replacements = [
    [/Турецк(?:ую|ая|ой)? Республик(?:у|а|и)?/gi, 'Turkey'],
    [/Российск(?:ая|ой|ую) Федерац(?:ия|ии|ию)/gi, 'Russian Federation'],
    [/Россия/gi, 'Russia'],
    [/Турция/gi, 'Turkey'],
    [/г\.\s*Москва/gi, 'Moscow'],
    [/Москва/gi, 'Moscow'],
    [/\(РФ\)/gi, '(Russia)'],
    [/район\s+([А-Яа-яЁё-]+)/gi, '$1 district'],
    [/улица\s+(\d+)-я/gi, '$1th Street'],
    [/улица\s+([А-Яа-яЁё0-9-]+)/gi, '$1 Street'],
    [/Блок/gi, 'Block'],
    [/офис/gi, 'office'],
    [/округ\s+([А-Яа-яЁё-]+)/gi, '$1 district'],
    [/Деревянный\s+ящик/gi, 'Wooden box'],
    [/Деревянные\s+ящики/gi, 'Wooden boxes'],
    [/шт\.?/gi, 'pcs.'],
    [/код/gi, 'code']
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return normalizeWhitespace(transliterate(text));
}

function normalizeEnglish(value = '', multiline = false) {
  let text = normalizeWhitespace(value, multiline);
  text = text
    .replace(/\bPcs\.?\b/gi, 'pcs.')
    .replace(/\b1\s+pcs\./gi, '1 pc.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/ {2,}/g, ' ');
  return multiline ? normalizeWhitespace(text, true) : text.trim();
}

function decimalForCertificate(value = '') {
  const match = String(value).match(/-?\d+(?:[.,]\d+)?/);
  return match ? match[0].replace(',', '.') : '';
}

module.exports = {
  containsCyrillic,
  decimalForCertificate,
  normalizeEnglish,
  normalizePunctuation,
  normalizeWhitespace,
  translateKnownRussian,
  transliterate
};
