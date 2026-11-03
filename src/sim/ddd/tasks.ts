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
const rel = (id: string, upstream: string, downstream: string, answer: MapPattern, situation: string, why: string, alsoOk?: MapPattern[]): MapRelation => ({
  id,
  upstream,
  downstream,
  answer,
  situation,
  why,
  alsoOk,
})

// ---------------- интернет-магазин ----------------

const shopContexts: DddTask = {
  type: 'partition',
  id: 'contexts',
  title: tr('Этап 1: границы контекстов', 'Stage 1: context boundaries', '第 1 阶段：上下文边界'),
  brief: [
    tr(
      'Прежде чем пилить монолит, надо понять, **где проходят швы**. Команды провели Event Storming: выписали на стикеры события, команды, правила и термины магазина. Разложите их по **ограниченным контекстам** (Bounded Context).',
      'Before breaking up a monolith, you need to find **where the seams are**. The teams ran an Event Storming session and put the store’s events, commands, policies and terms on sticky notes. Group them into **Bounded Contexts**.',
      '在拆分单体之前，要先弄清楚**接缝在哪里**。团队开了一场 Event Storming 工作坊，把商店的事件、命令、策略和术语都写在了便签上。请把它们归入各个**限界上下文**（Bounded Context）。',
    ),
    tr(
      'Контекст — часть бизнеса со своим языком и своими данными: внутри него слова значат одно и то же, а изменения не требуют согласования с соседями. Сколько контекстов — решите сами.',
      'A context is a part of the business with its own language and data: inside it, words mean the same thing, and changes do not need sign-off from neighbours. Decide for yourself how many contexts there are.',
      '上下文是业务中拥有自己语言和数据的一部分：在它内部，同一个词始终表示同一件事，修改也不需要相邻上下文点头同意。一共有几个上下文，由你自己决定。',
    ),
  ],
  contexts: contextsOf('shop'),
  minScore: 0.8,
  cards: [
    card('pub', 'event', 'catalog', tr('Товар опубликован', 'Product published', '商品已上架'), tr('публикация карточки — работа витрины, а не склада и не заказов', 'publishing a product page is storefront work, not warehouse or orders', '发布商品页面是店面的工作，与仓库和订单无关')),
    card('price', 'event', 'catalog', tr('Цена изменена', 'Price changed', '价格已变更'), tr('цена — часть описания товара на витрине; заказ лишь фиксирует её на момент покупки', 'the price is part of the product’s storefront description; an order only records it at purchase time', '价格是店面商品描述的一部分；订单只是记下下单那一刻的价格')),
    card('product', 'term', 'catalog', tr('Товар: название, фото, характеристики', 'Product: name, photos, attributes', '商品：名称、照片、属性'), tr('это «товар» глазами покупателя на витрине', 'this is the “product” as the shopper sees it in the storefront', '这是顾客在店面里看到的“商品”')),
    card('add', 'event', 'cart', tr('Товар добавлен в корзину', 'Item added to cart', '商品已加入购物车'), tr('корзина живёт до оформления, её часто меняют и бросают — это не заказ', 'a cart lives until checkout and is often changed and abandoned; it is not an order', '购物车只存在到下单为止，经常被修改、被放弃；它不是订单')),
    card('abandon', 'event', 'cart', tr('Корзина брошена', 'Cart abandoned', '购物车被放弃'), tr('брошенная корзина — событие корзины; заказа ещё не было', 'an abandoned cart is a cart event; there was no order yet', '放弃购物车是购物车的事件；这时还没有订单')),
    card('checkout', 'command', 'orders', tr('Оформить заказ', 'Place order', '下单'), tr('с оформления начинается жизненный цикл заказа', 'the order lifecycle starts with checkout', '订单的生命周期从下单开始')),
    card('placed', 'event', 'orders', tr('Заказ оформлен', 'Order placed', '订单已提交'), tr('ключевое событие контекста заказов, на него подписываются остальные', 'the key event of the orders context; everyone else subscribes to it', '订单上下文的关键事件，其他上下文都订阅它')),
    card('cancel', 'event', 'orders', tr('Заказ отменён', 'Order cancelled', '订单已取消'), tr('статус заказа меняют только в контексте заказов', 'only the orders context changes order status', '只有订单上下文能修改订单状态')),
    card('paid', 'event', 'payments', tr('Платёж прошёл', 'Payment succeeded', '支付成功'), tr('деньги, провайдер и возвраты — отдельный язык и отдельная ответственность', 'money, the provider and refunds are a separate language and a separate responsibility', '资金、支付服务商和退款是另一套语言，也是另一份职责')),
    card('refund', 'policy', 'payments', tr('Когда заказ отменён — вернуть деньги', 'When an order is cancelled, refund the money', '当订单取消时，退还款项'), tr('правило реагирует на событие заказа, но действие — возврат денег — делают платежи', 'the policy reacts to an order event, but the action, a refund, is done by payments', '这条策略响应的是订单事件，但动作（退款）由支付来完成')),
    card('reserve', 'event', 'inventory', tr('Товар зарезервирован под заказ', 'Stock reserved for order', '已为订单预留库存'), tr('резерв — это про остатки на складе, а не про сам заказ', 'a reservation is about warehouse stock, not about the order itself', '预留关乎仓库库存，而不是订单本身')),
    card('supply', 'event', 'inventory', tr('Поставка принята на склад', 'Delivery received at warehouse', '到货已入库'), tr('приёмка поставок — работа склада', 'receiving deliveries is warehouse work', '收货入库是仓库的工作')),
    card('stock', 'term', 'inventory', tr('Товар: остаток и ячейка хранения', 'Product: stock level and storage bin', '商品：库存量和储位'), tr('тот же «товар», но глазами склада — со своими данными', 'the same “product”, but as the warehouse sees it, with its own data', '同样是“商品”，但这是仓库眼中的商品，有自己的数据')),
    card('email', 'event', 'notifications', tr('Письмо «Заказ оформлен» отправлено', '“Order placed” email sent', '“订单已提交”邮件已发送'), tr('шаблоны, каналы и доставка писем — общая платформенная функция', 'templates, channels and email delivery are a shared platform function', '模板、渠道和邮件投递是共用的平台功能')),
    card('notify', 'policy', 'notifications', tr('Когда заказ оформлен — отправить письмо', 'When an order is placed, send an email', '当订单提交时，发送邮件'), tr('реакция на чужое событие, а действие — отправка сообщения', 'it reacts to someone else’s event, and the action is sending a message', '它响应的是别人的事件，而动作是发送消息')),
    card('signup', 'event', 'users', tr('Покупатель зарегистрировался', 'Shopper signed up', '顾客已注册'), tr('профиль и вход — отдельный контекст пользователей', 'profiles and sign-in are a separate users context', '个人资料和登录属于独立的用户上下文')),
    card('address', 'event', 'users', tr('Адрес доставки добавлен в профиль', 'Delivery address added to profile', '收货地址已添加到个人资料'), tr('адреса хранятся в профиле, заказ копирует нужный при оформлении', 'addresses live in the profile; an order copies the one it needs at checkout', '地址保存在个人资料里；下单时，订单会复制所需的那一个')),
    card('revenue', 'event', 'reports', tr('Отчёт о выручке за месяц построен', 'Monthly revenue report built', '月度营收报表已生成'), tr('отчёты читают данные всех контекстов, но сами ничего в них не меняют', 'reports read data from every context but change nothing in them', '报表读取所有上下文的数据，但不修改其中任何内容')),
    card('sales', 'term', 'reports', tr('Продажи по категориям за месяц', 'Sales by category per month', '按品类统计的月度销售额'), tr('агрегаты для аналитики — отдельная модель данных', 'aggregates for analytics are a separate data model', '用于分析的汇总数据是另一套数据模型')),
  ],
  hints: [
    tr('Ищите, где меняется язык: «товар» на витрине и «товар» на складе — разные вещи с разными данными.', 'Look for where the language changes: a “product” in the storefront and a “product” in the warehouse are different things with different data.', '找找语言在哪里发生了变化：店面里的“商品”和仓库里的“商品”是两样东西，数据也不同。'),
    tr('Правило «Когда X — сделать Y» относится к контексту, который делает Y, а не к тому, где произошло X.', 'A “When X, do Y” policy belongs to the context that does Y, not to the one where X happened.', '“当 X 发生时，执行 Y”这类策略属于执行 Y 的上下文，而不是发生 X 的上下文。'),
    tr('Корзина и заказ похожи, но живут по-разному: корзину бросают, заказ оплачивают и доставляют.', 'A cart and an order look alike but live differently: carts get abandoned, orders get paid and delivered.', '购物车和订单看起来很像，但生命周期不同：购物车会被放弃，订单则要付款和配送。'),
  ],
  debrief: [
    tr(
      'Получилось восемь контекстов — ровно те модули, которые дальше предстоит выносить. Так и работают на практике: границы ищут по языку бизнеса и событиям, а не по таблицам в базе.',
      'You got eight contexts: exactly the modules you will extract next. That is how it works in practice: boundaries come from the business language and events, not from database tables.',
      '你得到了八个上下文，正好就是接下来要拆出去的那些模块。实践中也是这样做的：边界来自业务语言和事件，而不是数据库里的表。',
    ),
    tr(
      'Одно слово в разных контекстах — разные модели: у «товара» на витрине есть фото, у «товара» на складе — ячейка. Общим остаётся только идентификатор (SKU), а не одна большая таблица на всех.',
      'One word means different models in different contexts: the storefront’s “product” has photos, the warehouse’s “product” has a bin. Only the identifier (SKU) is shared, not one big table for everyone.',
      '同一个词在不同上下文里是不同的模型：店面里的“商品”有照片，仓库里的“商品”有储位。共享的只有标识符（SKU），而不是一张人人共用的大表。',
    ),
  ],
}

