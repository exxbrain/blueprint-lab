import type { Lesson } from '../types'
import { Callout } from '../../components/Try'
import { tr } from '../../i18n'

function Levels() {
  return (
    <div className="lesson">
      <p>
        <b>C4 model</b> — способ рисовать архитектуру как карту с масштабом. Её придумал Саймон Браун. Вместо одной
        огромной схемы «всё со всем» — четыре уровня приближения, и на каждом свой набор элементов.
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>Уровень</th>
            <th>Вопрос</th>
            <th>Что на диаграмме</th>
            <th>Для кого</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1. System Context</td>
            <td>Что это за система и с кем она работает?</td>
            <td>Люди, наша система одним блоком, внешние системы</td>
            <td>Все, включая бизнес</td>
          </tr>
          <tr>
            <td>2. Container</td>
            <td>Из каких запускаемых частей она состоит?</td>
            <td>Приложения, сервисы, базы, брокеры — с технологиями</td>
            <td>Разработчики, эксплуатация, архитекторы</td>
          </tr>
          <tr>
            <td>3. Component</td>
            <td>Как устроен один контейнер?</td>
            <td>Контроллеры, сервисы, репозитории внутри контейнера</td>
            <td>Разработчики этого контейнера</td>
          </tr>
          <tr>
            <td>4. Code</td>
            <td>Как реализован компонент?</td>
            <td>Классы, интерфейсы, таблицы</td>
            <td>Обычно генерируется из IDE</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        «Контейнер» в C4 — это не Docker. Это всё, что запускается отдельно и хранит или обрабатывает данные: SPA в
        браузере, мобильное приложение, бэкенд-сервис, база данных, брокер сообщений, бакет S3.
      </Callout>
      <h2>Главное правило — не смешивать уровни</h2>
      <p>
        Таблица БД на контекстной диаграмме или контроллер рядом с микросервисами — самая частая ошибка. Каждая
        диаграмма отвечает на свой вопрос: при переходе на уровень ниже один блок раскрывается в несколько, а всё
        остальное остаётся снаружи границы.
      </p>
      <p>
        На практике почти всегда хватает первых двух уровней. Диаграммы компонентов рисуют только для сложных
        контейнеров, уровень Code — практически никогда.
      </p>
    </div>
  )
}

function Notation() {
  return (
    <div className="lesson">
      <p>
        C4 намеренно не задаёт строгой графики: важны не цвета и формы, а то, чтобы диаграмма читалась без автора. Для
        этого у каждого элемента и каждой связи есть обязательный текст.
      </p>
      <h2>Элемент</h2>
      <ul>
        <li>
          <b>Имя</b> — «Backend API», «База заказов».
        </li>
        <li>
          <b>Тип</b> в квадратных скобках — [Person], [Software System], [Container], [Component].
        </li>
        <li>
          <b>Технология</b> для контейнеров и компонентов — [Container: Kotlin, Spring Boot].
        </li>
        <li>
          <b>Описание</b> одной фразой — за что отвечает.
        </li>
      </ul>
      <h2>Связь</h2>
      <ul>
        <li>
          <b>Направление</b> — от того, кто начинает взаимодействие: «Backend → АБС: проводит платёж», а не наоборот,
          хотя ответ идёт обратно.
        </li>
        <li>
          <b>Подпись</b> — что происходит: «читает и пишет заказы», «отправляет уведомления». Стрелка без подписи
          ничего не сообщает.
        </li>
        <li>
          <b>Технология</b> на уровне контейнеров — JSON/HTTPS, gRPC, SQL/JDBC, Kafka.
        </li>
      </ul>
      <h2>Граница</h2>
      <p>
        На диаграмме контейнеров система рисуется пунктирной рамкой: внутри её контейнеры, снаружи — люди и внешние
        системы. На диаграмме компонентов рамка — это раскрываемый контейнер, а соседние контейнеры остаются снаружи.
      </p>
      <Callout>
        Чек-лист ревью C4: у каждого элемента есть тип и описание; у контейнеров и компонентов — технология; у каждой
        стрелки — подпись, правильное направление и (между контейнерами) протокол; уровни не смешаны; есть легенда,
        если используются цвета.
      </Callout>
      <h2>Дополнительные диаграммы</h2>
      <ul>
        <li>
          <b>System Landscape</b> — все системы компании и связи между ними.
        </li>
        <li>
          <b>Dynamic</b> — пронумерованная последовательность шагов одного сценария поверх контейнеров или компонентов.
        </li>
        <li>
          <b>Deployment</b> — на чём и где запущены контейнеры: кластеры, узлы, регионы.
        </li>
      </ul>
      <p>
        Диаграммы удобно держать как код: Structurizr DSL, PlantUML C4 или Mermaid C4 — тогда они живут в репозитории
        рядом с кодом и проходят ревью вместе с ним.
      </p>
    </div>
  )
}

