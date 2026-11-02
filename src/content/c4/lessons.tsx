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

export const c4Lessons: Lesson[] = [
  {
    id: 'levels',
    title: tr('Четыре уровня C4', 'The four C4 levels'),
    summary: tr('Context, Container, Component, Code — и почему их нельзя смешивать', 'Context, Container, Component, Code — and why they must not be mixed'),
    minutes: 6,
    Body: tr(Levels, LevelsEn),
  },
  {
    id: 'notation',
    title: tr('Нотация и чек-лист ревью', 'Notation and review checklist'),
    summary: tr('Тип, технология, подпись и направление связи, граница системы', 'Type, technology, relationship label and direction, system boundary'),
    minutes: 6,
    Body: tr(Notation, NotationEn),
  },
]
