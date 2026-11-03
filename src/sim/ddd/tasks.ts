/**
 * Этапы перед распилом: найти границы контекстов (они и станут модулями для выноса)
 * и описать отношения между контекстами (Context Map).
 */
import { tr } from '../../i18n'
import { PROJECTS } from '../monolith/projects'
import type { CardKind, DddCard, DddContext, DddTask, MapPattern, MapRelation } from './model'

const contextsOf = (projectId: string): DddContext[] =>
  PROJECTS.find((p) => p.id === projectId)!.modules.map((m) => ({ id: m.id, name: m.title, desc: m.desc }))

const card = (id: string, kind: CardKind, ctx: string, name: string, why: string): DddCard => ({ id, kind, ctx, name, why })
const rel = (id: string, upstream: string, downstream: string, answer: MapPattern, situation: string, why: string): MapRelation => ({
  id,
  upstream,
  downstream,
  answer,
  situation,
  why,
})

// ---------------- интернет-магазин ----------------

const shopContexts: DddTask = {
  type: 'partition',
  id: 'contexts',
  title: tr('Этап 1: границы контекстов', 'Stage 1: context boundaries'),
  brief: [
    tr(
      'Прежде чем пилить монолит, надо понять, **где проходят швы**. Команды провели Event Storming: выписали на стикеры события, команды, правила и термины магазина. Разложите их по **ограниченным контекстам** (Bounded Context).',
      'Before breaking up a monolith, you need to find **where the seams are**. The teams ran an Event Storming session and put the store’s events, commands, policies and terms on sticky notes. Group them into **Bounded Contexts**.',
    ),
    tr(
      'Контекст — часть бизнеса со своим языком и своими данными: внутри него слова значат одно и то же, а изменения не требуют согласования с соседями. Сколько контекстов — решите сами.',
      'A context is a part of the business with its own language and data: inside it, words mean the same thing, and changes do not need sign-off from neighbours. Decide for yourself how many contexts there are.',
    ),
  ],
  contexts: contextsOf('shop'),
  minScore: 0.8,
  cards: [
    card('pub', 'event', 'catalog', tr('Товар опубликован', 'Product published'), tr('публикация карточки — работа витрины, а не склада и не заказов', 'publishing a product page is storefront work, not warehouse or orders')),
    card('price', 'event', 'catalog', tr('Цена изменена', 'Price changed'), tr('цена — часть описания товара на витрине; заказ лишь фиксирует её на момент покупки', 'the price is part of the product’s storefront description; an order only records it at purchase time')),
    card('product', 'term', 'catalog', tr('Товар: название, фото, характеристики', 'Product: name, photos, attributes'), tr('это «товар» глазами покупателя на витрине', 'this is the “product” as the shopper sees it in the storefront')),
    card('add', 'event', 'cart', tr('Товар добавлен в корзину', 'Item added to cart'), tr('корзина живёт до оформления, её часто меняют и бросают — это не заказ', 'a cart lives until checkout and is often changed and abandoned; it is not an order')),
    card('abandon', 'event', 'cart', tr('Корзина брошена', 'Cart abandoned'), tr('брошенная корзина — событие корзины; заказа ещё не было', 'an abandoned cart is a cart event; there was no order yet')),
    card('checkout', 'command', 'orders', tr('Оформить заказ', 'Place order'), tr('с оформления начинается жизненный цикл заказа', 'the order lifecycle starts with checkout')),
    card('placed', 'event', 'orders', tr('Заказ оформлен', 'Order placed'), tr('ключевое событие контекста заказов, на него подписываются остальные', 'the key event of the orders context; everyone else subscribes to it')),
    card('cancel', 'event', 'orders', tr('Заказ отменён', 'Order cancelled'), tr('статус заказа меняют только в контексте заказов', 'only the orders context changes order status')),
    card('paid', 'event', 'payments', tr('Платёж прошёл', 'Payment succeeded'), tr('деньги, провайдер и возвраты — отдельный язык и отдельная ответственность', 'money, the provider and refunds are a separate language and a separate responsibility')),
    card('refund', 'policy', 'payments', tr('Когда заказ отменён — вернуть деньги', 'When an order is cancelled, refund the money'), tr('правило реагирует на событие заказа, но действие — возврат денег — делают платежи', 'the policy reacts to an order event, but the action, a refund, is done by payments')),
    card('reserve', 'event', 'inventory', tr('Товар зарезервирован под заказ', 'Stock reserved for order'), tr('резерв — это про остатки на складе, а не про сам заказ', 'a reservation is about warehouse stock, not about the order itself')),
    card('supply', 'event', 'inventory', tr('Поставка принята на склад', 'Delivery received at warehouse'), tr('приёмка поставок — работа склада', 'receiving deliveries is warehouse work')),
    card('stock', 'term', 'inventory', tr('Товар: остаток и ячейка хранения', 'Product: stock level and storage bin'), tr('тот же «товар», но глазами склада — со своими данными', 'the same “product”, but as the warehouse sees it, with its own data')),
    card('email', 'event', 'notifications', tr('Письмо «Заказ оформлен» отправлено', '“Order placed” email sent'), tr('шаблоны, каналы и доставка писем — общая платформенная функция', 'templates, channels and email delivery are a shared platform function')),
    card('notify', 'policy', 'notifications', tr('Когда заказ оформлен — отправить письмо', 'When an order is placed, send an email'), tr('реакция на чужое событие, а действие — отправка сообщения', 'it reacts to someone else’s event, and the action is sending a message')),
    card('signup', 'event', 'users', tr('Покупатель зарегистрировался', 'Shopper signed up'), tr('профиль и вход — отдельный контекст пользователей', 'profiles and sign-in are a separate users context')),
    card('address', 'event', 'users', tr('Адрес доставки добавлен в профиль', 'Delivery address added to profile'), tr('адреса хранятся в профиле, заказ копирует нужный при оформлении', 'addresses live in the profile; an order copies the one it needs at checkout')),
    card('revenue', 'event', 'reports', tr('Отчёт о выручке за месяц построен', 'Monthly revenue report built'), tr('отчёты читают данные всех контекстов, но сами ничего в них не меняют', 'reports read data from every context but change nothing in them')),
    card('sales', 'term', 'reports', tr('Продажи по категориям за месяц', 'Sales by category per month'), tr('агрегаты для аналитики — отдельная модель данных', 'aggregates for analytics are a separate data model')),
  ],
  hints: [
    tr('Ищите, где меняется язык: «товар» на витрине и «товар» на складе — разные вещи с разными данными.', 'Look for where the language changes: a “product” in the storefront and a “product” in the warehouse are different things with different data.'),
    tr('Правило «Когда X — сделать Y» относится к контексту, который делает Y, а не к тому, где произошло X.', 'A “When X, do Y” policy belongs to the context that does Y, not to the one where X happened.'),
    tr('Корзина и заказ похожи, но живут по-разному: корзину бросают, заказ оплачивают и доставляют.', 'A cart and an order look alike but live differently: carts get abandoned, orders get paid and delivered.'),
  ],
  debrief: [
    tr(
      'Получилось восемь контекстов — ровно те модули, которые дальше предстоит выносить. Так и работают на практике: границы ищут по языку бизнеса и событиям, а не по таблицам в базе.',
      'You got eight contexts: exactly the modules you will extract next. That is how it works in practice: boundaries come from the business language and events, not from database tables.',
    ),
    tr(
      'Одно слово в разных контекстах — разные модели: у «товара» на витрине есть фото, у «товара» на складе — ячейка. Общим остаётся только идентификатор (SKU), а не одна большая таблица на всех.',
      'One word means different models in different contexts: the storefront’s “product” has photos, the warehouse’s “product” has a bin. Only the identifier (SKU) is shared, not one big table for everyone.',
    ),
  ],
}

