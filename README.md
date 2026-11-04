# Опросник боли — «Ferma Camp»

Статичная страница-опросник, свой бэкенд для приёма заявок (Cloudflare Worker + D1)
и страница просмотра заявок. Без Google Таблиц и без Google Apps Script.

## Что внутри

```
questionnaire/index.html      — опросник (RU): HTML + CSS + JS одним файлом, без зависимостей
questionnaire/index-en.html   — опросник (EN): английская версия того же опросника
questionnaire/guide.html      — гайд «Что обычно автоматизируют» (RU)
questionnaire/guide-en.html   — гайд «What businesses usually automate» (EN)
questionnaire/answers.html    — просмотр заявок: таблица + полная карточка заявки (по ключу)
questionnaire/robots.txt      — правила для поисковых роботов + ссылка на sitemap
questionnaire/sitemap.xml     — карта сайта (4 страницы: RU/EN)
questionnaire/404.html        — страница «не найдено»
questionnaire/og-cover.png, og-guide.png — обложки RU (1200×630) для соцсетей и мессенджеров
questionnaire/og-cover-en.png, og-guide-en.png — обложки EN
questionnaire/favicon.svg / favicon.ico / apple-touch-icon.png — иконки сайта
worker/src/index.js           — бэкенд: приём анкеты (POST /submit), список и удаление (по ключу)
worker/schema.sql             — таблица D1 (одна строка = одна анкета)
worker/wrangler.toml          — конфиг воркера и базы
worker/README.md              — пошаговая настройка бэкенда
apps-script/Code.gs           — резервный вариант: Apps Script + Google Таблица (выключен)
.github/workflows/pages.yml   — автодеплой папки questionnaire/ на GitHub Pages
```

Языковых версий две — RU и EN. Это статические копии: при изменении текстов
опросника правки нужно вносить в обе версии (`index.html` и `index-en.html`,
`guide.html` и `guide-en.html`). Кнопка RU/EN в шапке переключает версии.

## Как это работает

1. Человек проходит анкету (один проход — одна боль, группа).
2. На шаге 6 он жмёт «Отправить анкету» → браузер шлёт JSON на `POST /submit` воркера.
3. Воркер проверяет согласие на обработку ПДн и пишет строку в таблицу D1 `responses`
   (служебные колонки + весь payload в колонке `payload`).
4. Заявки смотрятся на `answers.html` — по ключу `ADMIN_KEY`.

## Живые адреса

- Сайт: `https://ai-ferma.github.io/FermaCamp/`
- Страница заявок: `https://ai-ferma.github.io/FermaCamp/answers.html`
- Воркер: `https://ferma-survey.drobik832.workers.dev`
- База D1: `ferma-survey` (`6e2ec331-14da-4e7b-aecd-c0b9bb4760ae`)

## Как опубликовать на GitHub Pages

1. Репозиторий уже содержит `.github/workflows/pages.yml`: при пуше в `master` (или `main`)
   папка `questionnaire/` выкладывается на GitHub Pages.
2. В настройках репозитория: **Settings → Pages → Source → GitHub Actions**.
3. После деплоя адрес будет вида `https://<пользователь>.github.io/<репозиторий>/`.

## Как подключить приём ответов (Cloudflare Worker + D1)

Коротко: см. `worker/README.md` — там пошагово (регистрация, `wrangler d1 create`,
`schema.sql`, секрет `ADMIN_KEY`, `wrangler deploy`).

После деплоя URL воркера вписывается в трёх местах:

- `questionnaire/index.html` — `const BACKEND_URL = 'https://...';`
- `questionnaire/index-en.html` — то же самое
- `questionnaire/answers.html` — то же самое

Пока URL пустой, кнопка отправки честно говорит, что приём не подключён, и предлагает
«Скачать JSON» — выгрузка работает всегда.

## Как смотреть ответы

Открыть `https://ai-ferma.github.io/FermaCamp/answers.html`, ввести ключ
(тот, что вводился командой `wrangler secret put ADMIN_KEY`). Дальше:

- таблица всех анкет (дата, компания, контакт, задача, баллы, вердикт);
- клик по строке — полная карточка заявки: о компании, задача, симптом, ответы по группам,
  боли по вопросам, сигналы, метрики, ограничения, оценка, согласие на обработку ПДн, полный JSON;
- «Скачать CSV», «Копировать JSON», удаление заявки (изъятие согласия).

Страница закрыта от индексации (`noindex`) и нигде не публикуется.

## Резервный вариант: Google Таблица

`apps-script/Code.gs` сохранён как запасной путь, но выключен (`BACKEND_ENABLED = false`).
Если понадобится вернуть его: развернуть Apps Script как веб-приложение и вписать его URL
в `questionnaire/index.html` и `questionnaire/index-en.html` вместо `BACKEND_URL`.

## Что умеет опросник

- Один проход — одна боль (группа), остальные группы ставятся в очередь на следующие проходы.
- Черновик сохраняется в localStorage, прогон можно продолжить без перезагрузки.
- Перед переходом к вопросам и перед отправкой — согласие на обработку персональных данных (152-ФЗ, ст. 9).
- Боль (painScore) считается отдельно от коммерческой готовности; вердикт строится по боли.
- Ссылки на гайд «Что обычно автоматизируют» — внизу шага 1 и в шаге 6.
- На шаге 4 показываются «Сильные сигналы» с объяснением вклада каждого в скоринг.
- Экспорт: JSON (машиночитаемый, для импорта обратно) и текстовый отчёт.

## Ограничения

- Данные физически на серверах Cloudflare (не РФ). Полное соответствие 152-ФЗ
  по локализации персональных данных не обеспечивается; согласие спрашивается на шаге 1 анкеты.
- Эндпоинт `/submit` открытый — в базу могут попадать технические/мусорные строки;
  они видны и удаляются на странице ответов.
- Бесплатный лимит D1 (5 ГБ) покрывает сотни тысяч анкет.
