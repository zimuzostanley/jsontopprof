import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import puppeteer, { Browser, Page } from 'puppeteer'
import { createServer, ViteDevServer } from 'vite'

let browser: Browser
let page: Page
let server: ViteDevServer
let baseUrl: string

const SIMPLE_TSV = [
  'function_name\tmodule\tself_size\tself_count',
  'malloc\tlibc\t4096\t100',
  'free\tlibc\t0\t50',
  'render\tui\t2048\t200',
  'parse\tparser\t1024\t75',
  'render\tui\t512\t30',
].join('\n')

const PARTITION_TSV = [
  'func\tenv\tthread\tsize',
  'foo\tprod\tmain\t100',
  'bar\tprod\tworker\t200',
  'baz\tstaging\tmain\t300',
].join('\n')

beforeAll(async () => {
  server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'silent' })
  await server.listen()
  const info = server.httpServer?.address()
  if (info && typeof info === 'object') baseUrl = `http://localhost:${info.port}`

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  page = await browser.newPage()
}, 30000)

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await server?.close()
})

async function loadTSV(tsv: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'networkidle2' })
  await page.waitForSelector('textarea')
  await page.evaluate((t: string) => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement
    ta.value = t
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, tsv)
  await page.waitForFunction(() => {
    const btn = document.querySelector('.actions .btn.primary')
    return btn && btn.textContent === 'Parse data'
  }, { timeout: 3000 })
  await page.click('.actions .btn.primary')
  await page.waitForSelector('.col-list', { timeout: 5000 })
}

async function clickRole(colName: string, role: string): Promise<void> {
  await page.evaluate((name: string, r: string) => {
    const rows = document.querySelectorAll('.col-row:not(.json-parent)')
    for (const row of rows) {
      const nameEl = row.querySelector('.col-name')
      if (nameEl?.textContent?.trim() === name) {
        const btns = row.querySelectorAll('.role-btn')
        for (const btn of btns) {
          if (btn.textContent?.trim() === r) (btn as HTMLElement).click()
        }
      }
    }
  }, colName, role)
}

async function generate(): Promise<void> {
  await page.click('.actions .btn.primary')
  await page.waitForSelector('.profile-list', { timeout: 15000 })
}

// ── Basic flow ──

describe('e2e: basic flow', () => {
  it('loads app', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle2' })
    const title = await page.$eval('.header h1', el => el.textContent)
    expect(title).toBe('JSON to pprof')
  }, 15000)

  it('parses TSV and shows columns', async () => {
    await loadTSV(SIMPLE_TSV)
    const colCount = await page.$$eval('.col-row', rows => rows.length)
    expect(colCount).toBe(4)
  }, 15000)

  it('assigns correct default roles', async () => {
    const roles = await page.evaluate(() => {
      const rows = document.querySelectorAll('.col-row:not(.json-parent)')
      const r: Record<string, string> = {}
      rows.forEach(row => {
        const name = row.querySelector('.col-name')?.textContent?.trim() ?? ''
        const active = row.querySelector('.role-btn.active')?.textContent?.trim() ?? ''
        if (name) r[name] = active
      })
      return r
    })
    expect(roles['function_name']).toBe('Frame')
    expect(roles['self_size']).toBe('Metric')
    expect(roles['self_count']).toBe('Metric')
    expect(roles['module']).toBe('Skip')
  })

  it('shows frame order section', async () => {
    const frames = await page.$$eval('.frame-item .frame-name', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(frames).toContain('function_name')
  })

  it('shows metrics with unit inputs', async () => {
    const metrics = await page.$$eval('.metric-item .metric-name', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(metrics).toContain('self_size')
    expect(metrics).toContain('self_count')
    expect(metrics).toContain('rows')
  })

  it('generates profiles via worker', async () => {
    await generate()
    const count = await page.$$eval('.profile-card', cards => cards.length)
    expect(count).toBe(1)
    const meta = await page.$eval('.profile-meta', el => el.textContent)
    expect(meta).toContain('5 rows')
  }, 20000)

  it('shows download button and filename with timestamp', async () => {
    const fileName = await page.$eval('.profile-file', el => el.textContent)
    expect(fileName).toMatch(/^profile_\d{8}_\d{6}\.pb\.gz$/)
  })

  it('shows usage hints', async () => {
    const hint = await page.$eval('.hint-card', el => el.textContent)
    expect(hint).toContain('pprof')
    expect(hint).toContain('Perfetto')
  })
})

// ── Theme ──

describe('e2e: theme', () => {
  it('toggles dark/light', async () => {
    const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(initial).toBe('light')
    await page.click('.btn-icon')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
    await page.click('.btn-icon')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
  })
})

// ── Step navigation ──

describe('e2e: navigation', () => {
  it('navigates between steps', async () => {
    const active = await page.$eval('.step-btn.active', el => el.textContent)
    expect(active).toContain('Profiles')

    const steps = await page.$$('.step-btn')
    await steps[1].click()
    await page.waitForSelector('.col-list')

    await steps[2].click()
    await page.waitForSelector('.profile-list')
  })
})

// ── Partitioning + labels ──

describe('e2e: partitions and labels', () => {
  it('loads partition TSV', async () => {
    await loadTSV(PARTITION_TSV)
  }, 15000)

  it('assigns partition and label roles', async () => {
    await clickRole('env', 'Partition')
    await clickRole('thread', 'Label')
    // Wait for Mithril redraw
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.col-row:not(.json-parent)')
      for (const row of rows) {
        if (row.querySelector('.col-name')?.textContent?.trim() === 'env') {
          return row.querySelector('.role-btn.active')?.textContent?.trim() === 'Partition'
        }
      }
      return false
    }, { timeout: 3000 })

    const envRole = await page.evaluate(() => {
      const rows = document.querySelectorAll('.col-row:not(.json-parent)')
      for (const row of rows) {
        if (row.querySelector('.col-name')?.textContent?.trim() === 'env') {
          return row.querySelector('.role-btn.active')?.textContent?.trim()
        }
      }
    })
    expect(envRole).toBe('Partition')
  })

  it('generates partitioned profiles', async () => {
    await generate()
    const count = await page.$$eval('.profile-card', cards => cards.length)
    expect(count).toBe(2) // prod + staging
  }, 20000)

  it('shows partition names', async () => {
    const names = await page.$$eval('.profile-name', els =>
      els.map(el => el.textContent?.trim()).sort()
    )
    expect(names).toEqual(['prod', 'staging'])
  })

  it('shows filenames with partition values and timestamps', async () => {
    const files = await page.$$eval('.profile-file', els =>
      els.map(el => el.textContent?.trim()).sort()
    )
    expect(files[0]).toMatch(/^profile_prod_\d{8}_\d{6}\.pb\.gz$/)
    expect(files[1]).toMatch(/^profile_staging_\d{8}_\d{6}\.pb\.gz$/)
  })
})