// ---------------- доставка еды ----------------

const foodContexts: DddTask = {
  type: 'partition',
  id: 'contexts',
  title: tr('Этап 1: границы контекстов', 'Stage 1: context boundaries'),
  brief: [
    tr(
      'В «Ложке» восемь команд правят один код. Перед распилом разложите стикеры Event Storming по **ограниченным контекстам**. Осторожно: здесь много событий, которые «выглядят как заказ», но заказу не принадлежат.',
      'Eight teams edit the same code at Spoon. Before the split, group the Event Storming stickies into **Bounded Contexts**. Careful: many events here “look like an order” but do not belong to it.',
    ),
  ],
  contexts: contextsOf('food'),
  minScore: 0.8,
  cards: [
    card('menu', 'event', 'restaurants', tr('Меню обновлено', 'Menu updated'), tr('меню ведут партнёры-рестораны в своём кабинете', 'restaurant partners maintain menus in their own portal')),
    card('stop', 'event', 'restaurants', tr('Блюдо добавлено в стоп-лист', 'Dish added to the stop list'), tr('стоп-лист — часть меню ресторана, а не заказа', 'the stop list is part of the restaurant’s menu, not of an order')),
    card('rest', 'term', 'restaurants', tr('Ресторан: часы работы и кухня', 'Restaurant: opening hours and cuisine'), tr('карточка ресторана — модель партнёрского контекста', 'the restaurant profile is the partners context’s model')),
    card('placed', 'event', 'orders', tr('Клиент оформил заказ', 'Customer placed an order'), tr('с этого события начинается заказ', 'this event starts an order')),
    card('addr', 'command', 'orders', tr('Изменить адрес доставки', 'Change delivery address'), tr('адрес — часть заказа, пока его не забрал курьер', 'the address is part of the order until the courier picks it up')),
    card('cancel', 'event', 'orders', tr('Заказ отменён клиентом', 'Order cancelled by customer'), tr('статусы заказа меняет только контекст заказов', 'only the orders context changes order statuses')),
    card('assigned', 'event', 'dispatch', tr('Курьер назначен на заказ', 'Courier assigned to order'), tr('подбор курьера — отдельная логистическая задача', 'matching a courier is a separate logistics problem')),
    card('find', 'policy', 'dispatch', tr('Когда заказ готов — найти ближайшего свободного курьера', 'When an order is ready, find the nearest free courier'), tr('действие — подбор курьера, значит, правило живёт в диспетчеризации', 'the action is matching a courier, so the policy lives in dispatch')),
    card('shift', 'term', 'dispatch', tr('Курьер: смена и статус «свободен»', 'Courier: shift and “available” status'), tr('диспетчеру нужен курьер как ресурс: свободен ли он и до какого часа работает', 'dispatch needs the courier as a resource: is he free and until when does he work')),
    card('coords', 'event', 'tracking', tr('Координаты курьера обновлены', 'Courier location updated'), tr('десятки тысяч точек в секунду — у трекинга свои данные и своя нагрузка', 'tens of thousands of points per second: tracking has its own data and load')),
    card('arrived', 'event', 'tracking', tr('Курьер прибыл к ресторану', 'Courier arrived at restaurant'), tr('это вывод из координат (геозона), то есть событие трекинга', 'it is derived from coordinates (a geofence), so it is a tracking event')),
    card('hold', 'event', 'payments', tr('Оплата удержана на карте', 'Payment held on card'), tr('удержание и списание — язык платёжного контекста', 'holds and charges are the payments context’s language')),
    card('tips', 'event', 'payments', tr('Чаевые курьеру списаны', 'Courier tip charged'), tr('чаевые — это деньги, даже если они «про курьера»', 'tips are money, even if they are “about the courier”')),
    card('release', 'policy', 'payments', tr('Когда ресторан отклонил заказ — снять удержание', 'When a restaurant rejects an order, release the hold'), tr('действие — снятие удержания денег, то есть платежи', 'the action is releasing a money hold, which is payments')),
    card('promo', 'event', 'promo', tr('Промокод применён', 'Promo code applied'), tr('правила скидок и акций меняет маркетинг, не трогая заказы', 'marketing changes discount and campaign rules without touching orders')),
    card('campaign', 'event', 'promo', tr('Акция «Первый заказ −30%» запущена', '“First order −30%” campaign launched'), tr('запуск акции — работа маркетинга', 'launching a campaign is marketing work')),
    card('rated', 'event', 'reviews', tr('Клиент оценил блюдо', 'Customer rated a dish'), tr('оценки живут после заказа и у них своя модерация', 'ratings live on after the order and have their own moderation')),
    card('rating', 'event', 'reviews', tr('Рейтинг ресторана пересчитан', 'Restaurant rating recalculated'), tr('рейтинг — производная от отзывов, его считают отзывы, а не карточка ресторана', 'a rating is derived from reviews; reviews compute it, not the restaurant profile')),
    card('push', 'event', 'notifications', tr('Push «Курьер в пути» отправлен', '“Courier on the way” push sent'), tr('доставка сообщений на телефон — платформенный контекст', 'delivering messages to phones is a platform context')),
    card('near', 'policy', 'notifications', tr('Когда курьер в 500 м — отправить push', 'When the courier is 500 m away, send a push'), tr('событие приходит из трекинга, а действие — отправить сообщение', 'the event comes from tracking, and the action is sending a message')),
  ],
  hints: [
    tr('«Курьер» встречается в трёх местах: координаты (трекинг), смена и занятость (назначение), чаевые (оплата). Это три разные модели.', '“Courier” appears in three places: coordinates (tracking), shift and availability (dispatch), tips (payments). These are three different models.'),
    tr('Рейтинг ресторана — не свойство карточки ресторана, а результат работы отзывов.', 'A restaurant rating is not a property of the restaurant profile; it is the output of reviews.'),
    tr('Правила «Когда X — сделать Y» кладите туда, где делают Y.', 'Put “When X, do Y” policies where Y is done.'),
  ],
  debrief: [
    tr(
      'Слово «курьер» оказалось в трёх контекстах с разными данными: для трекинга это точка на карте, для назначения — ресурс со сменой, для оплаты — получатель чаевых. Попытка сделать одну модель «Курьер» на всех и есть главная причина монолитной связности.',
      'The word “courier” ended up in three contexts with different data: for tracking it is a point on a map, for dispatch a resource with a shift, for payments a tip recipient. Trying to build one “Courier” model for everyone is the main source of monolithic coupling.',
    ),
  ],
}

