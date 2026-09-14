'use strict';

const { containsCyrillic } = require('./normalizer');

function flattenStrings(value, path = '', output = []) {
  if (typeof value === 'string') output.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => flattenStrings(item, `${path}[${index}]`, output));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!['warnings', 'sourceText', 'sourceName'].includes(key)) flattenStrings(child, path ? `${path}.${key}` : key, output);
    }
  }
  return output;
}

function validateApplication(data) {
  const errors = [];
  const warnings = [...(data.warnings || [])];
  const required = [
    ['exporter', data.exporter],
    ['consignee', data.consignee],
    ['transportRoute', data.transportRoute],
    ['countryOfOrigin', data.countryOfOrigin],
    ['importingCountry', data.importingCountry]
  ];
  for (const [field, value] of required) if (!String(value || '').trim()) errors.push(`Не заполнено обязательное поле: ${field}`);
  if (!Array.isArray(data.items) || data.items.length === 0) errors.push('Нужно добавить хотя бы один товар.');

  for (const entry of flattenStrings(data)) {
    if (containsCyrillic(entry.value)) errors.push(`В поле ${entry.path} осталась кириллица: ${entry.value}`);
  }

  (data.items || []).forEach((item, index) => {
    if (!item.description?.trim()) errors.push(`Товар ${index + 1}: описание не заполнено.`);
    for (const key of ['grossWeightKg', 'netWeightKg']) {
      if (item[key] && !/^\d+(?:\.\d+)?$/.test(item[key])) errors.push(`Товар ${index + 1}: ${key} должен быть числом с точкой.`);
    }
  });

  if (!data.declarationPlace) warnings.push('Место заявления не заполнено.');
  if (!data.declarationDate) warnings.push('Дата заявления не заполнена.');
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

module.exports = { validateApplication };
