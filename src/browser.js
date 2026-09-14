'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_EXECUTABLES = process.platform === 'win32'
  ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ]
  : [];

class BrowserManager {
  constructor({ projectDir, dashboardUrl, headless = false }) {
    this.projectDir = projectDir;
    this.dashboardUrl = dashboardUrl;
    this.headless = headless;
    this.context = null;
    this.dashboardPage = null;
    this.platformPage = null;
  }

  findExecutable() {
    return DEFAULT_EXECUTABLES.find((candidate) => candidate && fs.existsSync(candidate));
  }

  async ensureBrowser() {
    if (this.context) return this.context;
    const { chromium } = require('playwright');
    const executablePath = this.findExecutable();
    const profileDir = path.join(this.projectDir, 'data', 'browser-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: this.headless,
      executablePath,
      acceptDownloads: true,
      viewport: null,
      args: ['--start-maximized']
    });
    this.context.on('close', () => {
      this.context = null;
      this.dashboardPage = null;
      this.platformPage = null;
    });
    return this.context;
  }

  async openDashboard() {
    const context = await this.ensureBrowser();
    this.dashboardPage = context.pages()[0] || await context.newPage();
    await this.dashboardPage.goto(this.dashboardUrl, { waitUntil: 'domcontentloaded' });
    await this.dashboardPage.bringToFront();
  }

  async openPlatform(url) {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('Enter the full platform URL, including https://');
    const context = await this.ensureBrowser();
    if (!this.platformPage || this.platformPage.isClosed()) this.platformPage = await context.newPage();
    await this.platformPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.platformPage.bringToFront();
    return { title: await this.platformPage.title(), url: this.platformPage.url() };
  }

  requirePlatformPage() {
    if (!this.platformPage || this.platformPage.isClosed()) throw new Error('Open the TPP platform from the dashboard first.');
    return this.platformPage;
  }

  async inspectPlatform() {
    const page = this.requirePlatformPage();
    const controls = await page.evaluate(() => {
      function compact(text) { return (text || '').replace(/\s+/g, ' ').trim(); }
      function labelText(el) {
        const explicit = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        const wrapping = el.closest('label');
        let smallParent = el.parentElement;
        while (smallParent && compact(smallParent.innerText).length < 3) smallParent = smallParent.parentElement;
        const parentText = smallParent && compact(smallParent.innerText).length < 500 ? compact(smallParent.innerText) : '';
        return compact([explicit?.innerText, wrapping?.innerText, el.getAttribute('aria-label'), parentText].filter(Boolean).join(' | '));
      }
      return [...document.querySelectorAll('input, textarea, select')]
        .filter((el) => el.type !== 'hidden')
        .map((el, index) => ({
          index,
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          id: el.id || '',
          name: el.name || '',
          placeholder: el.placeholder || '',
          label: labelText(el).slice(0, 500),
          value: el.value || ''
        }));
    });
    return { title: await page.title(), url: page.url(), controls };
  }

  async fillPlatform(data) {
    const page = this.requirePlatformPage();
    const result = await page.evaluate((payload) => {
      function compact(text) { return (text || '').replace(/\s+/g, ' ').trim(); }
      function visible(el) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }
      function metadata(el) {
        const explicit = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        const wrapping = el.closest('label');
        let ancestor = el.parentElement;
        while (ancestor && compact(ancestor.innerText).length < 3) ancestor = ancestor.parentElement;
        while (ancestor && compact(ancestor.innerText).length > 700) ancestor = ancestor.parentElement;
        return compact([
          explicit?.innerText,
          wrapping?.innerText,
          el.getAttribute('aria-label'),
          el.placeholder,
          el.name,
          el.id,
          ancestor?.innerText
        ].filter(Boolean).join(' | '));
      }
      const controls = [...document.querySelectorAll('input, textarea, select')]
        .filter((el) => el.type !== 'hidden' && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(el.type) && visible(el));
      const used = new Set();

      function setValue(el, value) {
        if (!el) return false;
        if (el.tagName === 'SELECT') {
          const wanted = compact(value).toLowerCase();
          const option = [...el.options].find((o) => compact(o.textContent).toLowerCase() === wanted)
            || [...el.options].find((o) => compact(o.textContent).toLowerCase().includes(wanted));
          if (!option) return false;
          el.value = option.value;
        } else {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, value ?? ''); else el.value = value ?? '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        used.add(el);
        return true;
      }

      function findBest(patterns, preferredTag) {
        let best = null;
        let bestScore = 0;
        for (const el of controls) {
          if (used.has(el)) continue;
          const meta = metadata(el);
          let score = 0;
          patterns.forEach((pattern, index) => {
            if (new RegExp(pattern, 'iu').test(meta)) score += 100 - index * 8;
          });
          if (preferredTag && el.tagName.toLowerCase() === preferredTag) score += 12;
          if (score > bestScore) { best = el; bestScore = score; }
        }
        return bestScore > 0 ? best : null;
      }

      const outcomes = [];
      function fill(name, value, patterns, preferredTag = 'textarea') {
        if (value === undefined || value === null || value === '') {
          outcomes.push({ field: name, status: 'skipped', reason: 'empty' });
          return;
        }
        const el = findBest(patterns, preferredTag);
        const ok = setValue(el, value);
        outcomes.push({
          field: name,
          status: ok ? 'filled' : 'not-found',
          control: el ? { id: el.id, name: el.name, tag: el.tagName.toLowerCase(), label: metadata(el).slice(0, 180) } : null
        });
      }

      const language = findBest(['язык\\s+сертификата', 'certificate\\s+language', 'language'], 'select');
      if (language) {
        const option = [...language.options].find((o) => /англий|english/i.test(o.textContent));
        if (option) setValue(language, option.textContent);
      }
      outcomes.push({ field: 'certificateLanguage', status: language ? 'filled' : 'not-found' });

      fill('exporter', payload.exporter, ['1[аa]?\\.?\\s*(отправитель|exporter)', 'отправитель', 'exporter']);
      fill('consignee', payload.consignee, ['2[аa]?\\.?\\s*(получатель|consignee)', 'получатель', 'consignee']);
      fill('transportRoute', payload.transportRoute, ['3\\.?\\s*(вид транспорта|means of transport)', 'вид транспорта', 'transport']);
      fill('officialUse', payload.officialUse, ['4\\.?\\s*(для служебных отметок|official use)', 'official']);
      fill('countryOfOrigin', payload.countryOfOrigin, ['5\\.?\\s*(страна происхождения|country of origin)', 'страна происхождения', 'origin']);
      fill('supplementaryDetails', payload.supplementaryDetails, ['6\\.?\\s*(дополнительные сведения|supplementary)', 'дополнительные сведения', 'supplementary']);
      fill('importingCountry', payload.importingCountry, ['импортирующ', 'importing country'], 'input');
      fill('declarationPlace', payload.declarationPlace, ['место заявления', 'place of declaration', 'город'], 'input');
      fill('declarationDate', payload.declarationDate, ['дата.*дд', 'declaration date', 'date'], 'input');

      const itemValues = payload.items || [];
      function fillSeries(field, values, patterns, preferredTag = null) {
        const candidates = controls
          .filter((el) => !used.has(el) && (!preferredTag || el.tagName.toLowerCase() === preferredTag))
          .map((el) => ({ el, meta: metadata(el) }))
          .filter(({ meta }) => patterns.some((p) => new RegExp(p, 'iu').test(meta)));
        values.forEach((value, index) => {
          if (!value) return;
          const candidate = candidates[index]?.el;
          const ok = setValue(candidate, value);
          outcomes.push({ field: `${field}[${index}]`, status: ok ? 'filled' : 'not-found' });
        });
      }

      fillSeries('description', itemValues.map((x) => x.description), ['описание товара', 'description of goods', 'description', 'goods'], 'textarea');
      fillSeries('packageCount', itemValues.map((x) => x.packageCount), ['количество мест', 'number.*packages', 'package.*count', 'places']);
      fillSeries('packageType', itemValues.map((x) => x.packageType), ['вид упаковки', 'kind.*packages', 'package.*type', 'packing']);
      fillSeries('grossWeightKg', itemValues.map((x) => x.grossWeightKg), ['gross', 'брутто']);
      fillSeries('netWeightKg', itemValues.map((x) => x.netWeightKg), ['net(?!work)', 'нетто']);

      return outcomes;
    }, data);
    await page.bringToFront();
    return { url: page.url(), outcomes: result };
  }

  async saveAndDownload() {
    const page = this.requirePlatformPage();
    const clickByText = async (pattern) => {
      const candidates = page.locator('button, input[type="button"], input[type="submit"], a');
      const count = await candidates.count();
      for (let i = 0; i < count; i += 1) {
        const el = candidates.nth(i);
        const text = `${await el.innerText().catch(() => '')} ${await el.getAttribute('value').catch(() => '')}`;
        if (pattern.test(text) && await el.isVisible().catch(() => false)) {
          await el.click();
          return true;
        }
      }
      return false;
    };

    const saved = await clickByText(/сохранить|save/i);
    if (!saved) throw new Error('Save button was not found. Use page inspection to refine the adapter.');
    await page.waitForTimeout(1200);

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    const clicked = await clickByText(/скачать.*pdf|download.*pdf|pdf/i);
    if (!clicked) return { saved: true, downloaded: false, message: 'The form was saved, but the PDF download button was not found.' };
    const download = await downloadPromise;
    if (!download) return { saved: true, downloaded: false, message: 'The PDF control was clicked, but the browser did not report a file download.' };

    const downloadsDir = path.join(this.projectDir, 'downloads');
    fs.mkdirSync(downloadsDir, { recursive: true });
    const safeName = download.suggestedFilename().replace(/[^A-Za-z0-9._-]/g, '_');
    const target = path.join(downloadsDir, safeName || `certificate-${Date.now()}.pdf`);
    await download.saveAs(target);
    return { saved: true, downloaded: true, path: target };
  }

  async close() {
    if (this.context) await this.context.close();
  }
}

module.exports = { BrowserManager };
