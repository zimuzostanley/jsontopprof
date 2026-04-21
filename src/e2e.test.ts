import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import puppeteer, { Browser, Page } from 'puppeteer'
import { createServer, ViteDevServer } from 'vite'
import { readFileSync } from 'fs'
import { join } from 'path'

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

const HEAP_TSV = readFileSync(join(process.cwd(), 'src/testdata/heap.tsv'), 'utf-8')

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
  await page.waitForSelector('.card-title', { timeout: 5000 })
}

/** Add a column to a role section via its popover menu. */
async function addToRole(colName: string, sectionTitle: string): Promise<void> {
  // Open the section's add popover
  await page.evaluate((title: string) => {
    const cards = document.querySelectorAll('.card')
    for (const card of cards) {
      const cardTitle = card.querySelector('.card-title')?.textContent?.trim()
      if (cardTitle === title) {
        const btn = card.querySelector('.add-col-btn') as HTMLButtonElement | null
        btn?.click()
        return
      }
    }
  }, sectionTitle)
  await page.waitForSelector('.add-menu', { timeout: 1000 })
  // Click the matching item
  await page.evaluate((name: string) => {
    const items = document.querySelectorAll('.add-menu-item')
    for (const item of items) {
      const n = item.querySelector('.add-menu-item-name')?.textContent?.trim()
      if (n === name) { (item as HTMLElement).click(); return }
    }
  }, colName)
  await new Promise(r => setTimeout(r, 120))
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

  it('parses TSV and shows configure screen', async () => {
    await loadTSV(SIMPLE_TSV)
    // Should see Frames section with empty state hint
    const hint = await page.$eval('.empty-hint', el => el.textContent)
    expect(hint).toContain('Select at least one')
  }, 15000)

  it('all columns start unassigned', async () => {
    // Frame order should be empty
    const frames = await page.$$('.frame-item')
    expect(frames.length).toBe(0)
  })

  it('adds frame and metric columns', async () => {
    await addToRole('function_name', 'Frames')
    await addToRole('self_size', 'Metrics')
    await addToRole('self_count', 'Metrics')

    // Verify frame shows up
    const frameNames = await page.$$eval('.frame-item .frame-name', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(frameNames).toContain('function_name')

    // Verify metrics show up
    const metricNames = await page.$$eval('.metric-item .metric-name', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(metricNames).toContain('self_size')
    expect(metricNames).toContain('self_count')
    expect(metricNames).toContain('rows')
  })

  it('generates profiles', async () => {
    await generate()
    const count = await page.$$eval('.profile-card', cards => cards.length)
    expect(count).toBe(1)
    const meta = await page.$eval('.profile-meta', el => el.textContent)
    expect(meta).toContain('5 rows')
  }, 20000)

  it('shows timestamp in filename', async () => {
    const fileName = await page.$eval('.profile-file', el => el.textContent)
    expect(fileName).toMatch(/^profile_\d{8}_\d{6}\.pb\.gz$/)
  })
})

// ── Theme ──

describe('e2e: theme', () => {
  it('toggles dark/light', async () => {
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
    await page.click('.btn-icon')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
    await page.click('.btn-icon')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
  })
})

// ── Partitioning ──

describe('e2e: partitions', () => {
  it('loads and assigns roles', async () => {
    await loadTSV(PARTITION_TSV)
    await addToRole('func', 'Frames')
    await addToRole('size', 'Metrics')
    await addToRole('env', 'Partition by')
  }, 15000)

  it('generates partitioned profiles', async () => {
    await generate()
    const count = await page.$$eval('.profile-card', cards => cards.length)
    expect(count).toBe(2)
  }, 20000)

  it('shows partition names', async () => {
    const names = await page.$$eval('.profile-name', els =>
      els.map(el => el.textContent?.trim()).sort()
    )
    expect(names).toEqual(['prod', 'staging'])
  })
})

// ── Selective download ──

describe('e2e: selective download', () => {
  it('shows checkboxes and select all', async () => {
    const checkboxes = await page.$$('input[type=checkbox]')
    expect(checkboxes.length).toBe(2)
    const allChecked = await page.$$eval('input[type=checkbox]', els =>
      els.every(el => (el as HTMLInputElement).checked)
    )
    expect(allChecked).toBe(true)
  })
})

// ── Text view ──

describe('e2e: text view', () => {
  it('switches to text view and shows output', async () => {
    await loadTSV(SIMPLE_TSV)
    await addToRole('function_name', 'Frames')
    await addToRole('self_size', 'Metrics')
    await generate()

    await page.evaluate(() => {
      const btns = document.querySelectorAll('.view-toggle button')
      ;(btns[1] as HTMLElement).click()
    })
    await page.waitForSelector('.text-view-pre', { timeout: 3000 })

    const text = await page.$eval('.text-view-pre', el => el.textContent)
    expect(text).toContain('malloc')
    expect(text).toContain('render')
  }, 25000)

  it('switches back to cards', async () => {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.view-toggle button')
      ;(btns[0] as HTMLElement).click()
    })
    await page.waitForSelector('.profile-list', { timeout: 3000 })
  })
})

// ── JSON array stack ──

describe('e2e: JSON array stack', () => {
  it('expands JSON array sub-fields as columns', async () => {
    await loadTSV(HEAP_TSV)
    // Open the Frames add-menu and read its items
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.card')
      for (const card of cards) {
        if (card.querySelector('.card-title')?.textContent?.trim() === 'Frames') {
          (card.querySelector('.add-col-btn') as HTMLButtonElement | null)?.click()
          return
        }
      }
    })
    await page.waitForSelector('.add-menu', { timeout: 1000 })
    const options = await page.$$eval('.add-menu-item .add-menu-item-name', els =>
      els.map(el => el.textContent?.trim() ?? '')
    )
    // Close the menu before subsequent tests
    await page.keyboard.press('Escape')
    await new Promise(r => setTimeout(r, 120))

    expect(options).toContain('path.class')
    expect(options).toContain('path.heap_type')
    expect(options).toContain('process_name')
  }, 15000)

  it('generates multi-depth stacks from JSON array', async () => {
    await addToRole('process_name', 'Frames')
    await addToRole('path.class', 'Frames')
    await addToRole('self_size', 'Metrics')
    await generate()

    // Switch to text view
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.view-toggle button')
      ;(btns[1] as HTMLElement).click()
    })
    await page.waitForSelector('.text-view-pre', { timeout: 5000 })

    const text = await page.$eval('.text-view-pre', el => el.textContent ?? '')
    console.log('Heap text output:\n' + text.slice(0, 500))

    // Verify multi-depth frames from JSON array
    expect(text).toContain('TaskSnapshotController')
    expect(text).toContain('TaskSnapshotCache')
    expect(text).toContain('HardwareBuffer')

    // Verify indentation (child deeper than parent)
    const lines = text.split('\n').filter(l => l.trim())
    const ctrl = lines.find(l => l.includes('TaskSnapshotController'))!
    const cache = lines.find(l => l.includes('TaskSnapshotCache'))!
    const ctrlIndent = ctrl.match(/^(\s*)/)?.[1].length ?? 0
    const cacheIndent = cache.match(/^(\s*)/)?.[1].length ?? 0
    expect(cacheIndent).toBeGreaterThan(ctrlIndent)
  }, 25000)
})

// ── Config persistence ──

describe('e2e: config persistence', () => {
  it('restores config when same schema is re-loaded', async () => {
    await loadTSV(PARTITION_TSV)
    // Should restore roles from previous test
    const frameNames = await page.$$eval('.frame-item .frame-name', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(frameNames).toContain('func')
  }, 15000)
})
