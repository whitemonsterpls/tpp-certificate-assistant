'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { BrowserManager } = require('../src/browser');

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('fills the representative TPP form through DOM labels', { skip: process.platform === 'win32' && !fs.existsSync(edge) }, async () => {
  const launched = await chromium.launch({ headless: true, executablePath: process.platform === 'win32' ? edge : undefined });
  try {
    const page = await launched.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, 'platform-fixture.html')).href);
    const manager = new BrowserManager({ projectDir: path.resolve(__dirname, '..'), dashboardUrl: 'about:blank', headless: true });
    manager.context = launched;
    manager.platformPage = page;
    const data = {
      certificateLanguage: 'English', exporter: 'Exporter Ltd', consignee: 'Buyer Ltd', transportRoute: 'By sea\nRussia - Turkey',
      officialUse: '', countryOfOrigin: 'Russia', supplementaryDetails: 'Contract No 1', importingCountry: 'Turkey',
      declarationPlace: 'Moscow', declarationDate: '11.09.2026',
      items: [{ description: 'Sample collection box KKS: 10KPG80AX001 - 1 pc.', packageCount: '1', packageType: 'Wooden box', grossWeightKg: '430.00', netWeightKg: '250.00' }]
    };
    const result = await manager.fillPlatform(data);
    assert.equal(await page.locator('#exporter').inputValue(), data.exporter);
    assert.equal(await page.locator('#description-1').inputValue(), data.items[0].description);
    assert.equal(await page.locator('#gross-1').inputValue(), '430.00');
    assert.equal(await page.locator('#language').inputValue(), 'Английский');
    assert.ok(result.outcomes.filter((x) => x.status === 'not-found').length === 0);
  } finally {
    await launched.close();
  }
});
