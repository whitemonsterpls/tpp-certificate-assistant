'use strict';

let currentData = {
  sourceName: '', certificateLanguage: 'English', exporter: '', consignee: '', transportRoute: '', officialUse: '',
  countryOfOrigin: '', supplementaryDetails: '', items: [], importingCountry: '', declarationPlace: '', declarationDate: '',
  warnings: [], sourceText: ''
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function setStatus(selector, message, type = 'neutral') {
  const el = $(selector);
  el.className = `status ${type}`;
  el.textContent = message;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function renderItems(items) {
  const root = $('#items');
  root.innerHTML = '';
  (items.length ? items : [{ number: '1', description: '', packageCount: '', packageType: '', grossWeightKg: '', netWeightKg: '' }])
    .forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.dataset.index = String(index);
      card.innerHTML = `
        <button class="remove-item" type="button" title="Удалить товар">Удалить</button>
        <label>No<input data-key="number" value="${escapeHtml(item.number || index + 1)}"></label>
        <label class="description">Description<textarea data-key="description">${escapeHtml(item.description || '')}</textarea></label>
        <label>Places<input data-key="packageCount" value="${escapeHtml(item.packageCount || '')}"></label>
        <label>Package type<input data-key="packageType" value="${escapeHtml(item.packageType || '')}"></label>
        <label>Gross kg<input data-key="grossWeightKg" value="${escapeHtml(item.grossWeightKg || '')}"></label>
        <label>Net kg<input data-key="netWeightKg" value="${escapeHtml(item.netWeightKg || '')}"></label>`;
      card.querySelector('.remove-item').addEventListener('click', () => {
        card.remove();
        renumberItems();
      });
      root.appendChild(card);
    });
}

function renumberItems() {
  [...document.querySelectorAll('.item-card')].forEach((card, index) => {
    card.dataset.index = String(index);
    const number = card.querySelector('[data-key="number"]');
    if (!number.value) number.value = String(index + 1);
  });
}

function putForm(data) {
  currentData = data;
  for (const key of ['exporter', 'consignee', 'transportRoute', 'officialUse', 'countryOfOrigin', 'supplementaryDetails', 'importingCountry', 'declarationPlace', 'declarationDate']) {
    $(`#${key}`).value = data[key] || '';
  }
  renderItems(data.items || []);
  $('#source-text').textContent = data.sourceText || '';
}

function getForm() {
  const data = { ...currentData };
  for (const key of ['exporter', 'consignee', 'transportRoute', 'officialUse', 'countryOfOrigin', 'supplementaryDetails', 'importingCountry', 'declarationPlace', 'declarationDate']) {
    data[key] = $(`#${key}`).value.trim();
  }
  data.items = [...document.querySelectorAll('.item-card')].map((card) => {
    const item = {};
    card.querySelectorAll('[data-key]').forEach((input) => { item[input.dataset.key] = input.value.trim(); });
    return item;
  });
  data.certificateLanguage = 'English';
  return data;
}

function showValidation(validation) {
  const lines = [];
  if (validation.errors?.length) lines.push(`Ошибки:\n• ${validation.errors.join('\n• ')}`);
  if (validation.warnings?.length) lines.push(`Требует проверки:\n• ${validation.warnings.join('\n• ')}`);
  if (validation.ok && !validation.warnings?.length) setStatus('#status', 'Все обязательные поля заполнены, кириллица не обнаружена.', 'good');
  else setStatus('#status', lines.join('\n\n'), validation.ok ? 'warning' : 'bad');
}

async function withButton(button, action) {
  button.disabled = true;
  try { await action(); } finally { button.disabled = false; }
}

$('#word-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('#word-name').textContent = file.name;
  await withButton(event.target.closest('label'), async () => {
    setStatus('#status', 'Разбираю заявку…');
    try {
      const result = await api('/api/parse-word', { name: file.name, data: await readAsDataUrl(file) });
      putForm(result.parsed);
      showValidation(result.validation);
    } catch (error) {
      setStatus('#status', error.message, 'bad');
    }
  });
});

$('#add-item-button').addEventListener('click', () => {
  const items = getForm().items;
  items.push({ number: String(items.length + 1), description: '', packageCount: '', packageType: '', grossWeightKg: '', netWeightKg: '' });
  renderItems(items);
});

