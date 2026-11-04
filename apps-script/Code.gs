/**
 * FERMA — «Опросник боли»: приём ответов и оформление Google Таблицы.
 *
 * Как применить:
 *   1. Открыть таблицу → Расширения → Apps Script.
 *   2. Заменить содержимое Code.gs этим файлом, сохранить (Ctrl+S).
 *   3. Запустить функцию migrateOldRows — переставит старые строки в новый
 *      порядок колонок и превратит JSON в читаемый текст (значения не теряются).
 *      Если лист пустой — просто оформит его.
 *   4. Развернуть → Управление развёртываниями → ✏️ → Версия «Новая версия»
 *      → Развернуть.
 *
 * После сохранения в таблице появляется меню «Опросник боли» — можно запускать
 * миграцию и оформление прямо из листа, без редактора скриптов.
 *
 * URL веб-приложения не меняется, фронтенд править не нужно.
 */

const SHEET_ID = '1G09xf7tyjMuiJWhETmL7-4DqgbpTQVuYrNRpt99geZI';
const DATA_SHEET = 'Результаты';
const COMPANIES_SHEET = 'Компании';
const EMPLOYEES_SHEET = 'Сотрудники';
const DASH_SHEET = 'Дашборд';

/** KILL-SWITCH бэкенда: false — приём ответов отключён (бэк заглушен, doPost отвечает 410).
 *  Чтобы снова включить: поставить true и развернуть новую версию веб-приложения. */
const BACKEND_ENABLED = false; // бэкенд заменён на Cloudflare Worker + D1 (см. worker/README.md). Google-вариант оставлен как резерв.

const GROUPS = {
  'Г1': 'Лиды и заявки',
  'Г2': 'Клиентская поддержка',
  'Г3': 'Рутина и документы',
  'Г4': 'Знания и HR',
  'Г5': 'Склад и закупки',
  'Г6': 'Маркетинг и продажи',
  'Г7': 'Старые программы',
  'Г8': 'Управление и цифры'
};

const SIGNALS = {
  'с1':  { t: 'Названа рутина в минутах/часах', p: 2 },
  'с2':  { t: 'Ручной перенос данных между системами', p: 2 },
  'с3':  { t: 'Однотипных вопросов больше 30%', p: 2 },
  'с4':  { t: 'Заявки теряются вне рабочего времени', p: 2 },
  'с5':  { t: 'База знаний уже существует', p: 2 },
  'с6':  { t: 'Есть бюджет на автоматизацию', p: 2 },
  'с7':  { t: 'Решение принимает сам заполняющий', p: 2 },
  'с8':  { t: 'Склад в Excel, сверки вручную', p: 1 },
  'с9':  { t: 'Не знает стоимость заявки и каналов', p: 1 },
  'с10': { t: 'Нам ничего менять не нужно', p: -2 },
  'с11': { t: 'Просто интересно, планов нет', p: -2 },
  'с12': { t: 'Нет систем и бюджета на них', p: -1 }
};

/** Порядок колонок листа «Результаты». Меняя порядок — запустите setupSheet. */
const COLUMNS = [
  { title: 'ID боли',                w: 100 },
  { title: 'ID компании',            w: 100 },
  { title: 'ID сотрудника',          w: 100 },
  { title: 'Дата и время',           w: 130 },
  { title: 'Вердикт',                w: 160 },
  { title: 'Баллы',                  w: 70  },
  { title: 'Компания',               w: 180 },
  { title: 'Имя',                    w: 150 },
  { title: 'Роль',                   w: 140 },
  { title: 'Отдел',                  w: 140 },
  { title: 'Связь',                  w: 150 },
  { title: 'Сотрудники',             w: 100 },
  { title: 'Задача',                 w: 240 },
  { title: 'Что мешает',             w: 280 },
  { title: 'Что можно сделать',      w: 280 },
  { title: 'Эффект',                 w: 260 },
  { title: 'Кто страдает',           w: 200 },
  { title: 'Оценка в деньгах/часах', w: 220 },
  { title: 'Приоритетные группы',    w: 220 },
  { title: 'Группы на входе',        w: 180 },
  { title: 'Сигналы',                w: 260 },
  { title: 'Очки сигналов',          w: 80  },
  { title: 'Что уже есть',           w: 220 },
  { title: 'Аутсорс',                w: 120 },
  { title: 'Готов к демо',           w: 100 },
  { title: 'Комментарий',            w: 240 },
  { title: 'Ответ Ф1',               w: 240 },
  { title: 'Ответ Ф2',               w: 240 },
  { title: 'Ответ Ф3',               w: 240 },
  { title: 'Ответ Ф4',               w: 240 },
  { title: 'Ответ Ф5',               w: 240 },
  { title: 'Глубокая оценка',        w: 300 },
  { title: 'Сырой JSON',             w: 200 }
];

