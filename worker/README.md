# Бэкенд анкеты: Cloudflare Worker + D1

Замена Google Таблицы. Анкета отправляет ответ в воркер, воркер пишет в базу D1.
Просмотр ответов — страница `questionnaire/answers.html` на самом сайте (пароль запрашивается там).

## Текущий деплой

- Воркер: `https://ferma-survey.drobik832.workers.dev`
- Аккаунт Cloudflare: `14a392d92c034b33e22af01668044aaf`
- База D1 `ferma-survey`: `6e2ec331-14da-4e7b-aecd-c0b9bb4760ae`
- URL уже вписан в `questionnaire/index.html`, `questionnaire/index-en.html`, `questionnaire/answers.html`.

## Настройка (один раз, ~10 минут)

Нужен: Node.js, бесплатный аккаунт [cloudflare.com](https://dash.cloudflare.com/sign-up).

```sh
cd worker
npm install -g wrangler          # или запускайте через npx (ниже)
npx wrangler login               # откроет браузер — подтверждите вход
npx wrangler d1 create ferma-survey
```

После `d1 create` в консоли появится `database_id` — вставьте его в `wrangler.toml`
вместо `ЗАМЕНИТЕ_ЭТО_ЗНАЧЕНИЕ`.

```sh
npx wrangler d1 execute ferma-survey --remote --file=schema.sql   # создать таблицу
npx wrangler secret put ADMIN_KEY                                # придумайте и введите длинный ключ
npx wrangler deploy                                              # выведет URL вида https://ferma-survey.<аккаунт>.workers.dev
```

`ADMIN_KEY` запомните — он нужен на странице просмотра ответов. Это не тот ключ,
который лежит в коде сайта: он ходит только из вашего браузера на просмотр/удаление.

## Прописать URL воркера

В трёх файлах есть переменная `BACKEND_URL` (пустая строка = приём выключен):

- `questionnaire/index.html` (~строка 2762)
- `questionnaire/index-en.html` (~строка 2761)
- `questionnaire/answers.html` (конфиг вверху файла)

Вставьте URL из шага `wrangler deploy` и закоммитьте.

## Проверка

```sh
curl https://ferma-survey.<аккаунт>.workers.dev/
# {"ok":true,"service":"survey backend"}

curl -X POST https://ferma-survey.<аккаунт>.workers.dev/submit \
  -H "Content-Type: application/json" \
  -d '{"timestamp":"2026-01-01T00:00:00Z","companyName":"Тест","pdConsent":{"given":true}}'
# {"ok":true,"id":1}
```

Потом откройте `https://ai-ferma.github.io/FermaCamp/answers.html`, введите ключ — увидите тестовую строку, удалите её кнопкой.

Домены, с которых разрешены запросы, заданы в `wrangler.toml` (`ALLOWED_ORIGINS`).

## Что где

- `src/index.js` — код воркера: POST `/submit` (запись), GET/DELETE `/answers` (по ключу).
- `schema.sql` — таблица D1 (одна строка = одна анкета, весь payload — в колонке `payload`).
- `wrangler.toml` — конфиг воркера и D1.

## Ограничения

- Данные физически на серверах Cloudflare (не РФ). Полное соответствие 152-ФЗ
  (локализация ПДн) не обеспечивается; согласие спрашивается на шаге 1 анкеты.
- Эндпоинт `/submit` открытый — в базу могут попадать технические/мусорные строки;
  они видны и удаляются на странице ответов.
- Бесплатный лимит D1 (5 ГБ) покрывает сотни тысяч анкет.