$('#validate-button').addEventListener('click', async (event) => withButton(event.currentTarget, async () => {
  try { showValidation(await api('/api/validate', { data: getForm() })); }
  catch (error) { setStatus('#status', error.message, 'bad'); }
}));

$('#save-json-button').addEventListener('click', async (event) => withButton(event.currentTarget, async () => {
  try {
    const result = await api('/api/save-json', { data: getForm() });
    setStatus('#status', `Данные сохранены:\n${result.path}`, 'good');
  } catch (error) { setStatus('#status', error.message, 'bad'); }
}));

const savedUrl = localStorage.getItem('tpp-platform-url');
$('#platform-url').value = savedUrl || 'https://lk.tpprf.ru/docflow/';

$('#open-platform-button').addEventListener('click', async (event) => withButton(event.currentTarget, async () => {
  const url = $('#platform-url').value.trim();
  localStorage.setItem('tpp-platform-url', url);
  setStatus('#platform-status', 'Открываю платформу…');
  try {
    const result = await api('/api/open-platform', { url });
    setStatus('#platform-status', `Открыта вкладка: ${result.title || result.url}\nВойдите в систему и откройте макет.`, 'good');
  } catch (error) { setStatus('#platform-status', error.message, 'bad'); }
}));

$('#inspect-platform-button').addEventListener('click', async (event) => withButton(event.currentTarget, async () => {
  try {
    const result = await api('/api/inspect-platform', {});
    const table = $('#inspection-table');
    table.innerHTML = '<thead><tr><th>#</th><th>Тип</th><th>id / name</th><th>Подпись рядом</th></tr></thead><tbody></tbody>';
    const body = table.querySelector('tbody');
    result.controls.forEach((control) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${control.index}</td><td>${escapeHtml(`${control.tag} ${control.type}`)}</td><td>${escapeHtml(control.id || control.name)}</td><td>${escapeHtml(control.label)}</td>`;
      body.appendChild(row);
    });
    $('#inspection-wrap').hidden = false;
    setStatus('#platform-status', `Найдено элементов формы: ${result.controls.length}.`, result.controls.length ? 'good' : 'warning');
  } catch (error) { setStatus('#platform-status', error.message, 'bad'); }
}));

$('#fill-platform-button').addEventListener('click', async (event) => withButton(event.currentTarget, async () => {
  try {
    const data = getForm();
    const validation = await api('/api/validate', { data });
    showValidation(validation);
    if (!validation.ok) throw new Error('Сначала исправьте ошибки проверки.');
    const result = await api('/api/fill-platform', { data });
    const filled = result.outcomes.filter((x) => x.status === 'filled').length;
    const missing = result.outcomes.filter((x) => x.status === 'not-found').map((x) => x.field);
    setStatus('#platform-status', `Заполнено полей: ${filled}.${missing.length ? `\nНе найдены: ${missing.join(', ')}.` : ''}\nПроверьте макет во вкладке платформы.`, missing.length ? 'warning' : 'good');
  } catch (error) {
    const detail = error.payload?.validation?.errors?.join('\n') || '';
    setStatus('#platform-status', `${error.message}${detail ? `\n${detail}` : ''}`, 'bad');
  }
}));

$('#save-download-button').addEventListener('click', async (event) => withButton(event.currentTarget, async () => {
  try {
    const result = await api('/api/save-download', {});
    setStatus('#platform-status', result.downloaded ? `PDF скачан:\n${result.path}` : result.message, result.downloaded ? 'good' : 'warning');
  } catch (error) { setStatus('#platform-status', error.message, 'bad'); }
}));

$('#pdf-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('#pdf-name').textContent = file.name;
  setStatus('#pdf-status', 'Проверяю PDF…');
  try {
    const result = await api('/api/verify-pdf', { data: await readAsDataUrl(file), expected: getForm() });
    const missing = result.checks.filter((x) => !x.found).map((x) => x.field);
    const lines = [
      result.cyrillic.length ? `Найдена кириллица: ${result.cyrillic.join(', ')}` : 'Кириллица не обнаружена.',
      missing.length ? `Не найдены ожидаемые значения: ${missing.join(', ')}` : 'Ключевые значения найдены.'
    ];
    setStatus('#pdf-status', lines.join('\n'), result.ok ? 'good' : 'bad');
  } catch (error) { setStatus('#pdf-status', error.message, 'bad'); }
});

renderItems([]);