const foodMap: DddTask = {
  type: 'map',
  id: 'context-map',
  title: tr('Этап 2: карта контекстов', 'Stage 2: context map'),
  brief: [
    tr(
      'Границы найдены. Теперь решите, **как контексты будут жить вместе**: кто от кого зависит и как защищаться от чужих моделей. Для каждой связи выберите паттерн Context Map.',
      'The boundaries are found. Now decide **how the contexts will live together**: who depends on whom and how to protect yourself from foreign models. Pick a Context Map pattern for each relationship.',
    ),
    tr('Upstream — тот, чья модель или данные нужны; downstream — тот, кто от них зависит.', 'Upstream is the side whose model or data is needed; downstream is the side that depends on it.'),
  ],
  contexts: [
    ...contextsOf('food'),
    { id: 'acquirer', name: tr('Эквайринг банка', 'Bank acquirer'), desc: tr('Внешняя система списания с карт', 'External card charging system') },
    { id: 'maps', name: tr('Картографический сервис', 'Maps service'), desc: tr('Внешние маршруты и время в пути', 'External routes and travel times') },
  ],
  relations: [
    rel(
      'acq',
      'acquirer',
      'payments',
      'acl',
      tr('API эквайринга: коды ответов вида «05», «51», статусы на английском и поля из стандарта 1990-х. Банк ради вас ничего менять не будет.', 'The acquirer API: response codes like “05”, “51”, statuses in its own terms and fields from a 1990s standard. The bank will change nothing for you.'),
      tr('чужая и неудобная модель, на которую не повлиять: переводчик на границе не даёт кодам «51» расползтись по коду оплаты', 'a foreign, awkward model you cannot influence: a translator at the boundary keeps codes like “51” from spreading through the payments code'),
    ),
    rel(
      'maps',
      'maps',
      'dispatch',
      'conformist',
      tr('Картографический сервис отдаёт маршруты и время в пути в общепринятом формате (координаты, секунды, метры). Он и так хорошо подходит.', 'The maps service returns routes and travel times in a common format (coordinates, seconds, metres). It already fits well.'),
      tr('модель внешнего сервиса стандартная и подходит как есть: переводить нечего, проще её принять', 'the external model is standard and fits as is: nothing to translate, easier to adopt it'),
    ),
    rel(
      'menu',
      'restaurants',
      'orders',
      'customer-supplier',
      tr('Заказам нужны цены и состав блюд из меню. Команда «Партнёры» своя, она планирует изменения меню с учётом того, что нужно заказам.', 'Orders need prices and dish contents from the menu. The Partners team is in-house and plans menu changes with Orders’ needs in mind.'),
      tr('upstream внутри компании и готов учитывать потребности downstream в своём бэклоге — классический Customer/Supplier', 'upstream is in-house and willing to put downstream’s needs on its backlog: classic Customer/Supplier'),
    ),
    rel(
      'events',
      'orders',
      'notifications',
      'ohs',
      tr('События заказа нужны многим: назначению, оплате, уведомлениям, отзывам, аналитике. Делать отдельную интеграцию под каждого команда заказов не успевает.', 'Order events are needed by many: dispatch, payments, notifications, reviews, analytics. The orders team cannot keep up with a custom integration for each.'),
      tr('один опубликованный и версионируемый формат событий для всех потребителей — Open Host Service с Published Language', 'one published, versioned event format for all consumers: Open Host Service with a Published Language'),
    ),
    rel(
      'separate',
      'reviews',
      'promo',
      'separate-ways',
      tr('Маркетинг предложил «скидку за отзыв». Посчитали: интеграция двух контекстов дорогая, а эффект копеечный. Решили не связывать.', 'Marketing proposed a “discount for a review”. The numbers said integrating the two contexts is expensive and the effect is tiny. They decided not to connect them.'),
      tr('связь не окупается — честнее не интегрироваться вовсе', 'the connection does not pay off, so the honest choice is not to integrate at all'),
    ),
    rel(
      'money',
      'payments',
      'promo',
      'shared-kernel',
      tr('Оплате и промокодам нужно одинаково считать деньги: копейки, округление, валюта. Две команды держат маленькую общую библиотеку Money и меняют её только вместе.', 'Payments and promo codes must handle money identically: minor units, rounding, currency. Two teams keep a small shared Money library and change it only together.'),
      tr('маленькая общая часть модели с совместным владением — Shared Kernel; главное, чтобы она оставалась маленькой', 'a small shared part of the model with joint ownership: Shared Kernel; the key is to keep it small'),
    ),
    rel(
      'checkout',
      'orders',
      'payments',
      'partnership',
      tr('Запускают новое оформление «в один клик». Заказы и Оплата планируют спринты вместе и выпускают изменения одним релизом: если опоздает одна команда, не выйдет ничего.', 'They are launching one-click checkout. Orders and Payments plan sprints together and ship changes in one release: if one team is late, nothing ships.'),
      tr('команды связаны общей целью и релизом и успевают или проваливаются вместе — Partnership', 'the teams share a goal and a release and succeed or fail together: Partnership'),
    ),
  ],
  hints: [
    tr('Внешней системе, на которую не повлиять, есть два ответа: принять её модель (если она хороша) или поставить переводчика (если она протекает и портит вашу).', 'There are two answers to an external system you cannot influence: adopt its model (if it is good) or add a translator (if it leaks and spoils yours).'),
    tr('Когда потребителей много, upstream публикует один протокол вместо интеграции под каждого.', 'When there are many consumers, upstream publishes one protocol instead of an integration for each.'),
    tr('Каждый паттерн здесь встречается ровно один раз.', 'Each pattern is used exactly once here.'),
  ],
  debrief: [
    tr(
      'Context Map — это про людей не меньше, чем про код. Customer/Supplier и Partnership описывают, как договариваются команды; ACL и Conformist — как вы живёте с тем, на что не можете повлиять; OHS — как не утонуть в интеграциях.',
      'A Context Map is about people as much as about code. Customer/Supplier and Partnership describe how teams negotiate; ACL and Conformist, how you live with what you cannot influence; OHS, how not to drown in integrations.',
    ),
  ],
}