const WRAP_COLUMNS = [13, 14, 15, 16, 17, 18, 21, 23, 27, 28, 29, 30, 31, 32];

/** Служебная колонка с полным JSON — прячем, чтобы не смотреть «кишки». */
const RAW_JSON_COLUMN = COLUMNS.length;

/* ======================= СПРАВОЧНИКИ КОМПАНИЙ / СОТРУДНИКОВ ======================= */

/** Нормализует название компании: «ООО Ромашка», 'ромашка', ' ООО «Ромашка»' → 'ромашка'. */
function normalizeCompany_(name) {
  if (!name) return '';
  var s = String(name).toLowerCase().trim();
  s = s.replace(/^(ооо|оао|зао|пао|ао|ип|нко|тоо|llc|ltd|inc|gmbh)\s*/i, '');
  s = s.replace(/[«»"'\u00ab\u00bb]/g, '');
  s = s.replace(/[.,;:–—\-]\s*$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Нормализует имя сотрудника для сравнения. */
function normalizePerson_(name) {
  if (!name) return '';
  return String(name).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Формирует ключ сотрудника: нормализованное имя + отдел. */
function personKey_(name, dept) {
  return normalizePerson_(name) + '|' + normalizePerson_(dept);
}

/** Следующий ID с префиксом и нулями: cmp_0001, emp_0007, pain_0031. */
function nextId_(sheet, prefix) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return prefix + '_0001';
  var colA = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < colA.length; i++) {
    var v = String(colA[i][0] || '');
    var m = v.match(new RegExp('^' + prefix + '_(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  var n = max + 1;
  var s = String(n);
  while (s.length < 4) s = '0' + s;
  return prefix + '_' + s;
}

/** Находит или создаёт компанию по названию (с нормализацией). Возвращает {company_id, name}. */
function findOrCreateCompany_(rawName) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(COMPANIES_SHEET);
  if (!sheet) sheet = ss.insertSheet(COMPANIES_SHEET);
  var width = 7;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, width).setValues([[
      'ID компании', 'Ключ', 'Название', 'Отрасль', 'Сотрудников', 'Болей', 'Создана'
    ]]);
    sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  }
  var key = normalizeCompany_(rawName);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][1] || '').trim() === key) {
        return { company_id: String(values[i][0]), name: String(values[i][2] || rawName) };
      }
    }
  }
  var id = nextId_(sheet, 'cmp');
  var now = new Date();
  sheet.appendRow([id, key, rawName || '', '', '', 0, now]);
  return { company_id: id, name: rawName || '' };
}

