let uid = 100

/**
 * Новый id элемента или связи, которого ещё нет на схеме.
 * Счётчик живёт в модуле и при перезагрузке модуля в разработке начинается заново, а схема в состоянии
 * React остаётся. Без проверки по уже занятым id новый элемент мог бы получить чужой id и склеиться с ним.
 */
export function nextId(prefix: string, taken: { id: string }[]): string {
  let id = `${prefix}${++uid}`
  while (taken.some((x) => x.id === id)) id = `${prefix}${++uid}`
  return id
}
