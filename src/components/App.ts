import m from 'mithril'
import { S, toggleTheme, applyTheme } from '../state'
import { Import } from './Import'
import { Configure } from './Configure'
import { Results } from './Results'

const STEPS = ['import', 'configure', 'results'] as const
const STEP_LABELS = ['1. Import', '2. Configure', '3. Profiles']

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

      S.data
        ? m('.steps', STEPS.map((step, i) =>
            m('button.step-btn', {
              key: step,
              class: S.step === step ? 'active' : '',
              disabled: step === 'results' && S.profiles.length === 0,
              onclick: () => {
                if (step === 'results' && S.profiles.length === 0) return
                S.step = step
              },
            }, STEP_LABELS[i])
          ))
        : null,

      m('.content', [
        S.step === 'import' ? m(Import) : null,
        S.step === 'configure' ? m(Configure) : null,
        S.step === 'results' ? m(Results) : null,
      ]),
    ])
  },
}
