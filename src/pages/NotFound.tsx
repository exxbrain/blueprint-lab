import { tr } from '../i18n'
export function NotFound() {
  return (
    <div className="page narrow">
      <h1>404</h1>
      <p className="muted">{tr('Такой страницы нет на чертеже.', 'This page is not on the blueprint.', '蓝图上没有这个页面。')}</p>
      <a href="#/">← {tr('На главную', 'Back to home', '返回首页')}</a>
    </div>
  )
}