function LevelsEn() {
  return (
    <div className="lesson">
      <p>
        The <b>C4 model</b> is a way to draw architecture like a map with zoom levels. It was created by Simon Brown.
        Instead of one huge “everything connected to everything” diagram, there are four levels of zoom, each with its
        own set of elements.
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>Level</th>
            <th>Question</th>
            <th>What is on the diagram</th>
            <th>Audience</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1. System Context</td>
            <td>What is this system and who does it work with?</td>
            <td>People, our system as a single box, external systems</td>
            <td>Everyone, including the business</td>
          </tr>
          <tr>
            <td>2. Container</td>
            <td>What runnable parts is it made of?</td>
            <td>Applications, services, databases, brokers — with technologies</td>
            <td>Developers, operations, architects</td>
          </tr>
          <tr>
            <td>3. Component</td>
            <td>How is a single container structured?</td>
            <td>Controllers, services, repositories inside the container</td>
            <td>Developers of that container</td>
          </tr>
          <tr>
            <td>4. Code</td>
            <td>How is a component implemented?</td>
            <td>Classes, interfaces, tables</td>
            <td>Usually generated by the IDE</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        A “container” in C4 is not Docker. It is anything that runs separately and stores or processes data: an SPA in
        the browser, a mobile app, a backend service, a database, a message broker, an S3 bucket.
      </Callout>
      <h2>The main rule: do not mix levels</h2>
      <p>
        A database table on a context diagram or a controller next to microservices is the most common mistake. Each
        diagram answers its own question: when you zoom one level down, one box expands into several, and everything
        else stays outside the boundary.
      </p>
      <p>
        In practice the first two levels are almost always enough. Component diagrams are drawn only for complex
        containers, and the Code level practically never.
      </p>
    </div>
  )
}

function NotationEn() {
  return (
    <div className="lesson">
      <p>
        C4 deliberately does not prescribe strict graphics: what matters is not colours and shapes but that the diagram
        can be read without its author. That is why every element and every relationship carries mandatory text.
      </p>
      <h2>Element</h2>
      <ul>
        <li>
          <b>Name</b> — “Backend API”, “Orders database”.
        </li>
        <li>
          <b>Type</b> in square brackets — [Person], [Software System], [Container], [Component].
        </li>
        <li>
          <b>Technology</b> for containers and components — [Container: Kotlin, Spring Boot].
        </li>
        <li>
          <b>Description</b> in one sentence — what it is responsible for.
        </li>
      </ul>
      <h2>Relationship</h2>
      <ul>
        <li>
          <b>Direction</b> — from whoever starts the interaction: “Backend → Core banking: makes a payment”, not the
          other way round, even though the response comes back.
        </li>
        <li>
          <b>Label</b> — what happens: “reads and writes orders”, “sends notifications”. An unlabelled arrow tells you
          nothing.
        </li>
        <li>
          <b>Technology</b> at the container level — JSON/HTTPS, gRPC, SQL/JDBC, Kafka.
        </li>
      </ul>
      <h2>Boundary</h2>
      <p>
        On a Container diagram the system is drawn as a dashed box: its containers inside, people and external systems
        outside. On a Component diagram the box is the container being zoomed into, and neighbouring containers stay
        outside.
      </p>
      <Callout>
        C4 review checklist: every element has a type and a description; containers and components have a technology;
        every arrow has a label, the right direction and (between containers) a protocol; levels are not mixed; there
        is a legend if colours are used.
      </Callout>
      <h2>Supplementary diagrams</h2>
      <ul>
        <li>
          <b>System Landscape</b> — all of the company’s systems and how they connect.
        </li>
        <li>
          <b>Dynamic</b> — a numbered sequence of steps for one scenario on top of containers or components.
        </li>
        <li>
          <b>Deployment</b> — what the containers run on and where: clusters, nodes, regions.
        </li>
      </ul>
      <p>
        Diagrams are convenient to keep as code: Structurizr DSL, PlantUML C4 or Mermaid C4 — then they live in the
        repository next to the code and are reviewed along with it.
      </p>
    </div>
  )
}