// ---------------- доставка еды ----------------

const foodContexts: DddTask = {
  type: 'partition',
  id: 'contexts',
  title: tr('Этап 1: границы контекстов', 'Stage 1: context boundaries', '第 1 阶段：上下文边界'),
  brief: [
    tr(
      'В «Ложке» восемь команд правят один код. Перед распилом разложите стикеры Event Storming по **ограниченным контекстам**. Осторожно: здесь много событий, которые «выглядят как заказ», но заказу не принадлежат.',
      'Eight teams edit the same code at Spoon. Before the split, group the Event Storming stickies into **Bounded Contexts**. Careful: many events here “look like an order” but do not belong to it.',
      '在“勺子”，八个团队在改同一份代码。拆分之前，请把 Event Storming 的便签归入各个**限界上下文**。注意：这里有很多事件“看起来像订单”，其实并不属于订单。',
    ),
  ],
  contexts: contextsOf('food'),
  minScore: 0.8,
  cards: [
    card('menu', 'event', 'restaurants', tr('Меню обновлено', 'Menu updated', '菜单已更新'), tr('меню ведут партнёры-рестораны в своём кабинете', 'restaurant partners maintain menus in their own portal', '菜单由合作餐厅在自己的商家后台里维护')),
    card('stop', 'event', 'restaurants', tr('Блюдо добавлено в стоп-лист', 'Dish added to the stop list', '菜品已加入停售清单'), tr('стоп-лист — часть меню ресторана, а не заказа', 'the stop list is part of the restaurant’s menu, not of an order', '停售清单是餐厅菜单的一部分，而不是订单的')),
    card('rest', 'term', 'restaurants', tr('Ресторан: часы работы и кухня', 'Restaurant: opening hours and cuisine', '餐厅：营业时间和菜系'), tr('карточка ресторана — модель партнёрского контекста', 'the restaurant profile is the partners context’s model', '餐厅资料是合作伙伴上下文的模型')),
    card('placed', 'event', 'orders', tr('Клиент оформил заказ', 'Customer placed an order', '顾客已下单'), tr('с этого события начинается заказ', 'this event starts an order', '订单从这个事件开始')),
    card('addr', 'command', 'orders', tr('Изменить адрес доставки', 'Change delivery address', '修改配送地址'), tr('адрес — часть заказа, пока его не забрал курьер', 'the address is part of the order until the courier picks it up', '在骑手取餐之前，地址都是订单的一部分')),
    card('cancel', 'event', 'orders', tr('Заказ отменён клиентом', 'Order cancelled by customer', '订单被顾客取消'), tr('статусы заказа меняет только контекст заказов', 'only the orders context changes order statuses', '只有订单上下文能修改订单状态')),
    card('assigned', 'event', 'dispatch', tr('Курьер назначен на заказ', 'Courier assigned to order', '已为订单指派骑手'), tr('подбор курьера — отдельная логистическая задача', 'matching a courier is a separate logistics problem', '匹配骑手是一个独立的物流问题')),
    card('find', 'policy', 'dispatch', tr('Когда заказ готов — найти ближайшего свободного курьера', 'When an order is ready, find the nearest free courier', '当订单备好时，寻找最近的空闲骑手'), tr('действие — подбор курьера, значит, правило живёт в диспетчеризации', 'the action is matching a courier, so the policy lives in dispatch', '动作是匹配骑手，所以这条策略属于调度')),
    card('shift', 'term', 'dispatch', tr('Курьер: смена и статус «свободен»', 'Courier: shift and “available” status', '骑手：班次和“空闲”状态'), tr('диспетчеру нужен курьер как ресурс: свободен ли он и до какого часа работает', 'dispatch needs the courier as a resource: is he free and until when does he work', '调度把骑手看作一种资源：他现在是否空闲、工作到几点')),
    card('coords', 'event', 'tracking', tr('Координаты курьера обновлены', 'Courier location updated', '骑手位置已更新'), tr('десятки тысяч точек в секунду — у трекинга свои данные и своя нагрузка', 'tens of thousands of points per second: tracking has its own data and load', '每秒数万个坐标点：追踪有自己的数据和负载')),
    card('arrived', 'event', 'tracking', tr('Курьер прибыл к ресторану', 'Courier arrived at restaurant', '骑手已到达餐厅'), tr('это вывод из координат (геозона), то есть событие трекинга', 'it is derived from coordinates (a geofence), so it is a tracking event', '它是根据坐标（地理围栏）推断出来的，所以是追踪事件')),
    card('hold', 'event', 'payments', tr('Оплата удержана на карте', 'Payment held on card', '已冻结卡内款项'), tr('удержание и списание — язык платёжного контекста', 'holds and charges are the payments context’s language', '冻结和扣款是支付上下文的语言')),
    card('tips', 'event', 'payments', tr('Чаевые курьеру списаны', 'Courier tip charged', '骑手小费已扣款'), tr('чаевые — это деньги, даже если они «про курьера»', 'tips are money, even if they are “about the courier”', '小费就是钱，哪怕它“和骑手有关”')),
    card('release', 'policy', 'payments', tr('Когда ресторан отклонил заказ — снять удержание', 'When a restaurant rejects an order, release the hold', '当餐厅拒单时，解除冻结'), tr('действие — снятие удержания денег, то есть платежи', 'the action is releasing a money hold, which is payments', '动作是解除资金冻结，这属于支付')),
    card('promo', 'event', 'promo', tr('Промокод применён', 'Promo code applied', '优惠码已使用'), tr('правила скидок и акций меняет маркетинг, не трогая заказы', 'marketing changes discount and campaign rules without touching orders', '营销部门修改折扣和活动规则，不会动到订单')),
    card('campaign', 'event', 'promo', tr('Акция «Первый заказ −30%» запущена', '“First order −30%” campaign launched', '“首单 −30%”活动已上线'), tr('запуск акции — работа маркетинга', 'launching a campaign is marketing work', '上线活动是营销的工作')),
    card('rated', 'event', 'reviews', tr('Клиент оценил блюдо', 'Customer rated a dish', '顾客给菜品打了分'), tr('оценки живут после заказа и у них своя модерация', 'ratings live on after the order and have their own moderation', '评分在订单结束后依然存在，并且有自己的审核')),
    card('rating', 'event', 'reviews', tr('Рейтинг ресторана пересчитан', 'Restaurant rating recalculated', '餐厅评分已重新计算'), tr('рейтинг — производная от отзывов, его считают отзывы, а не карточка ресторана', 'a rating is derived from reviews; reviews compute it, not the restaurant profile', '评分来自评价：由评价上下文计算，而不是餐厅资料')),
    card('push', 'event', 'notifications', tr('Push «Курьер в пути» отправлен', '“Courier on the way” push sent', '“骑手正在路上”推送已发送'), tr('доставка сообщений на телефон — платформенный контекст', 'delivering messages to phones is a platform context', '把消息送达手机是一个平台上下文')),
    card('near', 'policy', 'notifications', tr('Когда курьер в 500 м — отправить push', 'When the courier is 500 m away, send a push', '当骑手距离还有 500 m 时，发送推送'), tr('событие приходит из трекинга, а действие — отправить сообщение', 'the event comes from tracking, and the action is sending a message', '事件来自追踪，而动作是发送消息')),
  ],
  hints: [
    tr('«Курьер» встречается в трёх местах: координаты (трекинг), смена и занятость (назначение), чаевые (оплата). Это три разные модели.', '“Courier” appears in three places: coordinates (tracking), shift and availability (dispatch), tips (payments). These are three different models.', '“骑手”出现在三个地方：坐标（追踪）、班次和空闲状态（调度）、小费（支付）。这是三个不同的模型。'),
    tr('Рейтинг ресторана — не свойство карточки ресторана, а результат работы отзывов.', 'A restaurant rating is not a property of the restaurant profile; it is the output of reviews.', '餐厅评分不是餐厅资料的属性，而是评价的产出。'),
    tr('Правила «Когда X — сделать Y» кладите туда, где делают Y.', 'Put “When X, do Y” policies where Y is done.', '把“当 X 发生时，执行 Y”这类策略放在执行 Y 的地方。'),
  ],
  debrief: [
    tr(
      'Слово «курьер» оказалось в трёх контекстах с разными данными: для трекинга это точка на карте, для назначения — ресурс со сменой, для оплаты — получатель чаевых. Попытка сделать одну модель «Курьер» на всех и есть главная причина монолитной связности.',
      'The word “courier” ended up in three contexts with different data: for tracking it is a point on a map, for dispatch a resource with a shift, for payments a tip recipient. Trying to build one “Courier” model for everyone is the main source of monolithic coupling.',
      '“骑手”这个词出现在三个上下文里，数据各不相同：对追踪来说是地图上的一个点，对调度来说是有班次的资源，对支付来说是小费的收款人。试图建一个人人共用的“骑手”模型，正是单体耦合的主要根源。',
    ),
  ],
}

