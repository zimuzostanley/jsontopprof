// End-to-end browser test: loads the app via Vite dev server,
// pastes TSV data, configures columns, generates profiles,
// and verifies the full flow including the Web Worker.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import puppeteer, { Browser, Page } from 'puppeteer'
import { createServer, ViteDevServer } from 'vite'

let browser: Browser
let page: Page
let server: ViteDevServer
let baseUrl: string

const TEST_TSV = [
  'function_name\tmodule\tself_size\tself_count',
  'malloc\tlibc\t4096\t100',
  'free\tlibc\t0\t50',
  'render\tui\t2048\t200',
  'parse\tparser\t1024\t75',
  'render\tui\t512\t30',
].join('\n')

beforeAll(async () => {
  server = await createServer({
    root: process.cwd(),
    server: { port: 0 },
    logLevel: 'silent',
  })
  await server.listen()
  const info = server.httpServer?.address()
  if (info && typeof info === 'object') {
    baseUrl = `http://localhost:${info.port}`
  }

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser]', msg.text())
  })
}, 30000)

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await server?.close()
})

describe('e2e: full flow', () => {
  it('loads the app', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle2' })
    const title = await page.$eval('.header h1', (el) => el.textContent)
    expect(title).toBe('JSON to pprof')
  }, 15000)

  it('pastes TSV and navigates to configure', async () => {
    await page.waitForSelector('textarea')

    // Set textarea value and trigger Mithril's oninput
    await page.evaluate((tsv) => {
      const ta = document.querySelector('textarea') as HTMLTextAreaElement
      ta.value = tsv
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }, TEST_TSV)

    // Wait for Mithril redraw
    await page.waitForFunction(() => {
      const btn = document.querySelector('.actions .btn.primary')
      return btn && btn.textContent === 'Parse data'
    }, { timeout: 3000 })

    // Click parse
    await page.click('.actions .btn.primary')

    // Should navigate to configure step and show columns
    await page.waitForSelector('.col-list', { timeout: 5000 })
    const colCount = await page.$$eval('.col-row', (rows) => rows.length)
    expect(colCount).toBe(4) // function_name, module, self_size, self_count
  }, 15000)

  it('shows correct default roles', async () => {
    // Check that function_name is frame and self_size is metric
    const roles = await page.evaluate(() => {
      const rows = document.querySelectorAll('.col-row:not(.json-parent)')
      const result: Record<string, string> = {}
      rows.forEach(row => {
        const name = row.querySelector('.col-name')?.textContent?.trim() ?? ''
        const active = row.querySelector('.role-btn.active')?.textContent?.trim() ?? ''
        if (name) result[name] = active
      })
      return result
    })

    expect(roles['function_name']).toBe('Frame')
    expect(roles['self_size']).toBe('Metric')
    expect(roles['self_count']).toBe('Metric')
  })

  it('shows frame order', async () => {
    const frames = await page.$$eval('.frame-item .frame-name', els =>
      els.map(el => el.textContent?.trim())
    )
    expect(frames).toContain('function_name')
  })

  it('generates profiles via worker and shows results', async () => {
    // Click Generate
    await page.click('.actions .btn.primary')

    // Wait for profile list to appear (worker + gzip)
    await page.waitForSelector('.profile-list', { timeout: 15000 })

    const profileCount = await page.$$eval('.profile-card', cards => cards.length)
    expect(profileCount).toBe(1)

    // Check metadata
    const meta = await page.$eval('.profile-meta', el => el.textContent)
    expect(meta).toContain('5 rows')
  }, 20000)

  it('shows download button and usage hint', async () => {
    const btnText = await page.$eval('.profile-card .btn', el => el.textContent)
    expect(btnText).toContain('Download')

    const hintText = await page.$eval('.hint-card', el => el.textContent)
    expect(hintText).toContain('pprof')
  })

  it('toggles theme', async () => {
    const initial = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(initial).toBe('light')

    await page.click('.btn-icon')
    const dark = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(dark).toBe('dark')

    await page.click('.btn-icon')
    const light = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(light).toBe('light')
  })

  it('navigates between steps', async () => {
    // Currently on results
    const active = await page.$eval('.step-btn.active', el => el.textContent)
    expect(active).toContain('Profiles')

    // Go to configure
    const steps = await page.$$('.step-btn')
    await steps[1].click()
    await page.waitForSelector('.col-list')

    // Go back to results
    await steps[2].click()
    await page.waitForSelector('.profile-list')
  })
})