/** Находит или создаёт сотрудника в рамках компании. Возвращает {employee_id}. */
function findOrCreateEmployee_(companyId, rawName, role, dept, contact) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(EMPLOYEES_SHEET);
  if (!sheet) sheet = ss.insertSheet(EMPLOYEES_SHEET);
  var width = 9;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, width).setValues([[
      'ID сотрудника', 'ID компании', 'Ключ', 'Имя', 'Роль', 'Отдел', 'Связь', 'Болей', 'Создан'
    ]]);
    sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  }
  var key = personKey_(rawName, dept);
  var lastRow = sheet.getLastRow();
  var rowIdx = -1;
  if (lastRow > 1) {
    var values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][1] || '') === companyId && String(values[i][2] || '').trim() === key) {
        rowIdx = i + 2;
        break;
      }
    }
    // мягкий поиск: совпадение роли+отдела при разных написаниях имени
    if (rowIdx < 0 && role && dept) {
      var roleNorm = normalizePerson_(role);
      var deptNorm = normalizePerson_(dept);
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][1] || '') === companyId
            && normalizePerson_(values[i][5]) === roleNorm
            && normalizePerson_(values[i][4]) === deptNorm) {
          rowIdx = i + 2;
          break;
        }
      }
    }
  }
  if (rowIdx > 0) {
    // обновим пустые поля, если пришли новые данные
    var updates = [];
    if (contact && String(sheet.getRange(rowIdx, 7).getValue()).trim() === '') updates.push({ col: 7, val: contact });
    if (role && String(sheet.getRange(rowIdx, 5).getValue()).trim() === '') updates.push({ col: 5, val: role });
    if (dept && String(sheet.getRange(rowIdx, 6).getValue()).trim() === '') updates.push({ col: 6, val: dept });
    updates.forEach(function (u) { sheet.getRange(rowIdx, u.col).setValue(u.val); });
    return { employee_id: String(sheet.getRange(rowIdx, 1).getValue()) };
  }
  var id = nextId_(sheet, 'emp');
  var now = new Date();
  sheet.appendRow([id, companyId, key, rawName || '', role || '', dept || '', contact || '', 0, now]);
  return { employee_id: id };
}

/* ======================= МЕНЮ В ТАБЛИЦЕ ======================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Опросник боли')
    .addItem('Переделать старые строки в текст', 'migrateOldRows')
    .addItem('Оформить лист и дашборд', 'setupSheet')
    .addItem('Обновить дашборд', 'buildDashboard')
    .addToUi();
}

/* ======================= ПРИЁМ ДАННЫХ ======================= */

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return text_('Error: no postData');
    }

    const data = JSON.parse(e.postData.contents);

    // --- резолвим компанию и сотрудника ---
    var companyRes = { company_id: data.company_id || '', name: data.company || data.companyName || '' };
    if (!companyRes.company_id) {
      companyRes = findOrCreateCompany_(data.company || data.companyName || '');
    }
    var empRes = { employee_id: data.employee_id || '' };
    if (!empRes.employee_id) {
      empRes = findOrCreateEmployee_(
        companyRes.company_id,
        data.contact || data.contactName || '',
        data.role || data.contactRole || '',
        data.dept || data.contactDept || '',
        data.contactInfo || ''
      );
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(DATA_SHEET);
    if (!sheet) sheet = ss.insertSheet(DATA_SHEET);
    ensureSchema_(sheet);

    var painId = data.pain_case_id || nextId_(sheet, 'pain');
    var row = buildRow_(data, { pain_case_id: painId, company_id: companyRes.company_id, employee_id: empRes.employee_id });

    sheet.appendRow(row);
    styleRow_(sheet, sheet.getLastRow());

    Logger.log('OK: ' + (companyRes.name || '') + ' / ' + (data.contact || '') + ' / ' + painId);
    return text_('OK');
  } catch (err) {
    Logger.log('doPost ERROR: ' + (err && err.stack ? err.stack : err));
    return text_('Error: ' + err);
  } finally {
    lock.releaseLock();
  }
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Приводит лист «Результаты» к схеме COLUMNS.
 * Пустой лист — оформляем. Шапка старого формата — мигрируем строки
 * (иначе новые записи легли бы в чужие колонки).
 */