// ---------------- интернет-банк ----------------

const bankContexts: DddTask = {
  type: 'partition',
  id: 'contexts',
  title: tr('Этап 1: границы контекстов', 'Stage 1: context boundaries'),
  brief: [
    tr(
      'В интернет-банке десять модулей и одна общая база на 200+ таблиц. Разложите стикеры Event Storming по **ограниченным контекстам**. Здесь «клиент», «документ» и «операция» значат разное в разных частях банка.',
      'The online bank has ten modules and one shared database with 200+ tables. Group the Event Storming stickies into **Bounded Contexts**. Here “customer”, “document” and “transaction” mean different things in different parts of the bank.',
    ),
  ],
  contexts: contextsOf('bank'),
  minScore: 0.8,
  cards: [
    card('opened', 'event', 'accounts', tr('Счёт открыт', 'Account opened'), tr('счета и тарифы — ядро клиентского контекста', 'accounts and tariffs are the core of the customer context')),
    card('client', 'term', 'accounts', tr('Клиент: ФИО, паспорт, тариф', 'Customer: name, passport, tariff'), tr('это «клиент» глазами ядра банка', 'this is the “customer” as the bank’s core sees it')),
    card('signed', 'event', 'documents', tr('Платёжное поручение подписано', 'Payment order signed'), tr('подпись меняет статус документа — жизненный цикл документов', 'signing changes the document status: the document lifecycle')),
    card('doc', 'term', 'documents', tr('Документ: черновик → подписан → исполнен', 'Document: draft → signed → executed'), tr('статусная модель документа — сердце этого контекста', 'the document status model is the heart of this context')),
    card('send', 'command', 'transfers', tr('Отправить перевод по номеру телефона', 'Send a transfer by phone number'), tr('пользовательский сценарий перевода — контекст переводов', 'the user’s transfer scenario is the transfers context')),
    card('done', 'event', 'transfers', tr('Перевод исполнен', 'Transfer executed'), tr('исход перевода — событие переводов, документы лишь фиксируют бумажную сторону', 'the transfer’s outcome is a transfers event; documents only record the paperwork side')),
    card('bill', 'event', 'billpay', tr('Квитанция ЖКХ оплачена', 'Utility bill paid'), tr('оплата услуг — свои поставщики, форматы и проверки', 'bill payments have their own providers, formats and checks')),
    card('provider', 'term', 'billpay', tr('Поставщик услуг: реквизиты и формат лицевого счёта', 'Service provider: bank details and account number format'), tr('каталог поставщиков нужен только оплате услуг', 'the provider catalogue is needed only by bill payments')),
    card('exhausted', 'event', 'limits', tr('Суточный лимит исчерпан', 'Daily limit reached'), tr('лимиты — отдельные правила с собственными счётчиками', 'limits are separate rules with their own counters')),
    card('changed', 'event', 'limits', tr('Клиент изменил лимит на переводы', 'Customer changed transfer limit'), tr('настройка лимитов живёт в контексте лимитов, а не в переводах', 'limit settings live in the limits context, not in transfers')),
    card('suspicious', 'event', 'antifraud', tr('Операция признана подозрительной', 'Transaction flagged as suspicious'), tr('скоринг и решение о подозрительности — антифрод', 'scoring and the suspicion decision are anti-fraud')),
    card('hold', 'policy', 'antifraud', tr('Когда сумма в 10 раз выше обычной — задержать операцию', 'When the amount is 10× the usual, hold the transaction'), tr('правило про риск и поведение клиента — антифрод', 'a rule about risk and customer behaviour is anti-fraud')),
    card('code', 'event', 'confirm', tr('Код из SMS подтверждён', 'SMS code confirmed'), tr('коды и подпись — контекст подтверждения, общий для всех операций', 'codes and signatures are the confirmation context, shared by all operations')),
    card('push', 'command', 'confirm', tr('Отправить push-код', 'Send a push code'), tr('выпуск одноразовых кодов — работа подтверждения', 'issuing one-time codes is confirmation work')),
    card('posting', 'event', 'ledger', tr('Проводка отправлена в АБС', 'Posting sent to the CBS'), tr('проводки — язык бухгалтерии АБС, его держат на границе', 'postings are the CBS accounting language, kept at the boundary')),
    card('balance', 'event', 'ledger', tr('Остаток по счёту получен из АБС', 'Account balance received from the CBS'), tr('источник правды об остатках — АБС, и разговаривает с ней шлюз', 'the CBS is the source of truth for balances, and the gateway talks to it')),
    card('offer', 'event', 'offers', tr('Персональное предложение показано', 'Personal offer shown'), tr('предложения и сторис — маркетинг со своими данными', 'offers and stories are marketing with its own data')),
    card('story', 'event', 'offers', tr('Сторис просмотрена', 'Story viewed'), tr('просмотры контента — маркетинговая аналитика, а не аудит', 'content views are marketing analytics, not audit')),
    card('logged', 'event', 'audit', tr('Действие пользователя записано в журнал', 'User action written to the log'), tr('неизменяемый журнал действий для комплаенса', 'an immutable activity log for compliance')),
    card('export', 'event', 'audit', tr('Выгрузка для регулятора сформирована', 'Regulatory export generated'), tr('отчётность регулятору — задача комплаенса', 'reporting to the regulator is compliance work')),
  ],
  hints: [
    tr('Перевод и платёжный документ — разные модели: перевод — сценарий клиента, документ — статусная бумага с подписью.', 'A transfer and a payment document are different models: the transfer is the customer’s scenario, the document is a status-driven paper with a signature.'),
    tr('Лимиты и антифрод оба «про риск», но лимиты — жёсткие счётчики, а антифрод — скоринг поведения.', 'Limits and anti-fraud are both “about risk”, but limits are hard counters while anti-fraud scores behaviour.'),
    tr('Всё, что говорит языком проводок и остатков АБС, держите в одном месте на границе.', 'Keep everything that speaks the CBS language of postings and balances in one place at the boundary.'),
  ],
  debrief: [
    tr(
      'В банке границы особенно важны: ядро (счета, документы) меняется медленно и под надзором, а переводы, предложения и антифрод — быстро. Правильные контексты позволяют релизить быстрые части, не трогая медленные.',
      'Boundaries matter especially in a bank: the core (accounts, documents) changes slowly and under supervision, while transfers, offers and anti-fraud change fast. The right contexts let you release the fast parts without touching the slow ones.',
    ),
  ],
}

