'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApplication } = require('../src/parser');
const { validateApplication } = require('../src/validator');

const sampleText = `
З А Я В К А
Просим выдать сертификат для отправки груза в Турецкую Республику.
Отправитель: Акционерное общество "Пример Экспорт" Joint stock company "Example Export", 10 Industrial Road, Moscow, Russia, 100000
Получатель: EXAMPLE IMPORT COMPANY, район Мерсин, Турция.
Контракт Contract 123 dd. 01.02.2026
Subcontract SC-45 dd. 03.02.2026
Вид транспорта: By truck, by sea
г. Москва (РФ) - Турецкая Республика
Количество мест и вид упаковки: 1 - Деревянный ящик / Wooden box
Наименование товара (с указанием штук):
1. Пример оборудования / Industrial equipment code KKS: 10ABC80AX001 - 1 шт. / Pcs.
Вес брутто: 430,00 кг.
Вес нетто: 250,00 кг.
`;

test('parses a representative application into English certificate fields', () => {
  const data = parseApplication(sampleText, 'sample.doc');
  assert.match(data.exporter, /Example Export/);
  assert.match(data.consignee, /EXAMPLE IMPORT COMPANY/);
  assert.equal(data.transportRoute, 'By truck, by sea\nRussia - Turkey');
  assert.equal(data.countryOfOrigin, 'Russia');
  assert.equal(data.importingCountry, 'Turkey');
  assert.match(data.supplementaryDetails, /Contract No 123 dd\. 01\.02\.2026/);
  assert.equal(data.items.length, 1);
  assert.match(data.items[0].description, /10ABC80AX001/);
  assert.equal(data.items[0].packageCount, '1');
  assert.equal(data.items[0].packageType, 'Wooden box');
  assert.equal(data.items[0].grossWeightKg, '430.00');
  assert.equal(data.items[0].netWeightKg, '250.00');
  assert.equal(validateApplication(data).ok, true);
});

test('blocks Cyrillic before platform filling', () => {
  const invalid = {
    exporter: 'Company, Москва', consignee: 'Buyer', transportRoute: 'By sea', countryOfOrigin: 'Russia',
    importingCountry: 'Turkey', items: [{ description: 'Box', grossWeightKg: '1.0', netWeightKg: '0.5' }]
  };
  const result = validateApplication(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /кириллица/i);
});
