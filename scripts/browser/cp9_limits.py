"""
Checkpoint 9 browser QA: the REAL rate limiter, as a person meets it. Needs a production-mode server serving the frontend:
  RATE_LIMIT_MAX=2 NODE_ENV=production TRUST_PROXY=0 GEMMA_PROVIDER=none WEATHER_PROVIDER=none node dist/server.js
Usage: python3 scripts/browser/cp9_limits.py [BASE_URL]      (headless Chromium via Playwright for Python; not a project dependency)
"""
import re
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
results = []
TECH = re.compile(r'\b429\b|rate|limit|too many|retry-after|sentry|trace|HTTP|stack|localhost', re.I)


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(str(e)))

    def attempt():
        page.goto(BASE)
        page.get_by_role('button', name='Start a walk').click()
        page.get_by_role('button', name='Plan my walk').click()

    for n in (1, 2):
        attempt()
        page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).wait_for()
        check(f'request {n} of 2 allowed: a plan is shown', True)

    attempt()
    page.get_by_role('alert').wait_for()
    body = page.locator('body').inner_text()
    check('request 3: the person sees friendly "busy" copy', re.search(r'busy right now', body) is not None, body[:90].replace('\n', ' '))
    check('request 3: no status code, limiter wording or technical text shown', not TECH.search(body.replace('PocketWalk is busy right now. Try again in a moment.', '')))
    check('request 3: Try again is offered, no plan is shown', page.get_by_role('button', name='Try again').is_visible() and not page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).is_visible())

    raw = ctx.request.post(f'{BASE}/walks/plan', data={'minutes': 10})
    check('the API answers 429 with a Retry-After and the standard error shape', raw.status == 429 and int(raw.headers.get('retry-after', '0')) >= 1 and list(raw.json().keys()) == ['error'], f"{raw.status} {raw.headers.get('retry-after')}")
    check('/health and /ready are still 200 while the client is limited', ctx.request.get(f'{BASE}/health').status == 200 and ctx.request.get(f'{BASE}/ready').status == 200)
    check('the app shell still loads while limited (static files are not limited)', ctx.request.get(f'{BASE}/').status == 200)
    check('no console errors (also means the CSP blocked nothing)', errors == [], str(errors))
    browser.close()

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
