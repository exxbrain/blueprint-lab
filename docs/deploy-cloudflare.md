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

Домен `pages.dev` не принадлежит вашему аккаунту, поэтому Access-приложение для него не создают вручную
(домен не выбирается в списке). Его создаёт сам проект Pages, а потом политику расширяют на основной адрес.
Названия меню — по документации Cloudflare на ноябрь 2026, панель время от времени переименовывает разделы.

1. Откройте **Zero Trust** (one.dash.cloudflare.com). При первом входе придумайте имя команды
   и выберите тариф **Free**. Cloudflare может попросить привязать карту даже для бесплатного тарифа.
2. Включите вход по коду на почту — сам он больше не включается:
   **Integrations → Identity providers → Add new identity provider → One-time PIN**.
   При желании там же добавьте вход через GitHub или Google.
3. Проект Pages: **Workers & Pages** → проект → **Settings** → **Enable access policy**.
   Это закрывает превью-адреса вида `abc123.blueprint-lab.pages.dev`.
4. У созданной политики нажмите **Manage**. Откроется приложение в **Zero Trust → Access controls → Applications** →
   **Configure**. В разделе **Public hostname** в поле **Subdomain** удалите звёздочку `*` и сохраните —
   теперь это приложение закрывает основной адрес `blueprint-lab.pages.dev`.
5. Вернитесь в проект Pages → **Settings → General** и снова нажмите **Enable access policy**.
   Должно получиться два Access-приложения: для основного адреса и для превью.
6. В обоих приложениях откройте **Policies** и проверьте правило: **Action** `Allow`,
   **Include → Emails** — ваш email и email тех, кому показываете. Срок сессии (**Session duration**),
   например, `1 month`.
7. Проверьте в приватном окне браузера: вместо сайта должна открыться страница входа
   Cloudflare. Введите email из списка — придёт код.

Источники: [One-time PIN](https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/),
[Pages: Known issues — Access на `*.pages.dev`](https://developers.cloudflare.com/pages/platform/known-issues/),
[Preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

## 3. Дальше

- Каждый пуш в `main` пересобирает сайт; если `npm run check` упадёт, сборка не опубликуется.
- Дать доступ ещё кому-то — дописать email в политики обоих приложений (Zero Trust → Access controls → Applications → Policies).
- Забрать доступ — убрать email из политик и отозвать его сессию в списке пользователей Zero Trust (**Team & Resources → Users**).
- Свой домен: проект Pages → **Custom domains**; затем **Zero Trust → Access controls → Applications → Create new application → Self-hosted and private** → **Add public hostname** с этим доменом и та же политика. Без политики страница входа появится, но не пустит.
