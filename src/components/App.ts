import m from 'mithril'
import { S, toggleTheme, applyTheme } from '../state'
import { Import } from './Import'
import { Configure } from './Configure'
import { Results } from './Results'

export const App: m.Component = {
  oninit() {
    applyTheme(S.theme)
  },

  view() {
    const themeLabel = S.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'

    return m('.shell', [
      m('.header', [
        m('h1', 'JSON to pprof'),
        m('.header-actions', [
          m('button.btn-icon', {
            onclick: toggleTheme,
            title: themeLabel,
            'aria-label': themeLabel,
          }, S.theme === 'light' ? '\u263E' : '\u2600'),
        ]),
      ]),

      S.data ? m('.steps', [
        m('button.step-btn', {
          class: S.step === 'import' ? 'active' : '',
          onclick: () => { S.step = 'import' },
        }, '1. Import'),
        m('button.step-btn', {
          class: S.step === 'configure' ? 'active' : '',
          disabled: !S.data,
          onclick: () => { if (S.data) S.step = 'configure' },
        }, '2. Configure'),
        m('button.step-btn', {
          class: S.step === 'results' ? 'active' : '',
          disabled: S.profiles.length === 0,
          onclick: () => { if (S.profiles.length > 0) S.step = 'results' },
        }, '3. Profiles'),
      ]) : null,

      S.step === 'import' ? m(Import) : null,
      S.step === 'configure' ? m(Configure) : null,
      S.step === 'results' ? m(Results) : null,
    ])
  },
}
