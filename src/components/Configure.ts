import m from 'mithril'
import { S, setRole, moveFrame, generate } from '../state'
import type { ColumnRole, ColumnInfo } from '../models/types'

const UNIT_SUGGESTIONS = [
  'bytes', 'count', 'nanoseconds', 'microseconds', 'milliseconds', 'seconds',
  'objects', 'pages', 'requests', 'errors',
]

// ── Add-menu popover state (single menu open at a time) ──

let menu: { role: ColumnRole; filter: string } | null = null
let menuCleanup: (() => void) | null = null

function openMenu(role: ColumnRole): void {
  menu = { role, filter: '' }
}

function closeMenu(): void {
  menu = null
}

// ── Column helpers ──

function isJsonParent(col: ColumnInfo): boolean {
  if (col.isJsonArray) return true
  if (S.columns.some(c => c.source === col.name && c.jsonKey !== undefined && !c.isJsonArrayField)) {
    return col.name === col.source && !col.jsonKey
  }
  return false
}

function availableFor(role: ColumnRole): ColumnInfo[] {
  return S.columns.filter(c => {
    if (isJsonParent(c)) return false
    const current = S.roles.get(c.name) ?? 'none'
    if (current !== 'none') return false
    if (role === 'metric' && !c.isNumeric) return false
    // JSON array sub-fields can be Frame or Metric only
    if (c.isJsonArrayField && role !== 'frame' && role !== 'metric') return false
    return true
  })
}

function assignedAs(role: ColumnRole): ColumnInfo[] {
  return (role === 'frame' ? S.frameOrder : S.columns.filter(c => S.roles.get(c.name) === role).map(c => c.name))
    .map(name => S.columns.find(c => c.name === name))
    .filter((c): c is ColumnInfo => c !== undefined)
}

function colLabel(col: ColumnInfo): string {
  if (col.jsonKey !== undefined) return `${col.source}.${col.jsonKey}`
  return col.name
}

// ── Add trigger + popover ──

function setupMenuListeners(menuEl: HTMLElement): void {
  const wrapper = menuEl.parentElement
  if (!wrapper) return

  // Focus the search input if present
  const input = menuEl.querySelector<HTMLInputElement>('input[data-menu-input]')
  input?.focus()

  const onMouseDown = (e: MouseEvent): void => {
    if (!wrapper.contains(e.target as Node)) {
      closeMenu()
      m.redraw()
    }
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      closeMenu()
      m.redraw()
    }
  }
  document.addEventListener('mousedown', onMouseDown)
  document.addEventListener('keydown', onKey)
  menuCleanup = () => {
    document.removeEventListener('mousedown', onMouseDown)
    document.removeEventListener('keydown', onKey)
    menuCleanup = null
  }
}

function renderMenu(role: ColumnRole, available: ColumnInfo[]): m.Vnode {
  const filter = (menu?.filter ?? '').trim().toLowerCase()
  const filtered = filter === ''
    ? available
    : available.filter(c => colLabel(c).toLowerCase().includes(filter))
  const showSearch = available.length > 5

  return m('.add-menu', {
    oncreate: (vnode: m.VnodeDOM) => setupMenuListeners(vnode.dom as HTMLElement),
    onremove: () => { if (menuCleanup) menuCleanup() },
    role: 'listbox',
  }, [
    showSearch ? m('.add-menu-search', [
      m('input[type=text]', {
        'data-menu-input': '',
        placeholder: 'Filter columns…',
        value: menu?.filter ?? '',
        oninput: (e: InputEvent) => {
          if (menu) menu.filter = (e.target as HTMLInputElement).value
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' && filtered.length > 0) {
            e.preventDefault()
            setRole(filtered[0].name, role)
            closeMenu()
          }
        },
      }),
    ]) : null,

    m('.add-menu-list',
      filtered.length === 0
        ? m('.add-menu-empty', 'No matching columns')
        : filtered.map(c =>
            m('.add-menu-item', {
              key: c.name,
              role: 'option',
              onclick: () => {
                setRole(c.name, role)
                closeMenu()
              },
            }, [
              m('span.add-menu-item-name', colLabel(c)),
              c.isJsonArrayField
                ? m('span.add-menu-item-tag', 'json')
                : c.isNumeric
                  ? m('span.add-menu-item-tag', 'num')
                  : null,
            ])
          ),
    ),
  ])
}

function renderAddTrigger(role: ColumnRole, label: string): m.Vnode | null {
  const available = availableFor(role)
  if (available.length === 0) return null
  const isOpen = menu !== null && menu.role === role
  return m('.add-wrapper', [
    m('button.add-col-btn' + (isOpen ? '.open' : ''), {
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-expanded': String(isOpen),
      onclick: (e: MouseEvent) => {
        e.stopPropagation()
        if (isOpen) closeMenu()
        else openMenu(role)
      },
    }, [
      m('span.add-col-btn-plus', '+'),
      m('span.add-col-btn-text', label),
    ]),
    isOpen ? renderMenu(role, available) : null,
  ])
}