function ensureSchema_(sheet) {
  const width = COLUMNS.length;
  const want = COLUMNS.map(function (c) { return c.title; });

  if (sheet.getLastRow() === 0) {
    setupSheet();
    return;
  }

  const have = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (v) { return String(v).trim(); });
  for (let i = 0; i < width; i++) {
    if (have[i] !== want[i]) {
      migrateOldRows();
      return;
    }
  }
}

function buildRow_(data, ids) {
  ids = ids || {};
  const entries = data.entries || {};
  const answers = ['Ф1', 'Ф2', 'Ф3', 'Ф4', 'Ф5'].map(function (k) { return entries[k] || ''; });
  const topGroups = (data.topGroups || []).map(function (g) {
    if (!g) return '';
    return typeof g === 'string' ? groupName_(g) : (g.name || groupName_(g.id));
  }).filter(Boolean);
  const card = data.card || {};

  return [
    ids.pain_case_id || '',
    ids.company_id || '',
    ids.employee_id || '',
    toDate_(data.timestamp),
    data.verdict || '',
    Number(data.score) || 0,
    data.company || data.companyName || '',
    data.contact || data.contactName || '',
    data.role || data.contactRole || '',
    data.dept || data.contactDept || '',
    data.contactInfo || '',
    data.staff || '',
    card.task || answers[3] || answers[0] || '',
    card.pain || '',
    card.fix || '',
    card.effect || '',
    card.who || '',
    card.cost || '',
    topGroups.join(', '),
    (data.entryGroups || []).map(groupName_).join(', '),
    formatSignals_(data.signals),
    Number(data.signalPts) || 0,
    data.has || '',
    data.outsource || '',
    demoText_(data.demo),
    data.comment || '',
    answers[0], answers[1], answers[2], answers[3], answers[4],
    formatDeep_(data.deep || {}),
    JSON.stringify(data)
  ];
}

function toDate_(v) {
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
}

function demoText_(v) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'yes' || s === 'да') return 'Да';
  if (s === 'maybe' || s === 'обсудим') return 'Обсудим';
  if (s === 'no' || s === 'нет') return 'Нет';
  return v || '';
}

function groupName_(code) {
  if (!code) return '';
  const c = String(code).trim();
  return GROUPS[c] || c;
}

function codeByName_(name) {
  const n = String(name || '').trim();
  for (const k in GROUPS) {
    if (GROUPS[k] === n) return k;
  }
  return n;
}

function splitList_(v) {
  if (!v) return [];
  return String(v).split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function formatSignals_(ids) {
  return (ids || []).map(function (id) {
    const s = SIGNALS[id];
    if (!s) return String(id);
    return (s.p > 0 ? '+' : '') + s.p + ' · ' + s.t;
  }).join('\n');
}

const DEEP_SCALE = ['Не про нас', 'Слабо', 'Есть', 'Явно'];

function formatDeep_(deep) {
  const byGroup = {};
  Object.keys(deep).forEach(function (id) {
    const v = deep[id];
    if (v === undefined || v === null || v === '' || v === 'na') return;
    const g = String(id).split('.')[0];
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(Number(v));
  });

  return Object.keys(byGroup).map(function (g) {
    const vals = byGroup[g];
    const avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    const detail = vals.map(function (v) { return DEEP_SCALE[v] || v; }).join(', ');
    return groupName_(g) + ': ср. ' + avg.toFixed(1) + ' (' + detail + ')';
  }).join('\n');
}

/* ======================= ОФОРМЛЕНИЕ ======================= */

function setupSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(DATA_SHEET);
  if (!sheet) sheet = ss.insertSheet(DATA_SHEET);

  const width = COLUMNS.length;
  if (sheet.getMaxColumns() > width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());

  const header = COLUMNS.map(function (c) { return c.title; });
  sheet.getRange(1, 1, 1, width).setValues([header]);

  sheet.getRange(1, 1, 1, width)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f2937')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  COLUMNS.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c.w); });

  // служебную колонку с полным JSON прячем — в таблице смотрим только текст
  sheet.hideColumns(RAW_JSON_COLUMN);

  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, rows, width).setVerticalAlignment('top').setFontSize(10);
  sheet.getRange(2, 1, rows, 1).setNumberFormat('dd.MM.yyyy HH:mm').setHorizontalAlignment('center');
  sheet.getRange(2, 3, rows, 1).setNumberFormat('+0;-0;0').setHorizontalAlignment('center');
  sheet.getRange(2, 17, rows, 1).setNumberFormat('+0;-0;0').setHorizontalAlignment('center');
  WRAP_COLUMNS.forEach(function (c) { sheet.getRange(2, c, rows, 1).setWrap(true); });

  applyBanding_(sheet);
  applyConditionalFormats_(sheet);

  if (!sheet.getFilter()) sheet.getRange(1, 1, 1, width).createFilter();

  setupCompaniesSheet_();
  setupEmployeesSheet_();

  buildDashboard();
}