const foodMap: DddTask = {
  type: 'map',
  id: 'context-map',
  title: tr('Этап 2: карта контекстов', 'Stage 2: context map', '第 2 阶段：上下文映射图'),
  brief: [
    tr(
      'Границы найдены. Теперь решите, **как контексты будут жить вместе**: кто от кого зависит и как защищаться от чужих моделей. Для каждой связи выберите паттерн Context Map.',
      'The boundaries are found. Now decide **how the contexts will live together**: who depends on whom and how to protect yourself from foreign models. Pick a Context Map pattern for each relationship.',
      '边界已经找到。现在来决定**上下文之间如何共处**：谁依赖谁，以及如何保护自己不受外部模型侵扰。请为每条关系选择一种 Context Map 模式。',
    ),
    tr('Upstream — тот, чья модель или данные нужны; downstream — тот, кто от них зависит.', 'Upstream is the side whose model or data is needed; downstream is the side that depends on it.', '上游是模型或数据被别人需要的一方；下游是依赖它的一方。'),
  ],
  contexts: [
    ...contextsOf('food'),
    { id: 'acquirer', name: tr('Эквайринг банка', 'Bank acquirer', '银行收单'), desc: tr('Внешняя система списания с карт', 'External card charging system', '外部的银行卡扣款系统') },
    { id: 'maps', name: tr('Картографический сервис', 'Maps service', '地图服务'), desc: tr('Внешние маршруты и время в пути', 'External routes and travel times', '外部的路线和行程时间') },
  ],
  relations: [
    rel(
      'acq',
      'acquirer',
      'payments',
      'acl',
      tr('API эквайринга: коды ответов вида «05», «51», статусы на английском и поля из стандарта 1990-х. Банк ради вас ничего менять не будет.', 'The acquirer API: response codes like “05”, “51”, statuses in its own terms and fields from a 1990s standard. The bank will change nothing for you.', '收单 API：响应码形如“05”“51”，状态用的是它自己的术语，字段来自 20 世纪 90 年代的标准。银行不会为你做任何改动。'),
      tr('чужая и неудобная модель, на которую не повлиять: переводчик на границе не даёт кодам «51» расползтись по коду оплаты', 'a foreign, awkward model you cannot influence: a translator at the boundary keeps codes like “51” from spreading through the payments code', '这是一个你无法影响、又很别扭的外部模型：在边界上放一个转换层，能防止“51”这类响应码在支付代码里四处扩散'),
    ),
    rel(
      'maps',
      'maps',
      'dispatch',
      'conformist',
      tr('Картографический сервис отдаёт маршруты и время в пути в общепринятом формате (координаты, секунды, метры). Он и так хорошо подходит.', 'The maps service returns routes and travel times in a common format (coordinates, seconds, metres). It already fits well.', '地图服务以通用格式（坐标、秒、米）返回路线和行程时间，本身就很合用。'),
      tr(
        'модель внешнего сервиса стандартная и подходит как есть — проще её принять (Conformist). Но и тонкий переводчик (ACL) здесь разумен, если хотите иметь возможность сменить провайдера карт',
        'the external model is standard and fits as is, so adopting it is simplest (Conformist). A thin translator (ACL) is also reasonable here if you want to be able to switch map providers',
        '外部模型很标准，原样就能用，所以直接采用最简单（Conformist）。如果想保留更换地图服务商的可能，在这里加一层薄薄的转换层（ACL）也是合理的',
      ),
      ['acl'],
    ),
    rel(
      'menu',
      'restaurants',
      'orders',
      'customer-supplier',
      tr('Заказам нужны цены и состав блюд из меню. Команда «Партнёры» своя, она планирует изменения меню с учётом того, что нужно заказам.', 'Orders need prices and dish contents from the menu. The Partners team is in-house and plans menu changes with Orders’ needs in mind.', '订单需要菜单中的价格和菜品组成。“合作伙伴”团队是公司内部团队，规划菜单变更时会考虑订单的需求。'),
      tr('upstream внутри компании и готов учитывать потребности downstream в своём бэклоге — классический Customer/Supplier', 'upstream is in-house and willing to put downstream’s needs on its backlog: classic Customer/Supplier', '上游在公司内部，并且愿意把下游的需求放进自己的待办列表（backlog）：典型的 Customer/Supplier'),
    ),
    rel(
      'events',
      'orders',
      'notifications',
      'ohs',
      tr('События заказа нужны многим: назначению, оплате, уведомлениям, отзывам, аналитике. Делать отдельную интеграцию под каждого команда заказов не успевает.', 'Order events are needed by many: dispatch, payments, notifications, reviews, analytics. The orders team cannot keep up with a custom integration for each.', '很多方都需要订单事件：调度、支付、通知、评价、分析。订单团队没法为每一方都单独做集成。'),
      tr('один опубликованный и версионируемый формат событий для всех потребителей — Open Host Service с Published Language', 'one published, versioned event format for all consumers: Open Host Service with a Published Language', '为所有消费者提供一种公开发布、带版本的事件格式：Open Host Service 加 Published Language'),
    ),
    rel(
      'separate',
      'reviews',
      'promo',
      'separate-ways',
      tr('Маркетинг предложил «скидку за отзыв». Посчитали: интеграция двух контекстов дорогая, а эффект копеечный. Решили не связывать.', 'Marketing proposed a “discount for a review”. The numbers said integrating the two contexts is expensive and the effect is tiny. They decided not to connect them.', '营销部门提议“写评价送折扣”。算了一下：集成两个上下文成本很高，效果却微乎其微。于是决定不把它们连起来。'),
      tr('связь не окупается — честнее не интегрироваться вовсе', 'the connection does not pay off, so the honest choice is not to integrate at all', '这种联系得不偿失，所以最实在的选择是干脆不集成'),
    ),
    rel(
      'money',
      'payments',
      'promo',
      'shared-kernel',
      tr('Оплате и промокодам нужно одинаково считать деньги: копейки, округление, валюта. Две команды держат маленькую общую библиотеку Money и меняют её только вместе.', 'Payments and promo codes must handle money identically: minor units, rounding, currency. Two teams keep a small shared Money library and change it only together.', '支付和优惠码必须以完全相同的方式处理金额：最小货币单位、舍入、币种。两个团队共同维护一个小小的共享 Money 库，并且只一起修改它。'),
      tr('маленькая общая часть модели с совместным владением — Shared Kernel; главное, чтобы она оставалась маленькой', 'a small shared part of the model with joint ownership: Shared Kernel; the key is to keep it small', '模型中由双方共同拥有的一小块共享部分：Shared Kernel；关键是让它一直保持小巧'),
    ),
    rel(
      'checkout',
      'orders',
      'payments',
      'partnership',
      tr('Запускают новое оформление «в один клик». Заказы и Оплата планируют спринты вместе и выпускают изменения одним релизом: если опоздает одна команда, не выйдет ничего.', 'They are launching one-click checkout. Orders and Payments plan sprints together and ship changes in one release: if one team is late, nothing ships.', '他们正在上线“一键下单”。订单和支付一起规划迭代（sprint），并在同一个版本中发布变更：只要有一个团队延误，就什么都发布不了。'),
      tr('команды связаны общей целью и релизом и успевают или проваливаются вместе — Partnership', 'the teams share a goal and a release and succeed or fail together: Partnership', '两个团队共享目标和发布，成败与共：Partnership'),
    ),
  ],
  hints: [
    tr('Внешней системе, на которую не повлиять, есть два ответа: принять её модель (если она хороша) или поставить переводчика (если она протекает и портит вашу).', 'There are two answers to an external system you cannot influence: adopt its model (if it is good) or add a translator (if it leaks and spoils yours).', '面对一个无法影响的外部系统，有两种应对办法：采用它的模型（如果它够好），或者加一个转换层（如果它会渗进来、破坏你的模型）。'),
    tr('Когда потребителей много, upstream публикует один протокол вместо интеграции под каждого.', 'When there are many consumers, upstream publishes one protocol instead of an integration for each.', '当消费者很多时，上游会发布一个统一的协议，而不是为每个消费者单独做集成。'),
  ],
  debrief: [
    tr(
      'Context Map — это про людей не меньше, чем про код. Customer/Supplier и Partnership описывают, как договариваются команды; ACL и Conformist — как вы живёте с тем, на что не можете повлиять; OHS — как не утонуть в интеграциях.',
      'A Context Map is about people as much as about code. Customer/Supplier and Partnership describe how teams negotiate; ACL and Conformist, how you live with what you cannot influence; OHS, how not to drown in integrations.',
      '上下文映射图既关乎代码，也同样关乎人。Customer/Supplier 和 Partnership 描述团队之间如何协商；ACL 和 Conformist 描述如何与你无法影响的东西共处；OHS 则告诉你如何不被集成工作淹没。',
    ),
  ],
}