// ── Selective download ──

describe('e2e: selective download', () => {
  it('shows checkboxes for multiple profiles', async () => {
    const checkboxes = await page.$$('input[type=checkbox]')
    expect(checkboxes.length).toBe(2)
  })

  it('all selected by default', async () => {
    const checked = await page.$$eval('input[type=checkbox]', els =>
      els.every(el => (el as HTMLInputElement).checked)
    )
    expect(checked).toBe(true)
  })

  it('can deselect and shows correct count', async () => {
    const checkboxes = await page.$$('input[type=checkbox]')
    await checkboxes[0].click()
    // Wait for Mithril to update button text
    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('.actions-flush-sm .btn.sm')
      return btns[1]?.textContent?.includes('1 selected')
    }, { timeout: 3000 })

    const btnText = await page.evaluate(() => {
      const btns = document.querySelectorAll('.actions-flush-sm .btn.sm')
      return btns[1]?.textContent?.trim()
    })
    expect(btnText).toContain('1 selected')
  })

  it('select all / deselect all works', async () => {
    // Click "Select all"
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.actions-flush-sm .btn.sm')
      ;(btns[0] as HTMLElement).click()
    })

    const allChecked = await page.$$eval('input[type=checkbox]', els =>
      els.every(el => (el as HTMLInputElement).checked)
    )
    expect(allChecked).toBe(true)
  })
})

// ── Text view ──

describe('e2e: text view', () => {
  it('switches to text view', async () => {
    // Load fresh data and generate
    await loadTSV(SIMPLE_TSV)
    await generate()
    // Click "Text" toggle
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.view-toggle button')
      ;(btns[1] as HTMLElement).click()
    })
    await page.waitForSelector('.text-view-pre', { timeout: 3000 })
  }, 20000)

  it('shows text output with frame names and metrics', async () => {
    const text = await page.$eval('.text-view-pre', el => el.textContent)
    expect(text).toBeTruthy()
    // Should contain frame names from the data
    expect(text).toContain('malloc')
    expect(text).toContain('render')
    // Should contain metric values in brackets
    expect(text).toContain('[')
    expect(text).toContain('rows:')
  })

  it('shows metric toggles', async () => {
    const toggles = await page.$$eval('.col-role .role-btn', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(toggles).toContain('self_size')
    expect(toggles).toContain('self_count')
    expect(toggles).toContain('rows')
  })

  it('toggling a metric changes text output', async () => {
    const before = await page.$eval('.text-view-pre', el => el.textContent ?? '')

    // Click the 'self_size' metric toggle to disable it
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.col-role .role-btn')
      for (const btn of btns) {
        if (btn.textContent?.trim() === 'self_size') (btn as HTMLElement).click()
      }
    })
    await page.waitForFunction((prev: string) => {
      const pre = document.querySelector('.text-view-pre')
      return pre && pre.textContent !== prev
    }, {}, before)

    const after = await page.$eval('.text-view-pre', el => el.textContent ?? '')
    expect(after).not.toEqual(before)
  })

  it('copy button exists', async () => {
    const hasCopy = await page.evaluate(() => {
      const btns = document.querySelectorAll('.btn.sm')
      return [...btns].some(b => b.textContent?.trim() === 'Copy')
    })
    expect(hasCopy).toBe(true)
  })

  it('switches back to cards view', async () => {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.view-toggle button')
      ;(btns[0] as HTMLElement).click()
    })
    await page.waitForSelector('.profile-list', { timeout: 3000 })
    const cards = await page.$$('.profile-card')
    expect(cards.length).toBeGreaterThan(0)
  })
})

// ── Config persistence ──

describe('e2e: config persistence', () => {
  it('restores config when same schema is re-loaded', async () => {
    // Load same TSV again
    await loadTSV(PARTITION_TSV)

    // Should restore partition role for env
    const envRole = await page.evaluate(() => {
      const rows = document.querySelectorAll('.col-row:not(.json-parent)')
      for (const row of rows) {
        if (row.querySelector('.col-name')?.textContent?.trim() === 'env') {
          return row.querySelector('.role-btn.active')?.textContent?.trim()
        }
      }
    })
    expect(envRole).toBe('Partition')

    // Should restore label role for thread
    const threadRole = await page.evaluate(() => {
      const rows = document.querySelectorAll('.col-row:not(.json-parent)')
      for (const row of rows) {
        if (row.querySelector('.col-name')?.textContent?.trim() === 'thread') {
          return row.querySelector('.role-btn.active')?.textContent?.trim()
        }
      }
    })
    expect(threadRole).toBe('Label')
  }, 15000)
})
