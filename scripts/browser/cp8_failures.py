"""
Checkpoint 8 browser QA: failure, retry and recovery journeys (headless Chromium, Playwright for Python;
NOT a project dependency, not run in CI). Complements cp6_flow.py (the happy-path walk) and reuses scripts/qaServer.ts,
which is the REAL app with a scripted model and weather service and a control endpoint (/__qa/set).

Needs: `npx tsx scripts/qaServer.ts` on :3000 and the PRODUCTION frontend (`vite preview`) on :4173.
Usage:  python3 scripts/browser/cp8_failures.py [BASE_URL] [QA_URL]
Exit code is non-zero if any check fails. Scripted stand-ins only: this is NOT live Gemma or Open-Meteo.
"""
import re
import sys
import urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
QA = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:3000'
results = []
# Words that must never reach a person: observability, providers, transport and error internals.
TECH = re.compile(r'sentry|trace|latency|gemma|provider|fallback|deterministic|\bHTTP\b|\b[45]\d\d\b|stack|zod|localhost|ApiError|TypeError|undefined|\bnull\b|\[object', re.I)


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


def qa(**kw):
    urllib.request.urlopen(f"{QA}/__qa/set?" + '&'.join(f'{k}={v}' for k, v in kw.items())).read()


def new_page(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors, posts = [], []
    # A deliberately aborted request makes Chromium log a network error; that is the scenario, not a bug.
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: posts.append(r.url) if r.method == 'POST' else None)
    return ctx, page, errors, posts


def to_configure(page):
    page.goto(BASE)
    page.get_by_role('button', name='Start a walk').click()


def plan(page):
    page.get_by_role('button', name='Plan my walk').click()


def ready_btn(page):
    return page.get_by_role('button', name=re.compile(r"i.m ready", re.I))


def body(page):
    return page.locator('body').inner_text()


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # 1. backend answers HTTP 500 -> clean error -> retry after recovery -> plan -> ready -> walk
    qa(model='down', weather='clear', mode='crash')  # crash only breaks the fallback, so the model must fail first for a real 500
    ctx, page, errors, posts = new_page(browser)
    to_configure(page); plan(page)
    page.get_by_role('alert').wait_for()
    check('500: friendly error, retry offered', page.get_by_role('button', name='Try again').is_visible())
    check('500: no plan and no technical text shown', not ready_btn(page).is_visible() and not TECH.search(body(page)), body(page)[:80].replace('\n', ' '))
    qa(model='ok', mode='normal')
    page.get_by_role('button', name='Try again').click()
    ready_btn(page).wait_for()
    check('500 -> backend recovers -> Try again shows a real plan', ready_btn(page).is_visible())
    ready_btn(page).click()
    page.get_by_role('heading', name='Ready?').wait_for()
    page.get_by_role('button', name=re.compile('start walking', re.I)).click()
    page.locator('.walk__time').wait_for()
    n = len(posts)
    page.wait_for_timeout(1500)
    check('active walk: shows the timer and sends no further requests', page.locator('.walk__time').is_visible() and len(posts) == n)
    check('journey after a failure: no console errors', errors == [], str(errors))
    ctx.close()

    # 2. 200 with a garbage body
    qa(mode='malformed')
    ctx, page, errors, posts = new_page(browser)
    to_configure(page); plan(page)
    page.get_by_role('alert').wait_for()
    check('malformed 200: error screen, never a fake plan, no technical text', not ready_btn(page).is_visible() and not TECH.search(body(page)))
    check('malformed 200: no console errors', errors == [], str(errors))
    ctx.close(); qa(mode='normal')

    # 3. connection failure (request aborted) then recovery
    ctx, page, errors, posts = new_page(browser)
    page.route('**/walks/plan', lambda route: route.abort('connectionrefused'))
    to_configure(page); plan(page)
    page.get_by_role('alert').wait_for()
    check("connection refused: 'can't be reached' copy, no technical text", re.search(r"can.t be reached", body(page)) and not TECH.search(body(page)), body(page)[:90].replace('\n', ' '))
    page.unroute('**/walks/plan')
    page.get_by_role('button', name='Try again').click()
    ready_btn(page).wait_for()
    check('connection refused -> Try again -> plan', ready_btn(page).is_visible())
    check('connection refused: no uncaught page errors', errors == [], str(errors))
    ctx.close()

    # 4. HTTP 429 and 503 with server text in the body
    for status in (429, 503):
        ctx, page, errors, posts = new_page(browser)
        page.route('**/walks/plan', lambda route, request, s=status: route.fulfill(status=s, content_type='application/json', body='{"error":"SERVER-INTERNAL-TEXT"}'))
        to_configure(page); plan(page)
        page.get_by_role('alert').wait_for()
        check(f'HTTP {status}: clean error, server text and status never shown', 'SERVER-INTERNAL-TEXT' not in body(page) and not TECH.search(body(page)))
        ctx.close()

    # 5. a request that never answers: the client timeout (30 s, fake clock) ends loading
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.clock.install()
    page.route('**/walks/plan', lambda route: None)  # never fulfilled
    page.goto(BASE)
    page.get_by_role('button', name='Start a walk').click()
    plan(page)
    page.wait_for_timeout(300)
    page.clock.fast_forward(31_000)
    page.get_by_role('alert').wait_for()
    check('timeout: loading ends with friendly copy', re.search(r'longer than expected', body(page)) is not None and not TECH.search(body(page)))
    page.unroute_all(behavior='ignoreErrors')  # the never-fulfilled route would otherwise warn on teardown
    ctx.close()

    # 6. double-click on Plan sends exactly one request
    qa(model='slow', weather='clear', mode='normal')
    ctx, page, errors, posts = new_page(browser)
    to_configure(page)
    page.get_by_role('button', name='Plan my walk').dblclick()
    ready_btn(page).wait_for(timeout=30_000)
    check('double-click Plan: exactly one POST', len(posts) == 1, str(len(posts)))
    ctx.close()

    # 7. model unavailable / unsafe -> the backend's safe fallback is shown as an ordinary plan
    for model in ('down', 'unsafe', 'hang'):
        qa(model=model, weather='down', mode='normal')
        ctx, page, errors, posts = new_page(browser)
        to_configure(page); plan(page)
        ready_btn(page).wait_for(timeout=45_000)
        txt = body(page)
        check(f'model={model}, weather down: an ordinary plan is shown, no failure or technical language', ready_btn(page).is_visible() and not TECH.search(txt) and not re.search(r'error|failed|unavailable|went wrong', txt, re.I), txt[:70].replace('\n', ' '))
        check(f'model={model}: no console errors', errors == [], str(errors))
        ctx.close()

    # 8. cancel during generation, then a fresh attempt works
    qa(model='slow', weather='clear', mode='normal')
    ctx, page, errors, posts = new_page(browser)
    to_configure(page); plan(page)
    page.get_by_role('button', name='Cancel').click(timeout=10_000)
    check('cancel returns to the form', page.get_by_role('button', name='Plan my walk').is_visible())
    qa(model='ok')
    plan(page)
    ready_btn(page).wait_for()
    check('after cancel, planning again works', ready_btn(page).is_visible())
    ctx.close()

    browser.close()

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