// ---------------- интернет-банк ----------------

const bankContexts: DddTask = {
  type: 'partition',
  id: 'contexts',
  title: tr('Этап 1: границы контекстов', 'Stage 1: context boundaries', '第 1 阶段：上下文边界'),
  brief: [
    tr(
      'В интернет-банке десять модулей и одна общая база на 200+ таблиц. Разложите стикеры Event Storming по **ограниченным контекстам**. Здесь «клиент», «документ» и «операция» значат разное в разных частях банка.',
      'The online bank has ten modules and one shared database with 200+ tables. Group the Event Storming stickies into **Bounded Contexts**. Here “customer”, “document” and “transaction” mean different things in different parts of the bank.',
      '这家网上银行有十个模块，共用一个有 200+ 张表的数据库。请把 Event Storming 的便签归入各个**限界上下文**。在这里，“客户”“单据”和“交易”在银行的不同部分各有不同的含义。',
    ),
  ],
  contexts: contextsOf('bank'),
  minScore: 0.8,
  cards: [
    card('opened', 'event', 'accounts', tr('Счёт открыт', 'Account opened', '账户已开立'), tr('счета и тарифы — ядро клиентского контекста', 'accounts and tariffs are the core of the customer context', '账户和资费套餐是客户上下文的核心')),
    card('client', 'term', 'accounts', tr('Клиент: ФИО, паспорт, тариф', 'Customer: name, passport, tariff', '客户：姓名、护照、资费套餐'), tr('это «клиент» глазами ядра банка', 'this is the “customer” as the bank’s core sees it', '这是银行核心眼中的“客户”')),
    card('signed', 'event', 'documents', tr('Платёжное поручение подписано', 'Payment order signed', '付款指令已签署'), tr('подпись меняет статус документа — жизненный цикл документов', 'signing changes the document status: the document lifecycle', '签署会改变单据状态：这是单据的生命周期')),
    card('doc', 'term', 'documents', tr('Документ: черновик → подписан → исполнен', 'Document: draft → signed → executed', '单据：草稿 → 已签署 → 已执行'), tr('статусная модель документа — сердце этого контекста', 'the document status model is the heart of this context', '单据的状态模型是这个上下文的核心')),
    card('send', 'command', 'transfers', tr('Отправить перевод по номеру телефона', 'Send a transfer by phone number', '按手机号转账'), tr('пользовательский сценарий перевода — контекст переводов', 'the user’s transfer scenario is the transfers context', '用户的转账场景属于转账上下文')),
    card('done', 'event', 'transfers', tr('Перевод через СБП прошёл', 'Fast Payments transfer went through', '快速支付系统转账已成功'), tr('маршрут перевода (СБП, внутри банка, на карту) и его исход — работа переводов; документ лишь фиксирует бумажную сторону', 'the transfer route (fast payments, in-bank, to a card) and its outcome are transfers work; the document only records the paperwork side', '转账路径（快速支付、行内转账、转到银行卡）及其结果都是转账的工作；单据只负责记录书面手续这一面')),
    card('bill', 'event', 'billpay', tr('Квитанция ЖКХ оплачена', 'Utility bill paid', '水电燃气账单已缴纳'), tr('оплата услуг — свои поставщики, форматы и проверки', 'bill payments have their own providers, formats and checks', '生活缴费有自己的服务商、格式和校验')),
    card('provider', 'term', 'billpay', tr('Поставщик услуг: реквизиты и формат лицевого счёта', 'Service provider: bank details and account number format', '服务商：收款信息和户号格式'), tr('каталог поставщиков нужен только оплате услуг', 'the provider catalogue is needed only by bill payments', '只有生活缴费才需要服务商目录')),
    card('exhausted', 'event', 'limits', tr('Суточный лимит исчерпан', 'Daily limit reached', '已达每日限额'), tr('лимиты — отдельные правила с собственными счётчиками', 'limits are separate rules with their own counters', '限额是一套独立的规则，有自己的计数器')),
    card('changed', 'event', 'limits', tr('Клиент изменил лимит на переводы', 'Customer changed transfer limit', '客户修改了转账限额'), tr('настройка лимитов живёт в контексте лимитов, а не в переводах', 'limit settings live in the limits context, not in transfers', '限额设置属于限额上下文，而不是转账')),
    card('suspicious', 'event', 'antifraud', tr('Операция признана подозрительной', 'Transaction flagged as suspicious', '交易被标记为可疑'), tr('скоринг и решение о подозрительности — антифрод', 'scoring and the suspicion decision are anti-fraud', '风险评分和可疑判定属于反欺诈')),
    card('hold', 'policy', 'antifraud', tr('Когда сумма в 10 раз выше обычной — задержать операцию', 'When the amount is 10× the usual, hold the transaction', '当金额是平时的 10 倍时，暂缓这笔交易'), tr('правило про риск и поведение клиента — антифрод', 'a rule about risk and customer behaviour is anti-fraud', '关于风险和客户行为的规则属于反欺诈')),
    card('code', 'event', 'confirm', tr('Код из SMS подтверждён', 'SMS code confirmed', '短信验证码已确认'), tr('коды и подпись — контекст подтверждения, общий для всех операций', 'codes and signatures are the confirmation context, shared by all operations', '验证码和签名属于确认上下文，所有操作共用')),
    card('push', 'command', 'confirm', tr('Отправить push-код', 'Send a push code', '发送推送验证码'), tr('выпуск одноразовых кодов — работа подтверждения', 'issuing one-time codes is confirmation work', '签发一次性验证码是确认的工作')),
    card('posting', 'event', 'ledger', tr('Проводка отправлена в АБС', 'Posting sent to the CBS', '记账分录已发送到核心银行系统'), tr('проводки — язык бухгалтерии АБС, его держат на границе', 'postings are the CBS accounting language, kept at the boundary', '记账分录是核心银行系统的会计语言，应把它留在边界上')),
    card('balance', 'event', 'ledger', tr('Остаток по счёту получен из АБС', 'Account balance received from the CBS', '已从核心银行系统获取账户余额'), tr('источник правды об остатках — АБС, и разговаривает с ней шлюз', 'the CBS is the source of truth for balances, and the gateway talks to it', '核心银行系统是余额的权威来源，由网关负责和它通信')),
    card('offer', 'event', 'offers', tr('Персональное предложение показано', 'Personal offer shown', '个性化优惠已展示'), tr('предложения и сторис — маркетинг со своими данными', 'offers and stories are marketing with its own data', '优惠和快拍属于营销，有自己的数据')),
    card('story', 'event', 'offers', tr('Сторис просмотрена', 'Story viewed', '快拍已被浏览'), tr('просмотры контента — маркетинговая аналитика, а не аудит', 'content views are marketing analytics, not audit', '内容浏览属于营销分析，而不是审计')),
    card('logged', 'event', 'audit', tr('Действие пользователя записано в журнал', 'User action written to the log', '用户操作已写入日志'), tr('неизменяемый журнал действий для комплаенса', 'an immutable activity log for compliance', '用于合规的不可篡改操作日志')),
    card('export', 'event', 'audit', tr('Выгрузка для регулятора сформирована', 'Regulatory export generated', '监管报送数据已生成'), tr('отчётность регулятору — задача комплаенса', 'reporting to the regulator is compliance work', '向监管机构报送是合规的工作')),
  ],
  hints: [
    tr('Перевод и платёжный документ — разные модели: перевод — сценарий клиента, документ — статусная бумага с подписью.', 'A transfer and a payment document are different models: the transfer is the customer’s scenario, the document is a status-driven paper with a signature.', '转账和付款单据是不同的模型：转账是客户的场景，单据是一份带签名、由状态驱动的文书。'),
    tr('Лимиты и антифрод оба «про риск», но лимиты — жёсткие счётчики, а антифрод — скоринг поведения.', 'Limits and anti-fraud are both “about risk”, but limits are hard counters while anti-fraud scores behaviour.', '限额和反欺诈都“和风险有关”，但限额是硬性的计数器，而反欺诈是给行为打分。'),
    tr('Всё, что говорит языком проводок и остатков АБС, держите в одном месте на границе.', 'Keep everything that speaks the CBS language of postings and balances in one place at the boundary.', '凡是说着核心银行系统那套“记账分录和余额”语言的东西，都集中放在边界上的同一个地方。'),
  ],
  debrief: [
    tr(
      'В банке границы особенно важны: ядро (счета, документы) меняется медленно и под надзором, а переводы, предложения и антифрод — быстро. Правильные контексты позволяют релизить быстрые части, не трогая медленные.',
      'Boundaries matter especially in a bank: the core (accounts, documents) changes slowly and under supervision, while transfers, offers and anti-fraud change fast. The right contexts let you release the fast parts without touching the slow ones.',
      '在银行里，边界尤其重要：核心部分（账户、单据）变化缓慢，而且受到监管；而转账、优惠和反欺诈变化很快。划对上下文，就能发布变化快的部分，而不必触碰变化慢的部分。',
    ),
  ],
}

