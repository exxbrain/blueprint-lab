import { tr } from '../../i18n'
import type { QuizQuestion } from '../types'

export const c4Quiz: QuizQuestion[] = [
  {
    q: tr('Что из этого — контейнер в терминах C4?', 'Which of these is a container in C4 terms?'),
    options: tr(
      ['Docker-образ nginx', 'База данных PostgreSQL с заказами', 'Класс OrderService', 'Команда разработки'],
      ['An nginx Docker image', 'A PostgreSQL database with orders', 'The OrderService class', 'The development team'],
    ),
    correct: 1,
    explain: tr(
      'Контейнер — отдельно запускаемое приложение или хранилище данных: SPA, мобильное приложение, сервис, база, брокер. Docker тут ни при чём, класс — уровень Code или компонент.',
      'A container is a separately runnable application or data store: SPA, mobile app, service, database, broker. Docker has nothing to do with it; a class belongs to the Code level or to a component.',
    ),
  },
  {
    q: tr('Что НЕ должно быть на диаграмме System Context?', 'What should NOT appear on a System Context diagram?'),
    options: tr(
      ['Клиент', 'Наша система', 'Платёжный провайдер', 'Kafka внутри нашей системы'],
      ['Customer', 'Our system', 'Payment provider', 'Kafka inside our system'],
    ),
    correct: 3,
    explain: tr(
      'На контексте наша система — один блок. Её внутренности (брокеры, базы, сервисы) появляются на уровне контейнеров.',
      'On the context diagram our system is a single box. Its internals (brokers, databases, services) appear at the container level.',
    ),
  },
  {
    q: tr(
      'Как направить стрелку между Backend и АБС, если Backend вызывает АБС, а та возвращает результат?',
      'Which way should the arrow between the Backend and the core banking system point if the Backend calls it and it returns a result?',
    ),
    options: tr(
      ['АБС → Backend', 'Backend → АБС', 'Двусторонняя стрелка', 'Две стрелки в обе стороны'],
      ['Core banking → Backend', 'Backend → Core banking', 'A double-headed arrow', 'Two arrows, one each way'],
    ),
    correct: 1,
    explain: tr(
      'Стрелка идёт от того, кто инициирует взаимодействие. Ответ подразумевается и отдельной стрелкой не рисуется.',
      'The arrow goes from whoever initiates the interaction. The response is implied and is not drawn as a separate arrow.',
    ),
  },
  {
    q: tr(
      'Чего не хватает связи «Мобильное приложение → Backend API» на диаграмме контейнеров?',
      'What is missing from the “Mobile app → Backend API” relationship on a Container diagram?',
    ),
    options: tr(
      ['Цвета', 'Подписи и протокола, например «вызывает API [JSON/HTTPS]»', 'Номера шага', 'Ничего, стрелки достаточно'],
      ['A colour', 'A label and a protocol, e.g. “calls the API [JSON/HTTPS]”', 'A step number', 'Nothing, the arrow is enough'],
    ),
    correct: 1,
    explain: tr(
      'На уровне контейнеров у связи есть подпись (что происходит) и технология (как). Иначе стрелка ничего не сообщает.',
      'At the container level a relationship has a label (what happens) and a technology (how). Otherwise the arrow tells you nothing.',
    ),
  },
  {
    q: tr(
      'Где на диаграмме компонентов Backend API рисуется база данных, с которой он работает?',
      'Where does the database used by the Backend API go on its Component diagram?',
    ),
    options: tr(
      [
        'Внутри границы Backend API',
        'Снаружи границы, как соседний контейнер',
        'Её не рисуют вовсе',
        'Отдельной диаграммой',
      ],
      ['Inside the Backend API boundary', 'Outside the boundary, as a neighbouring container', 'It is not drawn at all', 'On a separate diagram'],
    ),
    correct: 1,
    explain: tr(
      'Граница на диаграмме компонентов — это раскрываемый контейнер. Соседние контейнеры, с которыми компоненты работают напрямую, остаются снаружи.',
      'The boundary on a Component diagram is the container being zoomed into. Neighbouring containers the components talk to directly stay outside.',
    ),
  },
  {
    q: tr('Какие диаграммы C4 стоит поддерживать для большинства систем?', 'Which C4 diagrams are worth maintaining for most systems?'),
    options: tr(
      ['Все четыре уровня', 'Context и Container', 'Только Code', 'Только Component'],
      ['All four levels', 'Context and Container', 'Code only', 'Component only'],
    ),
    correct: 1,
    explain: tr(
      'Контекст и контейнеры дают больше всего пользы за меньшую цену. Компоненты — для сложных контейнеров, Code обычно генерируют.',
      'Context and Container give the most value for the least effort. Components are for complex containers; Code is usually generated.',
    ),
  },
  {
    q: tr(
      'Какая дополнительная диаграмма C4 показывает, на каких узлах и в каких регионах запущены контейнеры?',
      'Which supplementary C4 diagram shows which nodes and regions the containers run on?',
    ),
    options: ['System Landscape', 'Dynamic', 'Deployment', 'Component'],
    correct: 2,
    explain: tr(
      'Deployment-диаграмма отображает контейнеры на инфраструктуру: кластеры, узлы, регионы, managed-сервисы.',
      'A Deployment diagram maps containers onto infrastructure: clusters, nodes, regions, managed services.',
    ),
  },
  {
    q: tr('Чем «внешняя система» отличается от контейнера?', 'How does an “external system” differ from a container?'),
    options: tr(
      [
        'Внешняя система — серого цвета',
        'Внешнюю систему мы не разрабатываем и не разворачиваем, контейнер — часть нашей системы',
        'Внешняя система всегда REST',
        'Ничем',
      ],
      [
        'An external system is grey',
        'We neither build nor deploy an external system; a container is part of our system',
        'An external system is always REST',
        'No difference',
      ],
    ),
    correct: 1,
    explain: tr(
      'Внешняя система принадлежит другой команде или компании: мы с ней интегрируемся, но не управляем её устройством. Её рисуют за границей нашей системы.',
      'An external system belongs to another team or company: we integrate with it but do not control how it is built. It is drawn outside our system boundary.',
    ),
  },
]