/** Оформляет лист «Компании» (шапка, ширины, фильтр). */
function setupCompaniesSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(COMPANIES_SHEET);
  if (!sheet) sheet = ss.insertSheet(COMPANIES_SHEET);
  const width = 7;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  const header = ['ID компании', 'Ключ', 'Название', 'Отрасль', 'Сотрудников', 'Болей', 'Создана'];
  sheet.getRange(1, 1, 1, width).setValues([header]);
  sheet.getRange(1, 1, 1, width)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  [100, 60, 180, 100, 80, 60, 120].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  if (!sheet.getFilter()) sheet.getRange(1, 1, 1, width).createFilter();
}

/** Оформляет лист «Сотрудники» (шапка, ширины, фильтр). */
function setupEmployeesSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(EMPLOYEES_SHEET);
  if (!sheet) sheet = ss.insertSheet(EMPLOYEES_SHEET);
  const width = 9;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  const header = ['ID сотрудника', 'ID компании', 'Ключ', 'Имя', 'Роль', 'Отдел', 'Связь', 'Болей', 'Создан'];
  sheet.getRange(1, 1, 1, width).setValues([header]);
  sheet.getRange(1, 1, 1, width)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  [100, 100, 60, 150, 140, 140, 150, 60, 120].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  if (!sheet.getFilter()) sheet.getRange(1, 1, 1, width).createFilter();
}

function applyBanding_(sheet) {
  const width = COLUMNS.length;
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  const range = sheet.getRange(1, 1, rows + 1, width);

  // сбрасываем старые правила чередования
  range.getBandings().forEach(function (b) { b.remove(); });

  range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setFirstRowColor('#ffffff')
    .setSecondRowColor('#f7f9fc')
    .setHeaderRowColor('#1f2937')
    .setFooterRowColor(null);
}

