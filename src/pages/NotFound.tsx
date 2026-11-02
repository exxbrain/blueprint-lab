import { tr } from '../i18n'
export function NotFound() {
  return (
    <div className="page narrow">
      <h1>404</h1>
      <p className="muted">{tr('Такой страницы нет на чертеже.', 'This page is not on the blueprint.')}</p>
      <a href="#/">← {tr('На главную', 'Back to home')}</a>
    </div>
  )
}
