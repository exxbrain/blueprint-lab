# Blueprint Lab

[English version](README.md) · Публичная публикация: [GitHub Pages и свой домен](docs/deploy-github-pages.md)

Адрес публикации — `https://blueprint-lab.infinitower.com/`. GitHub Actions проверяет pull request и публикует
`dist` после успешных проверок `main`. Для первого выпуска нужно включить Pages с источником **GitHub Actions**,
задать домен в настройках репозитория и добавить DNS-запись по инструкции. Сайт публичный, пароль не требуется.

Интерактивное обучение архитектуре: короткие уроки, живые симуляции и задачи-инциденты.
Интерфейс на русском, английском и китайском: язык выбирается в шапке (или `?lang=ru|en|zh`). Тексты — `tr('русский', 'English', '中文')` из `src/i18n.ts`.

## Запуск

```bash
npm install
npm run dev
```

## Что внутри

- **Apache Kafka** (`#/kafka`): 6 уроков со встроенными симуляциями, квиз, 5 задач-инцидентов и песочница.
  Движок `src/sim/kafka/engine.ts` моделирует партиции и ключи, репликацию, ISR, high watermark, acks,
  min.insync.replicas, unclean election, consumer groups, ребалансировку, коммиты offset, дубликаты и порядок событий.
- **Путь архитектора** (`#/`, `#/profile`): главная — карта уровней как в игре. 76 задач из всех разделов разложены по
  четырём мирам (Junior → Middle → Senior → Архитектор, `src/levels.ts`); мир открывается, когда пройдены все задачи
  предыдущего. За задачи начисляется опыт (звёзды оценки добавляют бонус), у игрока растёт уровень — от Стажёра до
  Архитектора.
- **Kubernetes** (`#/kubernetes`, `#/kubernetes/lab/<id>`): урок, тест и 12 инцидентов по всем четырём мирам.
  Правите поля манифеста и смотрите посекундную модель кластера (`src/sim/k8s/engine.ts`): планировщик, пробы,
  RollingUpdate / Recreate / canary, HPA, отказы нод и зон, drain с PodDisruptionBudget, конкуренция за CPU и
  `kubectl get events`.
- **Конструктор архитектуры** (`#/builder`): граф из клиентов, балансировщиков, CDN, сервисов, очередей, кэша и хранилищ
  (PostgreSQL, Cassandra, MongoDB, Elasticsearch, ClickHouse, S3). Трафик несёт профиль нагрузки, и каждое хранилище
  обрабатывает его со своей эффективностью (`src/sim/builder/model.ts`). Свободный режим, классические задачи и задачи
  System Design с прикидкой нагрузки по DAU, а также упражнения на конкретные инструменты — Redis, CDN, Kafka,
  Cassandra, Elasticsearch, ClickHouse, S3 (`src/sim/builder/challenges.ts`). Среди задач System Design — цепочка
  «Рост» из трёх шагов, от одного сервера до миллионов пользователей, и задачи по мотивам System Design Primer
  (см. [Источники](#источники)). Это центр приложения: главная страница
  открывается живой схемой и каталогом задач, у каждой задачи своя ссылка `#/builder/<id>`. По схеме идёт живой
  трафик (`src/sim/builder/emulate.ts`): настоящие запросы (`GET /api/products/1042`, `POST /ingest`), операции блоков
  (`GET product:1042` в Redis, SQL в PostgreSQL, CQL в Cassandra, `_search` в Elasticsearch, produce в Kafka) и
  реальные ошибки там, где их предсказывает модель: 503 и таймауты при перегрузке, `too many clients`, 502 из тупика,
  неподходящее хранилище, Seq Scan, отставание консьюмеров. Журнал запросов, водопад трассы и лог каждого блока.
- **Распил монолита** (`#/monolith`): каждый проект начинается с поиска границ контекстов (стикеры Event Storming,
  `src/sim/ddd`) и карты контекстов, потом миссии. По текущей схеме распила идёт живой трафик
  (`src/sim/monolith/emulate.ts`): вызовы внутри процесса, REST между сервисами, события через брокер, саги, реплики и
  настоящие сбои — 404 без фасада, SQL в переехавшие таблицы, потерянные события без outbox, каскадные таймауты.
  Три уровня — интернет-магазин, доставка еды и интернет-банк, 16 миссий с бюджетом, оценкой решения и порядка распила. Strangler Fig по шагам — вынос модулей, отдельные БД, саги, реплики на событиях,
  outbox, circuit breakers. 27 паттернов микросервисов как инструменты, 16 стресс-тестов и проверка на лишние паттерны
  (`src/sim/monolith/model.ts`, `src/sim/monolith/patterns.ts`).

- **C4 Model** (`#/c4`): уроки, квиз и редактор диаграмм с упражнениями — контекст, контейнеры, компоненты
  и «найди ошибки» в чужой диаграмме (`src/sim/c4`).
- **Распределённые данные** (`#/data`): CAP и кворумы (N/W/R, разрывы сети, sloppy quorum, LWW против слияния)
  и Event Sourcing (сторно, перестроение проекций, снапшоты, версии событий, конкурентность) — `src/sim/cap`, `src/sim/es`.

## Как добавить модуль

1. Создать контент в `src/content/<модуль>/` (уроки — TSX-компоненты, квиз и сценарии — данные).
2. Зарегистрировать модуль в `src/content/modules.ts`.

## Проверка решаемости

```bash
npm run check
```

У каждой миссии распила и задачи конструктора есть эталонное решение. Скрипт `scripts/check.ts` прогоняет их через модели
на трёх языках и падает, если эталон не выполняет цели, не укладывается в бюджет или задача решена уже в исходном состоянии.
Последний проход сверяет, что разбор текста одинаков на всех языках: подсказки конструктора на поле
и то, какие запросы шлёт клиент в живом трафике (по его названию).

Прогресс хранится в `localStorage` (`blueprint-lab-progress`).

## Источники

Часть задач конструктора написана по мотивам задач по проектированию систем из
[System Design Primer](https://github.com/donnemartin/system-design-primer) (Donne Martin), лицензия
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): цепочка «Рост 1/3–3/3»
([scaling_aws](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/scaling_aws/README.md)),
«Поисковый робот» ([web_crawler](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/web_crawler/README.md)),
«Агрегатор личных финансов» ([mint](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/mint/README.md)),
«Рейтинг продаж» ([sales_rank](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/sales_rank/README.md))
и «Граф друзей» ([social_graph](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/social_graph/README.md)).
«Сокращатель ссылок» и «Лента новостей» перекликаются с задачами
[pastebin](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md) и
[twitter](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md).
Материал изменён: тексты написаны заново, числа пересчитаны под модель нагрузки конструктора, изображения из Primer
не используются. Под условием каждой такой задачи — ссылка на источник и лицензию.

## Лицензия

Проприетарная, все права защищены. Использование, копирование и распространение — только с письменного разрешения автора. Подробнее — в [LICENSE](LICENSE).
