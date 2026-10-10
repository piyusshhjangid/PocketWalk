"""
Checkpoint 6 browser QA (headless Chromium via Playwright for Python; NOT a project dependency, not run in CI).

Drives the PRODUCTION frontend build (vite preview, :4173) against the REAL compiled backend (:3000,
GEMMA_PROVIDER=none, so every plan is the real deterministic fallback plan). Time is controlled with
Playwright's fake clock (page.clock) so a 10-minute walk takes seconds and every boundary is exact.

Usage:  python3 scripts/browser/cp6_flow.py [BASE_URL] [SHOT_DIR]
Exit code is non-zero if any check fails.
"""
import re
import sys
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/pw-shots'
# Playwright's Python clock API takes seconds for plain numbers (not ms), so datetimes are used throughout.
T0 = datetime(2026, 10, 8, 10, 0, 0, tzinfo=timezone.utc)

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = '') -> None:
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


def new_page(browser, width=390, height=844, touch=True, reduced=None):
    ctx = browser.new_context(
        viewport={'width': width, 'height': height},
        has_touch=touch,
        is_mobile=touch,
        reduced_motion=reduced or 'no-preference',
    )
    page = ctx.new_page()
    errors: list[str] = []
    posts: list[str] = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: posts.append(r.url) if r.method == 'POST' else None)
    page.clock.install(time=T0)
    return ctx, page, errors, posts


def to_ready(page, minutes='10 min', keyboard=False):
    page.goto(BASE)
    page.get_by_role('button', name='Start a walk').click()
    page.get_by_role('radio', name=re.compile(minutes)).check(force=True)
    page.get_by_role('button', name='Plan my walk').click()
    page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).wait_for()
    page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).click()
    page.get_by_role('heading', name='Ready?').wait_for()


def freeze(page):
    """Pause the fake clock at 'now' so only run_for / fast_forward move time."""
    now_ms = page.evaluate('Date.now()')
    page.clock.pause_at(datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc) + timedelta(seconds=1))


def shown_time(page) -> str:
    return page.locator('.walk__time [aria-hidden="true"]').inner_text()