function applyConditionalFormats_(sheet) {
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  const verdict = sheet.getRange(2, 2, rows, 1);
  const score = sheet.getRange(2, 3, rows, 1);

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('НЕ ТРАТИТЬ')
      .setBackground('#e8eaed').setFontColor('#5f6368')
      .setRanges([verdict]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('В БАЗУ')
      .setBackground('#e8f0fe').setFontColor('#1a3c8c')
      .setRanges([verdict]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('ТЁПЛЫЙ')
      .setBackground('#fef7e0').setFontColor('#b06000')
      .setRanges([verdict]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('ГОРЯЧИЙ')
      .setBackground('#fce8e6').setFontColor('#a50e0e')
      .setRanges([verdict]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#f4cccc', SpreadsheetApp.InterpolationType.NUMBER, '-4')
      .setGradientMidpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.NUMBER, '4')
      .setGradientMaxpointWithValue('#d9ead3', SpreadsheetApp.InterpolationType.NUMBER, '10')
      .setRanges([score]).build()
  ];

  sheet.setConditionalFormatRules(rules);
}

function styleRow_(sheet, row) {
  sheet.getRange(row, 1, 1, COLUMNS.length)
    .setVerticalAlignment('top')
    .setFontSize(10)
    .setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(row, 1).setNumberFormat('dd.MM.yyyy HH:mm').setHorizontalAlignment('center');
  sheet.getRange(row, 3).setNumberFormat('+0;-0;0').setHorizontalAlignment('center');
  sheet.getRange(row, 17).setNumberFormat('+0;-0;0').setHorizontalAlignment('center');
  WRAP_COLUMNS.forEach(function (c) { sheet.getRange(row, c).setWrap(true); });
}

/* ======================= ДАШБОРД ======================= */

function buildDashboard() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(DASH_SHEET);
  if (!sheet) sheet = ss.insertSheet(DASH_SHEET);
  sheet.clear();

  sheet.getRange('A1').setValue('Опросник боли — сводка')
    .setFontSize(15).setFontWeight('bold').setFontColor('#1f2937');

  const kpi = [
    ['Всего ответов', '=COUNTA(Результаты!A2:A)'],
    ['За последние 7 дней', '=COUNTIF(Результаты!D2:D,">="&(NOW()-7))'],
    ['Средний балл', '=IFERROR(ROUND(AVERAGE(Результаты!F2:F),1),0)'],
    ['Горячих лидов', '=COUNTIF(Результаты!E2:E,"*ГОРЯЧИЙ*")'],
    ['Компаний', '=COUNTA(Компании!A2:A)'],
    ['Сотрудников', '=COUNTA(Сотрудники!A2:A)']
  ];
  kpi.forEach(function (row, i) {
    const r = 3 + i;
    sheet.getRange(r, 1).setValue(row[0]).setFontColor('#5f6368');
    sheet.getRange(r, 2).setFormula(row[1]).setFontWeight('bold').setFontSize(12);
  });

  sheet.getRange('A9').setValue('По вердиктам').setFontWeight('bold');
  sheet.getRange('A10').setFormula(
    '=IFERROR(QUERY(Результаты!E2:F, "select F, count(E), avg(E) where F is not null group by F label count(E) \'Ответов\', avg(E) \'Ср. балл\'", 0), "")'
  );

  sheet.getRange('A17').setValue('По группам болей').setFontWeight('bold');
  Object.keys(GROUPS).forEach(function (code, i) {
    const name = GROUPS[code];
    const r = 18 + i;
    sheet.getRange(r, 1).setValue(name);
    sheet.getRange(r, 2).setFormula('=COUNTIF(Результаты!N2:N,"*' + name + '*")').setHorizontalAlignment('center');
    sheet.getRange(r, 3).setFormula(
      '=IFERROR(ROUND(AVERAGEIF(Результаты!N2:N,"*' + name + '*",Результаты!F2:F),1),"")'
    ).setHorizontalAlignment('center');
  });

  sheet.getRange('A27').setValue('По компаниям').setFontWeight('bold');
  sheet.getRange('A28').setValue('Компания').setFontWeight('bold');
  sheet.getRange('B28').setValue('Сотрудников').setFontWeight('bold');
  sheet.getRange('C28').setValue('Болей').setFontWeight('bold');

  sheet.getRange('A36').setValue('Лист считается автоматически по данным листа «Результаты».')
    .setFontStyle('italic').setFontColor('#80868b').setFontSize(9);

  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 110);

  sheet.getRange('A2:D2').setBorder(false, false, true, false, false, false, '#d0d0d0', SpreadsheetApp.BorderStyle.SOLID);
}

/* ======================= МИГРАЦИЯ СТАРЫХ СТРОК ======================= */