function LevelsZh() {
  return (
    <div className="lesson">
      <p>
        <b>C4 model</b> 是一种像画带比例尺的地图一样画架构的方法，由 Simon Brown 提出。它不画一张“所有东西都连在一起”的巨大图，而是分成四个缩放层级，每个层级有自己的一组元素。
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>层级</th>
            <th>回答的问题</th>
            <th>图上画什么</th>
            <th>给谁看</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1. System Context</td>
            <td>这是什么系统？它和谁打交道？</td>
            <td>人、作为一个整体方框的我们的系统、外部系统</td>
            <td>所有人，包括业务方</td>
          </tr>
          <tr>
            <td>2. Container</td>
            <td>它由哪些可独立运行的部分组成？</td>
            <td>应用、服务、数据库、消息 Broker——并标明技术</td>
            <td>开发、运维、架构师</td>
          </tr>
          <tr>
            <td>3. Component</td>
            <td>单个容器内部是怎样组织的？</td>
            <td>容器内部的控制器、服务、仓储（repository）</td>
            <td>这个容器的开发者</td>
          </tr>
          <tr>
            <td>4. Code</td>
            <td>组件是如何实现的？</td>
            <td>类、接口、表</td>
            <td>通常由 IDE 生成</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        C4 中的“容器”（container）不是 Docker。它指任何单独运行、存储或处理数据的东西：浏览器中的 SPA、移动应用、后端服务、数据库、消息 Broker、S3 bucket。
      </Callout>
      <h2>首要规则：不要混用层级</h2>
      <p>
        在上下文图上画数据库表，或者把控制器和微服务画在一起——这是最常见的错误。每张图回答自己的问题：往下钻一层时，一个方框展开成若干个，其余的一切都留在边界之外。
      </p>
      <p>
        实践中前两个层级几乎总是够用。组件图只为复杂的容器绘制，而 Code 层级几乎从来不画。
      </p>
    </div>
  )
}

function NotationZh() {
  return (
    <div className="lesson">
      <p>
        C4 有意不规定严格的图形样式：重要的不是颜色和形状，而是图在作者不在场时也能被读懂。因此每个元素和每条关系都必须带有文字说明。
      </p>
      <h2>元素</h2>
      <ul>
        <li>
          <b>名称</b>——“Backend API”、“订单数据库”。
        </li>
        <li>
          <b>类型</b>写在方括号里——[Person]、[Software System]、[Container]、[Component]。
        </li>
        <li>
          <b>技术</b>（用于容器和组件）——[Container: Kotlin, Spring Boot]。
        </li>
        <li>
          <b>描述</b>，一句话——它负责什么。
        </li>
      </ul>
      <h2>关系</h2>
      <ul>
        <li>
          <b>方向</b>——从发起交互的一方指出：“Backend → 核心银行系统：发起支付”，而不是反过来，尽管响应是沿反方向返回的。
        </li>
        <li>
          <b>标签</b>——说明发生了什么：“读写订单”、“发送通知”。没有标签的箭头什么也没告诉你。
        </li>
        <li>
          <b>技术</b>（在容器层级）——JSON/HTTPS、gRPC、SQL/JDBC、Kafka。
        </li>
      </ul>
      <h2>边界</h2>
      <p>
        在容器图上，系统画成一个虚线框：框内是它的容器，框外是人和外部系统。在组件图上，这个框就是被展开的那个容器，相邻的容器留在框外。
      </p>
      <Callout>
        C4 评审清单：每个元素都有类型和描述；容器和组件标明了技术；每个箭头都有标签、正确的方向以及（容器之间的）协议；层级没有混用；如果用了颜色，就要有图例。
      </Callout>
      <h2>补充图</h2>
      <ul>
        <li>
          <b>System Landscape</b>——公司的所有系统以及它们之间的关系。
        </li>
        <li>
          <b>Dynamic</b>——在容器或组件之上，为某个场景画出带编号的步骤顺序。
        </li>
        <li>
          <b>Deployment</b>——容器运行在什么上、运行在哪里：集群、节点、区域。
        </li>
      </ul>
      <p>
        图很适合以代码的形式维护：Structurizr DSL、PlantUML C4 或 Mermaid C4——这样它们就和代码一起放在仓库里，并随代码一起评审。
      </p>
    </div>
  )
}

export const c4Lessons: Lesson[] = [
  {
    id: 'levels',
    title: tr('Четыре уровня C4', 'The four C4 levels', 'C4 的四个层级'),
    summary: tr('Context, Container, Component, Code — и почему их нельзя смешивать', 'Context, Container, Component, Code — and why they must not be mixed', 'Context、Container、Component、Code——以及为什么不能混用'),
    minutes: 6,
    Body: tr(Levels, LevelsEn, LevelsZh),
  },
  {
    id: 'notation',
    title: tr('Нотация и чек-лист ревью', 'Notation and review checklist', '表示法与评审清单'),
    summary: tr('Тип, технология, подпись и направление связи, граница системы', 'Type, technology, relationship label and direction, system boundary', '类型、技术、关系的标签和方向、系统边界'),
    minutes: 6,
    Body: tr(Notation, NotationEn, NotationZh),
  },
]