const bankMap: DddTask = {
  type: 'map',
  id: 'context-map',
  title: tr('Этап 2: карта контекстов', 'Stage 2: context map'),
  brief: [
    tr(
      'Опишите отношения между контекстами банка и внешними системами. Для каждой связи выберите паттерн Context Map.',
      'Describe the relationships between the bank’s contexts and external systems. Pick a Context Map pattern for each relationship.',
    ),
  ],
  contexts: [
    ...contextsOf('bank'),
    { id: 'cbs', name: tr('АБС', 'CBS'), desc: tr('Автоматизированная банковская система, внешняя', 'Core banking system, external') },
    { id: 'aggregator', name: tr('Агрегатор платежей', 'Payment aggregator'), desc: tr('Внешний агрегатор поставщиков услуг', 'External aggregator of service providers') },
  ],
  relations: [
    rel(
      'cbs',
      'cbs',
      'ledger',
      'acl',
      tr('АБС 20 лет: план счетов, проводки, коды операций и даты в своём формате. Её модель нельзя пускать дальше шлюза.', 'The CBS is 20 years old: chart of accounts, postings, operation codes and dates in its own format. Its model must not go beyond the gateway.'),
      tr('шлюз АБС и есть Anticorruption Layer: остальной банк говорит о переводах и остатках, а не о балансовых счетах', 'the CBS gateway is the Anticorruption Layer: the rest of the bank talks about transfers and balances, not ledger accounts'),
    ),
    rel(
      'agg',
      'aggregator',
      'billpay',
      'conformist',
      tr('Агрегатор подключает тысячи поставщиков и задаёт единый формат реквизитов. Банк — один из сотен клиентов, и формат хорошо описан.', 'The aggregator connects thousands of providers and defines one format for payment details. The bank is one of hundreds of clients, and the format is well documented.'),
      tr('повлиять нельзя, а модель агрегатора и есть язык этой предметной области — разумно принять её как есть', 'you cannot influence it, and the aggregator’s model is the language of this domain: sensible to adopt it as is'),
    ),
    rel(
      'score',
      'antifraud',
      'transfers',
      'customer-supplier',
      tr('Переводам нужен быстрый скоринг. Команда «Риски» своя, она вносит требования переводов в план и договаривается о сроках.', 'Transfers need fast scoring. The Risk team is in-house; it puts Transfers’ requirements into its plan and agrees on deadlines.'),
      tr('upstream внутри банка учитывает нужды downstream — Customer/Supplier', 'the in-house upstream takes downstream’s needs into account: Customer/Supplier'),
    ),
    rel(
      'docs',
      'documents',
      'audit',
      'ohs',
      tr('Статусы документов нужны переводам, оплате услуг, аудиту и уведомлениям. Документы публикуют одну схему событий для всех.', 'Document statuses are needed by transfers, bill payments, audit and notifications. Documents publish one event schema for all.'),
      tr('много потребителей и один опубликованный протокол — Open Host Service / Published Language', 'many consumers and one published protocol: Open Host Service / Published Language'),
    ),
    rel(
      'apart',
      'offers',
      'audit',
      'separate-ways',
      tr('Аудиторы попросили журналировать просмотры сторис. Юристы подтвердили, что регулятору это не нужно.', 'Auditors asked to log story views. Legal confirmed the regulator does not need this.'),
      tr('интеграция никому не нужна — Separate Ways', 'no one needs the integration: Separate Ways'),
    ),
    rel(
      'risk',
      'limits',
      'antifraud',
      'shared-kernel',
      tr('Лимитам и антифроду нужна одна и та же модель «операция для оценки риска»: сумма, канал, устройство, получатель. Её держат в маленькой общей библиотеке.', 'Limits and anti-fraud need the same “transaction for risk assessment” model: amount, channel, device, recipient. They keep it in a small shared library.'),
      tr('общая небольшая модель под совместным контролем — Shared Kernel', 'a small shared model under joint control: Shared Kernel'),
    ),
    rel(
      'qr',
      'confirm',
      'transfers',
      'partnership',
      tr('Запускают оплату по QR: переводы и подтверждение меняют протокол одновременно и выходят одним релизом к дате регулятора.', 'They are launching QR payments: transfers and confirmation change the protocol at the same time and ship in one release by the regulator’s deadline.'),
      tr('общая цель и общий срок, успех один на двоих — Partnership', 'a shared goal and deadline, one success for both: Partnership'),
    ),
  ],
  hints: [
    tr('Если модель внешней системы старая и неудобная — нужен переводчик; если стандартная и хорошая — её принимают.', 'If an external system’s model is old and awkward, you need a translator; if it is standard and good, you adopt it.'),
    tr('Каждый паттерн здесь встречается ровно один раз.', 'Each pattern is used exactly once here.'),
  ],
  debrief: [
    tr(
      'Шлюз АБС, который в распиле выносится одним из первых, — это и есть Anticorruption Layer. Карта контекстов заранее говорит, какие связи станут событиями, какие — синхронными вызовами, а какие можно просто убрать.',
      'The CBS gateway, one of the first things extracted in the split, is exactly the Anticorruption Layer. A context map tells you in advance which links become events, which stay synchronous calls and which you can simply remove.',
    ),
  ],
}

/** Этапы проекта распила до миссий */
export const DDD_STAGES: Record<string, DddTask[]> = {
  shop: [shopContexts],
  food: [foodContexts, foodMap],
  bank: [bankContexts, bankMap],
}