const bankMap: DddTask = {
  type: 'map',
  id: 'context-map',
  title: tr('Этап 2: карта контекстов', 'Stage 2: context map', '第 2 阶段：上下文映射图'),
  brief: [
    tr(
      'Опишите отношения между контекстами банка и внешними системами. Для каждой связи выберите паттерн Context Map.',
      'Describe the relationships between the bank’s contexts and external systems. Pick a Context Map pattern for each relationship.',
      '描述银行各上下文与外部系统之间的关系。请为每条关系选择一种 Context Map 模式。',
    ),
  ],
  contexts: [
    ...contextsOf('bank'),
    { id: 'cbs', name: tr('АБС', 'CBS', '核心银行系统'), desc: tr('Автоматизированная банковская система, внешняя', 'Core banking system, external', '外部的核心银行系统（Core Banking System）') },
    { id: 'aggregator', name: tr('Агрегатор платежей', 'Payment aggregator', '支付聚合商'), desc: tr('Внешний агрегатор поставщиков услуг', 'External aggregator of service providers', '外部的服务商聚合平台') },
  ],
  relations: [
    rel(
      'cbs',
      'cbs',
      'ledger',
      'acl',
      tr('АБС 20 лет: план счетов, проводки, коды операций и даты в своём формате. Её модель нельзя пускать дальше шлюза.', 'The CBS is 20 years old: chart of accounts, postings, operation codes and dates in its own format. Its model must not go beyond the gateway.', '核心银行系统已有 20 年历史：会计科目表、记账分录、业务代码和日期都是它自己的格式。它的模型绝不能越过网关。'),
      tr('шлюз АБС и есть Anticorruption Layer: остальной банк говорит о переводах и остатках, а не о балансовых счетах', 'the CBS gateway is the Anticorruption Layer: the rest of the bank talks about transfers and balances, not ledger accounts', '核心银行系统网关就是 Anticorruption Layer（防腐层）：银行的其他部分谈论的是转账和余额，而不是会计科目'),
    ),
    rel(
      'agg',
      'aggregator',
      'billpay',
      'conformist',
      tr('Агрегатор подключает тысячи поставщиков и задаёт единый формат реквизитов. Банк — один из сотен клиентов, и формат хорошо описан.', 'The aggregator connects thousands of providers and defines one format for payment details. The bank is one of hundreds of clients, and the format is well documented.', '聚合商接入了数千家服务商，并规定了统一的收款信息格式。银行只是它数百个客户之一，而且这个格式有完善的文档。'),
      tr('повлиять нельзя, а модель агрегатора и есть язык этой предметной области — разумно принять её как есть', 'you cannot influence it, and the aggregator’s model is the language of this domain: sensible to adopt it as is', '你影响不了它，而聚合商的模型本身就是这个领域的语言：原样采用是明智的'),
    ),
    rel(
      'score',
      'antifraud',
      'transfers',
      'customer-supplier',
      tr('Переводам нужен быстрый скоринг. Команда «Риски» своя, она вносит требования переводов в план и договаривается о сроках.', 'Transfers need fast scoring. The Risk team is in-house; it puts Transfers’ requirements into its plan and agrees on deadlines.', '转账需要快速的风险评分。“风控”团队是行内团队，它会把转账的需求排进计划，并商定交付期限。'),
      tr('upstream внутри банка учитывает нужды downstream — Customer/Supplier', 'the in-house upstream takes downstream’s needs into account: Customer/Supplier', '行内的上游会考虑下游的需求：Customer/Supplier'),
    ),
    rel(
      'docs',
      'documents',
      'audit',
      'ohs',
      tr('Статусы документов нужны переводам, оплате услуг, аудиту и уведомлениям. Документы публикуют одну схему событий для всех.', 'Document statuses are needed by transfers, bill payments, audit and notifications. Documents publish one event schema for all.', '转账、生活缴费、审计和通知都需要单据状态。单据上下文为所有方发布一份统一的事件 schema。'),
      tr('много потребителей и один опубликованный протокол — Open Host Service / Published Language', 'many consumers and one published protocol: Open Host Service / Published Language', '消费者众多，协议只发布一份：Open Host Service / Published Language'),
    ),
    rel(
      'apart',
      'offers',
      'audit',
      'separate-ways',
      tr('Аудиторы попросили журналировать просмотры сторис. Юристы подтвердили, что регулятору это не нужно.', 'Auditors asked to log story views. Legal confirmed the regulator does not need this.', '审计人员要求把快拍的浏览记录写入日志。法务确认监管机构并不需要这些。'),
      tr('интеграция никому не нужна — Separate Ways', 'no one needs the integration: Separate Ways', '没有人需要这个集成：Separate Ways'),
    ),
    rel(
      'risk',
      'limits',
      'antifraud',
      'shared-kernel',
      tr('Лимитам и антифроду нужна одна и та же модель «операция для оценки риска»: сумма, канал, устройство, получатель. Её держат в маленькой общей библиотеке.', 'Limits and anti-fraud need the same “transaction for risk assessment” model: amount, channel, device, recipient. They keep it in a small shared library.', '限额和反欺诈需要同一个“待风险评估的交易”模型：金额、渠道、设备、收款人。它们把这个模型放在一个小小的共享库里。'),
      tr('общая небольшая модель под совместным контролем — Shared Kernel', 'a small shared model under joint control: Shared Kernel', '双方共同管控的小型共享模型：Shared Kernel'),
    ),
    rel(
      'qr',
      'confirm',
      'transfers',
      'partnership',
      tr('Запускают оплату по QR: переводы и подтверждение меняют протокол одновременно и выходят одним релизом к дате регулятора.', 'They are launching QR payments: transfers and confirmation change the protocol at the same time and ship in one release by the regulator’s deadline.', '他们正在上线扫码（QR）支付：转账和确认要同时修改协议，并赶在监管机构的截止日期前用同一个版本发布。'),
      tr('общая цель и общий срок, успех один на двоих — Partnership', 'a shared goal and deadline, one success for both: Partnership', '共同的目标和期限，成功属于双方：Partnership'),
    ),
  ],
  hints: [
    tr('Если модель внешней системы старая и неудобная — нужен переводчик; если стандартная и хорошая — её принимают.', 'If an external system’s model is old and awkward, you need a translator; if it is standard and good, you adopt it.', '如果外部系统的模型陈旧又别扭，就需要一个转换层；如果它标准又好用，就直接采用。'),
  ],
  debrief: [
    tr(
      'Шлюз АБС, который в распиле выносится одним из первых, — это и есть Anticorruption Layer. Карта контекстов заранее говорит, какие связи станут событиями, какие — синхронными вызовами, а какие можно просто убрать.',
      'The CBS gateway, one of the first things extracted in the split, is exactly the Anticorruption Layer. A context map tells you in advance which links become events, which stay synchronous calls and which you can simply remove.',
      '核心银行系统网关是拆分时最先拆出去的部分之一，它正是 Anticorruption Layer。上下文映射图会提前告诉你：哪些联系会变成事件，哪些仍是同步调用，哪些干脆可以去掉。',
    ),
  ],
}

/** Этапы проекта распила до миссий */
export const DDD_STAGES: Record<string, DddTask[]> = {
  shop: [shopContexts],
  food: [foodContexts, foodMap],
  bank: [bankContexts, bankMap],
}