function sectionHeader(
  title: string,
  subtitle: string,
  role: ColumnRole,
  addLabel: string,
): m.Vnode {
  return m('.card-title-row', [
    m('.section-heading', [
      m('.card-title', title),
      m('.section-subtitle', subtitle),
    ]),
    renderAddTrigger(role, addLabel),
  ])
}

function removeBtn(name: string): m.Vnode {
  return m('button.remove-btn', {
    onclick: () => setRole(name, 'none'),
    'aria-label': `Remove ${name}`,
    title: 'Remove',
  }, '×')
}

export const Configure: m.Component = {
  onremove() {
    // Tear down any open menu listeners if navigating away
    if (menuCleanup) menuCleanup()
    closeMenu()
  },

  view() {
    if (!S.data) return null

    const frames = assignedAs('frame')
    const metrics = assignedAs('metric')
    const partitions = assignedAs('partition')

    return m('div', [
      // Frames
      m('.card', [
        sectionHeader(
          'Frames',
          'The call stack, ordered from root to leaf.',
          'frame',
          'Add frame',
        ),
        frames.length === 0
          ? m('.empty-hint.empty-hint-block',
              'Select at least one column to define the call stack.')
          : m('.frame-order', frames.map((col, idx) => {
              const isFirst = idx === 0
              const isLast = idx === frames.length - 1
              const showRootLeaf = frames.length > 1
              return m('.frame-item', { key: col.name }, [
                m('.frame-idx', idx + 1),
                m('.frame-name', colLabel(col)),
                m('.frame-tags', [
                  showRootLeaf && isFirst
                    ? m('.frame-pill.frame-pill-accent', 'root') : null,
                  showRootLeaf && isLast
                    ? m('.frame-pill.frame-pill-accent', 'leaf') : null,
                ]),
                m('.frame-arrows', [
                  m('button', {
                    disabled: isFirst,
                    onclick: () => moveFrame(col.name, -1),
                    'aria-label': `Move ${col.name} up`,
                    title: 'Move up',
                  }, '▴'),
                  m('button', {
                    disabled: isLast,
                    onclick: () => moveFrame(col.name, 1),
                    'aria-label': `Move ${col.name} down`,
                    title: 'Move down',
                  }, '▾'),
                ]),
                removeBtn(col.name),
              ])
            })),
      ]),

      // Metrics
      m('.card', [
        sectionHeader(
          'Metrics',
          'Numeric values aggregated across samples.',
          'metric',
          'Add metric',
        ),
        m('.metric-list', [
          ...metrics.map(col =>
            m('.metric-item', { key: col.name }, [
              m('.metric-name', colLabel(col)),
              m('.metric-controls', [
                m('span.metric-unit-label', 'unit'),
                m('input[type=text].unit-input', {
                  'aria-label': `Unit for ${col.name}`,
                  list: 'unit-suggestions',
                  value: S.metricUnits.get(col.name) ?? 'count',
                  oninput: (e: InputEvent) => {
                    S.metricUnits.set(col.name, (e.target as HTMLInputElement).value)
                  },
                  placeholder: 'unit',
                }),
                removeBtn(col.name),
              ]),
            ])
          ),
          m('datalist#unit-suggestions', { key: '_datalist' },
            UNIT_SUGGESTIONS.map(u => m('option', { value: u })),
          ),
          m('.metric-item.metric-item-auto', { key: '_rows' }, [
            m('.metric-name', 'rows'),
            m('.rows-badge', 'auto — one per input row'),
          ]),
        ]),
      ]),

      // Partition
      m('.card', [
        sectionHeader(
          'Partition by',
          'Split output into one pprof per distinct value.',
          'partition',
          'Add partition',
        ),
        partitions.length === 0
          ? m('.empty-hint.empty-hint-block', 'Optional.')
          : m('.tag-list', partitions.map(col =>
              m('.tag-item', { key: col.name }, [
                m('span', colLabel(col)),
                removeBtn(col.name),
              ])
            )),
      ]),

      // Generate
      m('.actions.generate-actions', [
        frames.length === 0
          ? m('.generate-hint', 'Add at least one frame to generate profiles.')
          : null,
        S.generateError
          ? m('.inline-error', S.generateError)
          : null,
        m('.spacer'),
        S.generating
          ? m('button.btn.primary', { disabled: true }, [
              m('.spinner'),
              S.progress ? ` ${S.progress.message}` : ' Generating…',
            ])
          : m('button.btn.primary', {
              disabled: frames.length === 0,
              onclick: generate,
              title: frames.length === 0 ? 'Add at least one frame column' : '',
            }, 'Generate profiles'),
      ]),

      S.generating && S.progress ? m('.progress-bar', [
        m('.progress-fill', { style: `width: ${Math.round(S.progress.pct)}%` }),
      ]) : null,
    ])
  },
}