def h1(page) -> str:
    return page.get_by_role('heading', level=1).inner_text().replace('\n', ' ')


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---- 1. full flow on a phone, double-click start, timer, steps, completion --------------------------
    ctx, page, errors, posts = new_page(browser)
    to_ready(page)
    check('ready has a real primary Start walking button', page.get_by_role('button', name='Start walking').count() == 1)
    plan_posts = len([u for u in posts if '/walks/plan' in u])
    check('exactly one plan request so far', plan_posts == 1, str(plan_posts))
    freeze(page)
    page.get_by_role('button', name='Start walking').dblclick()
    page.get_by_role('button', name='Exit walk').wait_for()
    check('double-click started one walk', page.locator('.walk').count() == 1)
    check('intro: phone away line', 'Put your phone away.' in h1(page), h1(page))
    check('timer starts at the requested 10:00', shown_time(page) == '10:00', shown_time(page))
    page.clock.run_for(3000)
    check('3 s later 9:57 (a second Start would have reset to 10:00)', shown_time(page) == '9:57', shown_time(page))
    page.clock.run_for(2000)  # past the 4 s intro
    first_step = h1(page)
    check('after the intro the first step shows', 'Put your phone away' not in first_step and len(first_step) > 5, first_step)
    buttons = [b.inner_text() for b in page.get_by_role('button').all()]
    check('only Exit walk is on screen (no controls to tend)', buttons == ['Exit walk'], str(buttons))
    body = page.inner_text('body')
    check('no AI/provider/weather/technical text on the active screen', not re.search(r'gemma|sentry|model|provider|weather|fallback|°C', body, re.I))
    before = len(posts)
    page.clock.fast_forward(4 * 60_000)  # a frozen page that comes back 4 minutes later
    page.clock.run_for(1000)
    check('after a 4 min jump the time is recalculated (about 5:5x remaining)', shown_time(page).startswith('5:'), shown_time(page))
    check('steps advance on their own', h1(page) != first_step, h1(page))
    check('no network traffic during the walk', len(posts) == before)
    spoken = page.locator('.walk__time .visually-hidden').inner_text()
    check('spoken remaining is minute-level', re.fullmatch(r'About \d+ minutes? remaining|Less than a minute remaining', spoken) is not None, spoken)
    page.clock.fast_forward(10 * 60_000)
    page.clock.run_for(1000)
    page.get_by_role('heading', name='Walk complete.').wait_for()
    check('completes', True)
    check('completion copy', page.get_by_text('Nice.').count() == 1 and page.get_by_text('You spent 10 minutes outside.').count() == 1)
    check('completion heading has focus', page.evaluate("document.activeElement?.textContent") == 'Walk complete.')
    page.clock.run_for(60_000)
    check('complete exactly once', page.get_by_role('heading', name='Walk complete.').count() == 1)
    page.get_by_role('button', name='Done').click()
    page.get_by_role('heading', name='PocketWalk').wait_for()
    check('Done returns home and stores nothing', page.evaluate('localStorage.length + sessionStorage.length') == 0)
    check('no console/page errors in the full flow', errors == [], str(errors))
    ctx.close()

    # ---- 2. exit flows ---------------------------------------------------------------------------------------
    ctx, page, errors, posts = new_page(browser)
    to_ready(page)
    freeze(page)
    page.get_by_role('button', name='Start walking').click()
    page.get_by_role('button', name='Exit walk').wait_for()
    page.clock.run_for(10_000)
    page.get_by_role('button', name='Exit walk').click()
    check('exit asks first (alertdialog)', page.get_by_role('alertdialog', name='End this walk?').count() == 1)
    check('focus is on the safe choice', page.evaluate("document.activeElement?.textContent") == 'Keep walking')
    page.clock.run_for(5000)
    page.get_by_role('button', name='Keep walking').click()
    check('Keep walking: same walk, time not lost (9:45)', shown_time(page) == '9:45', shown_time(page))
    check('focus returns to Exit walk', page.evaluate("document.activeElement?.textContent") == 'Exit walk')
    page.get_by_role('button', name='Exit walk').click()
    # Tab may leave the page into browser UI and wrap back (activeElement is then <body>); that is normal.
    # What must never happen is focus landing on the walk content behind the dialog (it is inert).
    in_inert, visited = 0, []
    for _ in range(8):
        page.keyboard.press('Tab')
        visited.append(page.evaluate("document.activeElement?.tagName === 'BODY' ? 'BODY' : document.activeElement?.textContent"))
        in_inert += page.evaluate("document.activeElement?.closest('.walk__content') ? 1 : 0")
    check('focus never reaches the inert walk behind the exit question (Tab x8)', in_inert == 0 and 'Exit walk' not in visited, str(visited))
    check('both dialog buttons are reachable by Tab', {'Keep walking', 'End walk'} <= set(visited), str(visited))
    page.keyboard.press('Escape')
    check('Escape keeps walking', page.get_by_role('alertdialog').count() == 0 and page.locator('.walk__time').count() == 1)
    page.get_by_role('button', name='Exit walk').click()
    page.get_by_role('button', name='End walk').click()
    page.get_by_role('heading', name='Ready?').wait_for()
    check('End walk returns to Ready with Start available', page.get_by_role('button', name='Start walking').count() == 1)
    check('Ready heading has focus', page.evaluate("document.activeElement?.textContent") == 'Ready?')
    check('no extra plan request from exiting', len([u for u in posts if '/walks/plan' in u]) == 1)
    check('no errors in exit flows', errors == [], str(errors))
    ctx.close()

    # ---- 3. keyboard only, desktop ---------------------------------------------------------------------------
    ctx, page, errors, posts = new_page(browser, 1280, 800, touch=False)
    page.goto(BASE)
    page.get_by_role('button', name='Start a walk').wait_for()
    page.keyboard.press('Tab')
    check('first Tab lands on Start a walk', page.evaluate("document.activeElement?.textContent") == 'Start a walk')
    page.keyboard.press('Enter')
    page.get_by_role('button', name='Plan my walk').wait_for()
    page.get_by_role('button', name='Plan my walk').focus(); page.keyboard.press('Enter')
    page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).wait_for()
    page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).focus(); page.keyboard.press('Enter')
    page.get_by_role('heading', name='Ready?').wait_for()
    page.keyboard.press('Tab')
    check('Tab from the heading lands on Start walking', page.evaluate("document.activeElement?.textContent") == 'Start walking')
    page.keyboard.press('Enter')
    page.get_by_role('button', name='Exit walk').wait_for()
    check('keyboard start works, heading focused', page.evaluate("document.activeElement?.tagName") == 'H1')
    page.keyboard.press('Tab')
    check('Tab reaches Exit walk with a visible focus ring', page.evaluate("document.activeElement?.textContent") == 'Exit walk' and page.evaluate("getComputedStyle(document.activeElement).outlineStyle") != 'none')
    ring = page.evaluate("getComputedStyle(document.activeElement).outlineColor")
    check('focus ring colour is the light blue', ring == 'rgb(158, 197, 255)', ring)
    check('no errors (keyboard)', errors == [], str(errors))
    ctx.close()

    # ---- 4. reduced motion ---------------------------------------------------------------------------------
    for pref, expected in (('no-preference', 'settle'), ('reduce', 'none')):
        ctx, page, errors, _ = new_page(browser, reduced=pref)
        to_ready(page)
        page.get_by_role('button', name='Start walking').click()
        page.get_by_role('button', name='Exit walk').wait_for()
        anim = page.evaluate("getComputedStyle(document.querySelector('.walk')).animationName")
        check(f'reduced-motion={pref}: walk animation is {expected}', anim == expected, anim)
        check(f'reduced-motion={pref}: timer and instruction still work', bool(re.fullmatch(r'\d+:\d\d', shown_time(page))))
        ctx.close()

    # ---- 5. responsive: active, exit and complete screens ---------------------------------------------------
    for w, h in ((360, 740), (390, 844), (430, 932), (1280, 800), (1440, 900)):
        ctx, page, errors, _ = new_page(browser, w, h, touch=w < 800)
        to_ready(page)
        freeze(page)
        page.get_by_role('button', name='Start walking').click()
        page.get_by_role('button', name='Exit walk').wait_for()
        page.clock.run_for(5000)
        ok_active = page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        small = page.evaluate("[...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().height < 44).length")
        page.get_by_role('button', name='Exit walk').click()
        ok_exit = page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_role('button', name='Keep walking').click()
        page.clock.fast_forward(10 * 60_000); page.clock.run_for(1000)
        page.get_by_role('heading', name='Walk complete.').wait_for()
        ok_done = page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        check(f'{w}x{h}: no horizontal overflow (active/exit/complete), all buttons >=44px, no errors',
              ok_active and ok_exit and ok_done and small == 0 and errors == [], f'{ok_active},{ok_exit},{ok_done},small={small},{errors}')
        ctx.close()


    # ---- 5b. refresh during a walk is an exit: the walk is ephemeral by design ------------------------------------
    ctx, page, errors, posts = new_page(browser)
    to_ready(page)
    page.get_by_role('button', name='Start walking').click()
    page.get_by_role('button', name='Exit walk').wait_for()
    page.reload()
    page.get_by_role('button', name='Start a walk').wait_for()
    check('refresh mid-walk returns to Home: no timer, no half-restored state',
          page.locator('.walk').count() == 0 and page.locator('[role=timer]').count() == 0)
    check('nothing about the walk was persisted', page.evaluate('localStorage.length + sessionStorage.length') == 0)
    ctx.close()

    # ---- 6. real (unfaked) browser timer: the page really counts, no waiting 10 minutes ----------------------
    ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    page.goto(BASE)
    page.get_by_role('button', name='Start a walk').click()
    page.get_by_role('radio', name=re.compile('10 min')).check(force=True)
    page.get_by_role('button', name='Plan my walk').click()
    page.get_by_role('button', name=re.compile(r"i.m ready", re.I)).click()
    page.get_by_role('button', name='Start walking').click()
    page.get_by_role('button', name='Exit walk').wait_for()
    t_start = shown_time(page)
    page.wait_for_timeout(3300)
    t_later = shown_time(page)
    m1, s1 = map(int, t_start.split(':')); m2, s2 = map(int, t_later.split(':'))
    delta = (m1 * 60 + s1) - (m2 * 60 + s2)
    check('real, unfaked page: timer advanced by ~3 s in 3.3 s real time', delta in (3, 4), f'{t_start} -> {t_later}')
    ctx.close()


    # ---- 7. screenshots (clock running, so rAF works; no timing assertions here) --------------------------------
    for w, h in ((360, 740), (390, 844), (430, 932), (1280, 800), (1440, 900)):
        ctx, page, errors, _ = new_page(browser, w, h, touch=w < 800)
        to_ready(page)
        page.screenshot(path=f'{SHOTS}/ready-{w}.png')
        page.get_by_role('button', name='Start walking').click()
        page.get_by_role('button', name='Exit walk').wait_for()
        page.screenshot(path=f'{SHOTS}/active-intro-{w}.png')
        page.clock.fast_forward(5000)
        page.wait_for_timeout(300)
        page.screenshot(path=f'{SHOTS}/active-step-{w}.png')
        page.get_by_role('button', name='Exit walk').click()
        page.wait_for_timeout(200)
        page.screenshot(path=f'{SHOTS}/exit-{w}.png')
        page.get_by_role('button', name='Keep walking').click()
        page.clock.fast_forward(10 * 60_000)
        page.get_by_role('heading', name='Walk complete.').wait_for()
        page.screenshot(path=f'{SHOTS}/complete-{w}.png')
        ctx.close()

    browser.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
