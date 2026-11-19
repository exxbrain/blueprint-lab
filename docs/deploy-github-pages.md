# Публикация на GitHub Pages

Адрес сайта: **https://blueprint-lab.infinitower.com/**. Сайт публичный, без пароля.
GitHub Pages получает только статические файлы из `dist`; сервер и секреты авторизации не нужны.

## Что настроено в проекте

- `.github/workflows/check.yml`: Node из `.nvmrc`, `npm ci`, `npm run check`, `npm run build`.
  При push в `main` или ручном запуске на `main` успешная сборка публикуется на Pages.
  Pull request и ручной запуск на другой ветке выполняют только проверки и сборку.
- Задание `deploy` зависит от `check`, использует environment `github-pages` и штатный `GITHUB_TOKEN`
  с разрешениями `pages: write` и `id-token: write`. Отдельный токен создавать не нужно.
  Публикации выполняются последовательно, начатая публикация не отменяется новым запуском.
- `vite.config.ts`: `base: '/'` для собственного домена. Префикс `/blueprint-lab/` не используется.
- Маршруты имеют вид `#/builder/sale`: серверные перенаправления и отдельная страница `404.html` не нужны.
- Удалены Cloudflare Worker с Basic Auth и запрет индексации; `robots.txt` разрешает обход сайта.

## Первый выпуск

### 1. Включить GitHub Pages

Нужны права администратора репозитория и возможность менять DNS-зону `infinitower.com`.
Для публичного репозитория подходит GitHub Free. Для закрытого репозитория личного аккаунта нужен GitHub Pro
или другой тариф с поддержкой Pages в закрытых репозиториях. Сам сайт при этом будет публичным;
делать исходный репозиторий публичным необязательно.

В [Settings → Pages репозитория](https://github.com/exxbrain/blueprint-lab/settings/pages):

1. В **Build and deployment → Source** выбрать **GitHub Actions**.
2. В **Custom domain** указать `blueprint-lab.infinitower.com` и сохранить.
3. Если environment `github-pages` ограничивает ветки публикации, разрешить `main`.

Домен задаётся в настройках Pages. При публикации через Actions файл `CNAME` не требуется и не применяется.
Сначала добавить домен в GitHub, затем менять DNS.

### 2. Настроить DNS

В DNS-зоне `infinitower.com` добавить запись:

| Поле | Значение |
| --- | --- |
| Тип | `CNAME` |
| Имя / поддомен | `blueprint-lab` |
| Значение | `exxbrain.github.io.` |
| TTL | По умолчанию |

Если панель требует полное имя, использовать `blueprint-lab.infinitower.com`.
В значении нет `https://` и пути `/blueprint-lab`. Если для этого же имени уже есть конфликтующие записи
`A`, `AAAA` или другой `CNAME`, заменить их; записи корневого домена и других поддоменов менять не нужно.

Проверка:

```bash
dig +short CNAME blueprint-lab.infinitower.com
```

Ожидается `exxbrain.github.io.`. Распространение DNS может занять до 24 часов.

### 3. Опубликовать и включить HTTPS

1. После попадания подготовленных изменений в `main` открыть вкладку **Actions** и дождаться успешного
   **Check and deploy Pages**. Для повторного выпуска можно выбрать **Run workflow → main**.
2. В **Settings → Pages** дождаться проверки DNS и выпуска сертификата, затем включить **Enforce HTTPS**.
   Эта опция может стать доступной в течение суток после настройки домена.
3. Открыть `https://blueprint-lab.infinitower.com/` и `https://blueprint-lab.infinitower.com/#/builder`.
   Проверить загрузку схемы, смену языка и перезагрузку страницы задачи.

Если раньше репозиторий был подключён к автоматическим сборкам Cloudflare, отключить их в настройках прежнего
проекта: публикация теперь выполняется GitHub Actions, конфигурация Worker удалена. Удаление локальных файлов
само по себе не отключает уже опубликованный Worker.

Прогресс и черновики хранятся в `localStorage` браузера и привязаны к адресу сайта. Прогресс со старого домена
на новый автоматически не переносится.

## Проверка перед выпуском

```bash
npm ci
npm run check
npm run build
npm run preview
```

Проверка задач выполняется на русском, английском и китайском. `npm run preview` позволяет посмотреть
готовую сборку локально; публикацией занимается workflow.

## Источники

- [GitHub: собственный workflow для Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
- [GitHub: настройка собственного домена](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
- [GitHub: доступность Pages и публичность сайта](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
- [Vite: публикация на GitHub Pages](https://vite.dev/guide/static-deploy#github-pages).
