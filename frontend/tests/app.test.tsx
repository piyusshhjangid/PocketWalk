import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/apiError';
import { parseWalkResult } from '../src/api/parseWalkResult';
import type { WalkApi } from '../src/api/walkApi';
import { App } from '../src/app/App';
import type { WalkRequest, WalkResult } from '../src/types/walk';
import { fixture } from './fixtures';

const aiResult = parseWalkResult(fixture('model-plan-weather').body);
const fallbackResult = parseWalkResult(fixture('fallback-model-unavailable').body);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

function setup(planWalk: WalkApi['planWalk']) {
  const api = { planWalk: vi.fn(planWalk) };
  const user = userEvent.setup();
  render(<App api={api} />);
  return { api, user };
}
const toConfigure = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Start a walk' }));
const plan = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Plan my walk' }));

describe('home', () => {
  it('explains the product and offers one primary action, with no tech branding', () => {
    setup(async () => aiResult);
    expect(screen.getByRole('heading', { level: 1, name: 'PocketWalk' })).toBeInTheDocument();
    expect(screen.getByText(/a little less screen/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/gemma|sentry|model|weather api/i);
  });
});

describe('configuration', () => {
  it('offers exactly the backend-supported durations and energies, with sensible defaults', async () => {
    const { user } = setup(async () => aiResult);
    await toConfigure(user);
    const minutes = within(screen.getByRole('group', { name: 'How long?' })).getAllByRole('radio');
    expect(minutes.map((r) => (r as HTMLInputElement).value)).toEqual(['10', '20', '40']);
    const energy = within(screen.getByRole('group', { name: 'How does it feel today?' })).getAllByRole('radio');
    expect(energy.map((r) => (r as HTMLInputElement).value)).toEqual(['easy', 'normal']);
    expect(screen.getByRole('radio', { name: /20 min/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Easy/ })).toBeChecked();
  });

  it('selecting a duration and an intensity builds the matching request (no location by default)', async () => {
    const { api, user } = setup(async () => aiResult);
    await toConfigure(user);
    await user.click(screen.getByRole('radio', { name: /40 min/ }));
    await user.click(screen.getByRole('radio', { name: /Normal/ }));
    await plan(user);
    expect(api.planWalk).toHaveBeenCalledTimes(1);
    expect(api.planWalk.mock.calls[0]?.[0]).toEqual({ minutes: 40, energy: 'normal' } satisfies WalkRequest);
  });

  it('sends a trimmed city only when one is typed, and never asks for GPS', async () => {
    const geo = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    const { api, user } = setup(async () => aiResult);
    await toConfigure(user);
    await user.type(screen.getByLabelText(/city/i), '  Jalandhar ');
    await plan(user);
    expect(api.planWalk.mock.calls[0]?.[0]).toEqual({ minutes: 20, energy: 'easy', location: { city: 'Jalandhar' } });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('blocks an invalid city with an accessible message and sends nothing', async () => {
    const { api, user } = setup(async () => aiResult);
    await toConfigure(user);
    const input = screen.getByLabelText(/city/i);
    await user.type(input, 'Pune123');
    await plan(user);
    expect(api.planWalk).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/2 to 80 letters/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('generating', () => {
  it('shows a status, no fake progress and no internals while waiting', async () => {
    const d = deferred<WalkResult>();
    const { user } = setup(() => d.promise);
    await toConfigure(user);
    await plan(user);
    expect(screen.getByRole('status')).toHaveTextContent(/preparing your walk/i);
    expect(document.body.textContent).not.toMatch(/\d+\s?%|gemma|weather|validat|sentry/i);
    d.resolve(aiResult);
    await screen.findByRole('heading', { level: 1, name: aiResult.plan.title });
  });

  it('sends ONE request for rapid repeated activation', async () => {
    const d = deferred<WalkResult>();
    const { api, user } = setup(() => d.promise);
    await toConfigure(user);
    const submit = screen.getByRole('button', { name: 'Plan my walk' });
    await user.dblClick(submit);
    await user.click(submit);
    await user.keyboard('{Enter}');
    expect(api.planWalk).toHaveBeenCalledTimes(1);
    d.resolve(aiResult);
    await screen.findByRole('button', { name: /i.m ready/i });
    expect(api.planWalk).toHaveBeenCalledTimes(1);
  });

  it('does not offer Cancel instantly, so a double-tap on the start button cannot abort its own request', async () => {
    const d = deferred<WalkResult>();
    const { api, user } = setup(() => d.promise);
    await toConfigure(user);
    await plan(user);
    await user.click(screen.getByRole('status')); // a stray second tap landing on the new screen
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/preparing/i);
    expect(api.planWalk).toHaveBeenCalledTimes(1);
    d.resolve(aiResult);
    await screen.findByRole('button', { name: /i.m ready/i });
  });

  it('cancel aborts the request, returns to the form with choices kept, and ignores a late answer', { timeout: 10000 }, async () => {
    const d = deferred<WalkResult>();
    let signal: AbortSignal | undefined;
    const { api, user } = setup((_r, o) => ((signal = o?.signal), d.promise));
    await toConfigure(user);
    await user.click(screen.getByRole('radio', { name: /10 min/ }));
    await plan(user);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 3000 }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('radio', { name: /10 min/ })).toBeChecked();
    d.resolve(aiResult); // arrives too late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /i.m ready/i })).not.toBeInTheDocument();
    expect(api.planWalk).toHaveBeenCalledTimes(1);
  });
});

describe('plan screen', () => {
  it('renders an AI plan: duration, intensity, title, steps, notice, outdoors, and one action', async () => {
    const { user } = setup(async () => aiResult);
    await toConfigure(user);
    await plan(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Slow loop, listening walk' })).toBeInTheDocument();
    expect(screen.getByText(/20 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/Easy/)).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('8 min');
    expect(items[0]).toHaveTextContent('Walk out slowly along the nearest footpath.');
    expect(screen.getByText('Notice how many shades of green you can find.')).toBeInTheDocument();
    expect(screen.getByText('18°C, light rain.')).toBeInTheDocument();
    expect(screen.queryByText(/ready-made/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/gemma|google|validation|latency|\{|\}/i);
  });

  it('renders a fallback plan as a normal plan, without failure language', async () => {
    const { user } = setup(async () => fallbackResult);
    await toConfigure(user);
    await plan(user);
    expect(await screen.findByRole('heading', { level: 1, name: fallbackResult.plan.title })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /i.m ready/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/fail|error|gemma|unavailable|timeout|fallback/i);
  });

  it('renders model-written text as text, never as HTML', async () => {
    const hostile: WalkResult = {
      ...aiResult,
      plan: { title: '<img src=x onerror=alert(1)>Walk', steps: [{ minutes: 20, text: '<script>window.__pwned = true</script><b>bold</b>' }], notice: '<a href="javascript:alert(1)">tap</a>' },
    };
    const { user } = setup(async () => hostile);
    await toConfigure(user);
    await plan(user);
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('img, script, b, a')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<img src=x onerror=alert(1)>Walk');
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('moves from the plan to the ready screen and back', async () => {
    const { user } = setup(async () => aiResult);
    await toConfigure(user);
    await plan(user);
    await user.click(await screen.findByRole('button', { name: /i.m ready/i }));
    expect(screen.getByRole('heading', { level: 1, name: 'Ready?' })).toBeInTheDocument();
    expect(screen.getByText(/your plan is set/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start walking' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the plan' }));
    expect(screen.getByRole('heading', { level: 1, name: aiResult.plan.title })).toBeInTheDocument();
  });

  it('Change walk returns to the form with the previous choices', async () => {
    const { user } = setup(async () => aiResult);
    await toConfigure(user);
    await user.click(screen.getByRole('radio', { name: /40 min/ }));
    await plan(user);
    await user.click(await screen.findByRole('button', { name: 'Change walk' }));
    expect(screen.getByRole('radio', { name: /40 min/ })).toBeChecked();
  });
});

describe('errors and retry', () => {
  const cases: [string, ApiError, RegExp][] = [
    ['network', new ApiError('network'), /can.t be reached/i],
    ['timeout', new ApiError('timeout'), /longer than expected/i],
    ['server', new ApiError('server', 500), /something went wrong on our side/i],
    ['malformed', new ApiError('malformed', 200), /something went wrong on our side/i],
  ];
  it.each(cases)('shows a clean, recoverable state for %s', async (_n, error, copy) => {
    const { user } = setup(async () => {
      throw error;
    });
    await toConfigure(user);
    await plan(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t prepare your walk/i);
    expect(alert).toHaveTextContent(copy);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change walk' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/HTTP|\b500\b|stack|zod|http:\/\/|localhost|ApiError/i);
  });

  it('does not offer Try again for a rejected request, only a way to change it', async () => {
    const { user } = setup(async () => {
      throw new ApiError('invalid_request', 400);
    });
    await toConfigure(user);
    await user.type(screen.getByLabelText(/city/i), 'Pune');
    await plan(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/check the city name/i);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change walk' }));
    expect(screen.getByLabelText(/city/i)).toHaveValue('Pune');
  });

  it('Try again repeats the same request once and succeeds', async () => {
    let calls = 0;
    const { api, user } = setup(async () => {
      if (++calls === 1) throw new ApiError('server', 503);
      return aiResult;
    });
    await toConfigure(user);
    await user.click(screen.getByRole('radio', { name: /40 min/ }));
    await plan(user);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await user.dblClick(retry);
    await screen.findByRole('heading', { level: 1, name: aiResult.plan.title });
    expect(api.planWalk).toHaveBeenCalledTimes(2);
    expect(api.planWalk.mock.calls[1]?.[0]).toEqual(api.planWalk.mock.calls[0]?.[0]);
  });
});

describe('keyboard and focus', () => {
  it('completes the whole flow with the keyboard alone', async () => {
    const { api, user } = setup(async () => aiResult);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Start a walk' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 1, name: 'Choose your walk' })).toHaveFocus();

    await user.tab(); // focus starts on the heading, so the next stop is the minutes group (checked radio)
    expect(screen.getByRole('radio', { name: /20 min/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /40 min/ })).toBeChecked();
    await user.tab();
    expect(screen.getByRole('radio', { name: /Easy/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Normal/ })).toBeChecked();
    await user.tab();
    expect(screen.getByLabelText(/city/i)).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Plan my walk' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: aiResult.plan.title })).toHaveFocus());
    expect(api.planWalk.mock.calls[0]?.[0]).toEqual({ minutes: 40, energy: 'normal' });
    await user.tab();
    expect(screen.getByRole('button', { name: /i.m ready/i })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('heading', { level: 1, name: 'Ready?' })).toHaveFocus();
  });

  it('every button is a real button element with an accessible name', async () => {
    const { user } = setup(async () => aiResult);
    await toConfigure(user);
    for (const b of screen.getAllByRole('button')) {
      expect(b.tagName).toBe('BUTTON');
      expect(b).toHaveAccessibleName();
    }
    expect(document.querySelectorAll('[onclick], div[role=button]')).toHaveLength(0);
  });
});
