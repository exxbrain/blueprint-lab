# Публикация на Cloudflare Pages под Cloudflare Access

Сайт собирается из закрытого репозитория и открывается только тем, чьи email вы впишете в список.
Вход — одноразовый код на почту (или через Google/GitHub). Бесплатно до 50 пользователей.

В репозитории для этого уже есть:

- `.nvmrc` — Node 22 (нужен для `npm run check`);
- `public/_headers` — `noindex` для поисковиков и долгий кэш для собранных файлов;
- `public/robots.txt` и `<meta name="robots">` — запрет индексации.

Всё остальное делается в панели Cloudflare.

## 1. Подключить репозиторий к Cloudflare Pages

1. Панель Cloudflare → **Workers & Pages** → **Create** → вкладка **Pages** → **Connect to Git**.
2. Авторизуйте GitHub. На шаге выбора доступа укажите **Only select repositories** → `exxbrain/blueprint-lab`.
3. Настройки сборки:

   | Поле | Значение |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None` (или `React (Vite)`) |
   | Build command | `npm run check && npm run build` |
   | Build output directory | `dist` |

   Зависимости Cloudflare ставит сам по `package-lock.json`. Если сборка жалуется на версию Node,
   добавьте переменную окружения `NODE_VERSION` = `22` (Settings → Variables and Secrets).
4. **Save and Deploy**. Через пару минут сайт появится по адресу вида `https://blueprint-lab.pages.dev`
   (имя может отличаться, если `blueprint-lab` занято).

Пока не сделан шаг 2, сайт открыт всем, кто знает адрес, — сделайте его сразу.

## 2. Закрыть сайт через Cloudflare Access

1. Откройте **Zero Trust** (one.dash.cloudflare.com). При первом входе придумайте имя команды
   и выберите тариф **Free**. Cloudflare может попросить привязать карту даже для бесплатного тарифа.
2. **Settings → Authentication → Login methods**: способ **One-time PIN** включён по умолчанию.
   При желании добавьте вход через GitHub или Google.
3. **Access → Applications → Add an application → Self-hosted**:
   - **Application name**: `Blueprint Lab`;
   - **Application domain** — добавьте два адреса:
     - `blueprint-lab.pages.dev` — основной сайт;
     - `*.blueprint-lab.pages.dev` — превью каждой сборки. Без этой строки адреса вида
       `abc123.blueprint-lab.pages.dev` останутся открытыми;
   - **Session duration**: например, `1 month`.
4. Политика доступа:
   - **Policy name**: `Свои`;
   - **Action**: `Allow`;
   - **Include → Emails**: ваш email и email тех, кому показываете.
5. Сохраните. Проверьте в приватном окне браузера: вместо сайта должна открыться страница входа
   Cloudflare. Введите email из списка — придёт код.

Есть и встроенная защита превью: проект Pages → **Settings → General → Access policy → Enable**.
Она закрывает только превью-адреса, поэтому основной адрес всё равно нужно добавить в шаге 3.

## 3. Дальше

- Каждый пуш в `main` пересобирает сайт; если `npm run check` упадёт, сборка не опубликуется.
- Дать доступ ещё кому-то — дописать email в политику (Access → Applications → Blueprint Lab → Policies).
- Забрать доступ — убрать email и в **Zero Trust → My Team → Users** отозвать его сессию.
- Свой домен: проект Pages → **Custom domains**; затем добавьте этот домен в Access-приложение.