function migrateOldRows() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET);
  if (!sheet) { setupSheet(); return; }

  const firstHeader = String(sheet.getRange(1, 1).getValue()).trim();
  if (sheet.getLastRow() < 2 || firstHeader === COLUMNS[0].title) {
    setupSheet();
    return;
  }

  const width = Math.max(sheet.getLastColumn(), 28);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const rows = values.filter(function (r) {
    // мусор от curl-проверок (нет компании или нет времени) не переносим
    if (String(r[3] || '').trim() === '' && String(r[1] || '').trim() === '') return false;
    if (r[0] instanceof Date) return true;
    return String(r[0] || '').trim() !== '';
  });

  // распознаём формат: если r[1] — известный вердикт, то это текущий 28-колончный формат
  // иначе — très старый формат, где r[1]=компания, r[2]=контакт
  const VERDICTS = ['ГОРЯЧИЙ', 'ТЁПЛЫЙ', 'В БАЗУ', 'НЕ ТРАТИТЬ'];
  const isCurrent = rows.length > 0 && VERDICTS.indexOf(String(rows[0][1] || '').trim().toUpperCase()) >= 0;

  var painCounter = 0;
  const converted = rows.map(function (r) {
    var timestamp, company, contact, contactInfo, staff, entries, entryGroups, deep, signals, has, outsource, demo, comment, score, verdict, topGroups, signalPts;

    if (isCurrent) {
      timestamp = r[0];
      verdict = r[1];
      score = r[2];
      company = r[3];
      contact = r[4];
      contactInfo = r[5];
      staff = r[6];
      entries = { 'Ф1': r[21], 'Ф2': r[22], 'Ф3': r[23], 'Ф4': r[24], 'Ф5': r[25] };
      entryGroups = splitList_(r[14]);
      deep = tryParseJson_(r[26]);
      signals = splitList_(r[15]);
      has = r[17];
      outsource = r[18];
      demo = r[19];
      comment = r[20];
      topGroups = splitList_(r[13]);
      signalPts = r[16];
    } else {
      timestamp = r[0];
      company = r[1];
      contact = r[2];
      contactInfo = r[3];
      staff = r[4];
      entries = { 'Ф1': r[5], 'Ф2': r[6], 'Ф3': r[7], 'Ф4': r[8], 'Ф5': r[9] };
      entryGroups = splitList_(r[10]);
      deep = tryParseJson_(r[11]);
      signals = splitList_(r[12]);
      has = r[13];
      outsource = r[14];
      demo = r[15];
      comment = r[16];
      score = r[17];
      verdict = r[18];
      topGroups = splitList_(r[20]);
      signalPts = r[21];
    }

    painCounter++;
    var companyRes = findOrCreateCompany_(company || '');
    var empRes = findOrCreateEmployee_(companyRes.company_id, contact || '', '', '', contactInfo || '');

    var data = {
      timestamp: timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || ''),
      company: company || '',
      contact: contact || '',
      contactInfo: contactInfo || '',
      staff: staff || '',
      entries: entries,
      entryGroups: entryGroups,
      deep: deep,
      signals: signals,
      has: has || '',
      outsource: outsource || '',
      demo: demo || '',
      comment: comment || '',
      score: Number(score) || 0,
      verdict: verdict || '',
      topGroups: topGroups,
      signalPts: Number(signalPts) || 0,
      company_id: companyRes.company_id,
      employee_id: empRes.employee_id,
      pain_case_id: 'pain_' + pad4(painCounter)
    };

    return buildRow_(data, {
      pain_case_id: data.pain_case_id,
      company_id: data.company_id,
      employee_id: data.employee_id
    });
  }).sort(function (a, b) {
    return new Date(a[3] || '').getTime() - new Date(b[3] || '').getTime();
  });

  sheet.clear();
  setupSheet();

  if (converted.length) {
    sheet.getRange(2, 1, converted.length, COLUMNS.length).setValues(converted);
    for (var i = 0; i < converted.length; i++) styleRow_(sheet, i + 2);
  }
}

function tryParseJson_(v) {
  try { return JSON.parse(v || '{}'); } catch (e) { return {}; }
}

function pad4(n) {
  var s = String(n);
  while (s.length < 4) s = '0' + s;
  return s;
}

function oldToNew_(r) {
  // оставлена для обратной совместимости; используется прямая логика в migrateOldRows
  return buildRow_(r, {});
}
