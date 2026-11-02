import { grade, type Review, type ReviewItem } from '../review'
import { tr } from '../../i18n'
import { PATTERNS, type PatternId } from './patterns'
import { evaluate, solutionState, stateCost, type Mission, type Project, type State } from './model'

export function reviewMission(p: Project, m: Mission, s: State, spent: number): Review {
  const items: ReviewItem[] = []
  const e = evaluate(p, s, spent, m.budget)
  const refCost = stateCost(p, solutionState(p, m.solution))

  const failed = [
    ...m.goals.filter((g) => !g.check(e)).map((g) => g.text),
    ...(spent > m.budget ? [tr(`бюджет ${m.budget} млн ₽`, `budget ${m.budget} M ₽`)] : []),
  ]
  const goalsOk = failed.length === 0
  if (goalsOk) items.push({ tone: 'ok', text: tr('Все цели миссии выполнены', 'All mission goals met') })
  else items.push({ tone: 'bad', text: tr(`Не выполнено: ${failed.join('; ')}`, `Not met: ${failed.join('; ')}`) })

  // деньги: сколько стоит итоговая архитектура и сколько ушло на метания
  const built = stateCost(p, s)
  const ratio = spent / refCost
  if (spent <= refCost) items.push({ tone: 'ok', text: tr(`Потрачено ${spent} млн ₽ — не больше эталона (${refCost})`, `Spent ${spent} M ₽ — no more than the reference solution (${refCost})`) })
  else if (built <= refCost)
    items.push({
      tone: spent - refCost > 3 ? 'warn' : 'ok',
      text: tr(
        `Итоговая архитектура стоит как эталон (${built} млн ₽), но ${spent - built} млн ушло на переделки: передумывали по ходу`,
        `The final architecture costs the same as the reference solution (${built} M ₽), but ${spent - built} M went to rework: you changed your mind along the way`,
      ),
    })
  else
    items.push({
      tone: ratio > 1.2 ? 'warn' : 'ok',
      text: tr(
        `Эталон дешевле на ${spent - refCost} млн ₽ (${refCost} против ${spent})`,
        `The reference solution is ${spent - refCost} M ₽ cheaper (${refCost} vs ${spent})`,
      ),
    })

  // оставшиеся предупреждения архитектуры (общая БД, прямые SQL, нет трейсинга)
  for (const pr of e.problems.filter((x) => x.severity === 'warn')) items.push({ tone: 'warn', text: pr.text })

  // отличия от эталона
  const title = (id: string) => p.modules.find((x) => x.id === id)?.title ?? id
  const extracted = p.modules.filter((x) => s.extracted[x.id]).map((x) => x.id)
  const refExtract = new Set(m.solution.extract)
  const extraMods = extracted.filter((x) => !refExtract.has(x)).map(title)
  const missingMods = m.solution.extract.filter((x) => !s.extracted[x]).map(title)
  if (extraMods.length) items.push({ tone: 'info', text: tr(`Эталон не выносит: ${extraMods.join(', ')}`, `The reference solution does not extract: ${extraMods.join(', ')}`) })
  if (missingMods.length) items.push({ tone: 'info', text: tr(`Эталон выносит: ${missingMods.join(', ')}`, `The reference solution also extracts: ${missingMods.join(', ')}`) })

  const on = (Object.keys(PATTERNS) as PatternId[]).filter((k) => s.infra[k])
  const refPatterns = new Set(m.solution.patterns)
  const extraPat = on.filter((k) => !refPatterns.has(k)).map((k) => PATTERNS[k].title)
  const missingPat = m.solution.patterns.filter((k) => !s.infra[k]).map((k) => PATTERNS[k].title)
  if (extraPat.length) items.push({ tone: 'info', text: tr(`Паттерны сверх эталона: ${extraPat.join(', ')}`, `Patterns beyond the reference solution: ${extraPat.join(', ')}`) })
  if (missingPat.length) items.push({ tone: 'info', text: tr(`В эталоне ещё есть: ${missingPat.join(', ')}`, `The reference solution also has: ${missingPat.join(', ')}`) })
  if (!extraMods.length && !missingMods.length && !extraPat.length && !missingPat.length)
    items.push({ tone: 'ok', text: tr('Модули и паттерны совпадают с эталоном', 'Modules and patterns match the reference solution') })

  return grade(goalsOk, Math.max(ratio, 0), items)
}
