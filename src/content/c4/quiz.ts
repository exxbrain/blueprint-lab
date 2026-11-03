import { tr } from '../../i18n'
import type { QuizQuestion } from '../types'

export const c4Quiz: QuizQuestion[] = [
  {
    q: tr('Что из этого — контейнер в терминах C4?', 'Which of these is a container in C4 terms?', '以下哪一项是 C4 意义上的容器？'),
    options: tr(
      ['Docker-образ nginx', 'База данных PostgreSQL с заказами', 'Класс OrderService', 'Команда разработки'],
      ['An nginx Docker image', 'A PostgreSQL database with orders', 'The OrderService class', 'The development team'],
      ['nginx 的 Docker 镜像', '存放订单的 PostgreSQL 数据库', 'OrderService 类', '开发团队'],
    ),
    correct: 1,
    explain: tr(
      'Контейнер — отдельно запускаемое приложение или хранилище данных: SPA, мобильное приложение, сервис, база, брокер. Docker тут ни при чём, класс — уровень Code или компонент.',
      'A container is a separately runnable application or data store: SPA, mobile app, service, database, broker. Docker has nothing to do with it; a class belongs to the Code level or to a component.',
      '容器是可以单独运行的应用或数据存储：SPA、移动应用、服务、数据库、Broker。它与 Docker 无关；类属于 Code 层级或某个组件。',
    ),
  },
  {
    q: tr('Что НЕ должно быть на диаграмме System Context?', 'What should NOT appear on a System Context diagram?', 'System Context 图上不应该出现什么？'),
    options: tr(
      ['Клиент', 'Наша система', 'Платёжный провайдер', 'Kafka внутри нашей системы'],
      ['Customer', 'Our system', 'Payment provider', 'Kafka inside our system'],
      ['客户', '我们的系统', '支付服务商', '我们系统内部的 Kafka'],
    ),
    correct: 3,
    explain: tr(
      'На контексте наша система — один блок. Её внутренности (брокеры, базы, сервисы) появляются на уровне контейнеров.',
      'On the context diagram our system is a single box. Its internals (brokers, databases, services) appear at the container level.',
      '在上下文图上，我们的系统只是一个方框。它的内部结构（Broker、数据库、服务）出现在容器层级。',
    ),
  },
  {
    q: tr(
      'Как направить стрелку между Backend и АБС, если Backend вызывает АБС, а та возвращает результат?',
      'Which way should the arrow between the Backend and the core banking system point if the Backend calls it and it returns a result?',
      '如果 Backend 调用核心银行系统，而后者返回结果，那么两者之间的箭头应该指向哪个方向？',
    ),
    options: tr(
      ['АБС → Backend', 'Backend → АБС', 'Двусторонняя стрелка', 'Две стрелки в обе стороны'],
      ['Core banking → Backend', 'Backend → Core banking', 'A double-headed arrow', 'Two arrows, one each way'],
      ['核心银行系统 → Backend', 'Backend → 核心银行系统', '一条双向箭头', '两条箭头，各指一个方向'],
    ),
    correct: 1,
    explain: tr(
      'Стрелка идёт от того, кто инициирует взаимодействие. Ответ подразумевается и отдельной стрелкой не рисуется.',
      'The arrow goes from whoever initiates the interaction. The response is implied and is not drawn as a separate arrow.',
      '箭头从发起交互的一方出发。响应是隐含的，不用单独画一条箭头。',
    ),
  },
  {
    q: tr(
      'Чего не хватает связи «Мобильное приложение → Backend API» на диаграмме контейнеров?',
      'What is missing from the “Mobile app → Backend API” relationship on a Container diagram?',
      '在 Container 图上，“移动应用 → Backend API”这条关系缺少了什么？',
    ),
    options: tr(
      ['Цвета', 'Подписи и протокола, например «вызывает API [JSON/HTTPS]»', 'Номера шага', 'Ничего, стрелки достаточно'],
      ['A colour', 'A label and a protocol, e.g. “calls the API [JSON/HTTPS]”', 'A step number', 'Nothing, the arrow is enough'],
      ['颜色', '说明文字和协议，例如“调用 API [JSON/HTTPS]”', '步骤编号', '什么都不缺，有箭头就够了'],
    ),
    correct: 1,
    explain: tr(
      'На уровне контейнеров у связи есть подпись (что происходит) и технология (как). Иначе стрелка ничего не сообщает.',
      'At the container level a relationship has a label (what happens) and a technology (how). Otherwise the arrow tells you nothing.',
      '在容器层级，关系要有说明文字（发生了什么）和技术（怎么实现）。否则这条箭头什么信息也传达不了。',
    ),
  },
  {
    q: tr(
      'Где на диаграмме компонентов Backend API рисуется база данных, с которой он работает?',
      'Where does the database used by the Backend API go on its Component diagram?',
      '在 Backend API 的 Component 图上，它所使用的数据库应该画在哪里？',
    ),
    options: tr(
      [
        'Внутри границы Backend API',
        'Снаружи границы, как соседний контейнер',
        'Её не рисуют вовсе',
        'Отдельной диаграммой',
      ],
      ['Inside the Backend API boundary', 'Outside the boundary, as a neighbouring container', 'It is not drawn at all', 'On a separate diagram'],
      ['Backend API 边界之内', '边界之外，作为相邻的容器', '根本不画', '画在单独的图上'],
    ),
    correct: 1,
    explain: tr(
      'Граница на диаграмме компонентов — это раскрываемый контейнер. Соседние контейнеры, с которыми компоненты работают напрямую, остаются снаружи.',
      'The boundary on a Component diagram is the container being zoomed into. Neighbouring containers the components talk to directly stay outside.',
      'Component 图上的边界就是被展开细看的那个容器。组件直接与之交互的相邻容器留在边界之外。',
    ),
  },
  {
    q: tr('Какие диаграммы C4 стоит поддерживать для большинства систем?', 'Which C4 diagrams are worth maintaining for most systems?', '对大多数系统来说，哪些 C4 图值得持续维护？'),
    options: tr(
      ['Все четыре уровня', 'Context и Container', 'Только Code', 'Только Component'],
      ['All four levels', 'Context and Container', 'Code only', 'Component only'],
      ['全部四个层级', 'Context 和 Container', '只有 Code', '只有 Component'],
    ),
    correct: 1,
    explain: tr(
      'Контекст и контейнеры дают больше всего пользы за меньшую цену. Компоненты — для сложных контейнеров, Code обычно генерируют.',
      'Context and Container give the most value for the least effort. Components are for complex containers; Code is usually generated.',
      'Context 和 Container 投入最少、收益最大。Component 图适用于复杂的容器；Code 图通常是自动生成的。',
    ),
  },
  {
    q: tr(
      'Какая дополнительная диаграмма C4 показывает, на каких узлах и в каких регионах запущены контейнеры?',
      'Which supplementary C4 diagram shows which nodes and regions the containers run on?',
      '哪种 C4 补充图会展示容器运行在哪些节点和区域上？',
    ),
    options: ['System Landscape', 'Dynamic', 'Deployment', 'Component'],
    correct: 2,
    explain: tr(
      'Deployment-диаграмма отображает контейнеры на инфраструктуру: кластеры, узлы, регионы, managed-сервисы.',
      'A Deployment diagram maps containers onto infrastructure: clusters, nodes, regions, managed services.',
      'Deployment 图把容器映射到基础设施上：集群、节点、区域、托管服务。',
    ),
  },
  {
    q: tr('Чем «внешняя система» отличается от контейнера?', 'How does an “external system” differ from a container?', '“外部系统”和容器有什么区别？'),
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
      [
        '外部系统是灰色的',
        '外部系统不由我们开发，也不由我们部署；容器则是我们系统的一部分',
        '外部系统总是 REST',
        '没有区别',
      ],
    ),
    correct: 1,
    explain: tr(
      'Внешняя система принадлежит другой команде или компании: мы с ней интегрируемся, но не управляем её устройством. Её рисуют за границей нашей системы.',
      'An external system belongs to another team or company: we integrate with it but do not control how it is built. It is drawn outside our system boundary.',
      '外部系统属于其他团队或公司：我们与它集成，但无法控制它的内部构造。它画在我们系统的边界之外。',
    ),
  },
]
