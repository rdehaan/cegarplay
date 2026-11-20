import sys, json, asyncio
from playwright.async_api import async_playwright
async def go(url):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
        await pg.goto(url)
        await pg.wait_for_function('window.__results && window.__results.finished', timeout=120000)
        r = await pg.evaluate('window.__results')
        print(json.dumps(r, indent=1)); print('page errors:', errs)
        await b.close()
asyncio.run(go(sys.argv[1]))
