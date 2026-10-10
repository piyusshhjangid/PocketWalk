import type { Breadcrumb, Event } from '@sentry/node';

/**
 * Last line of defence for everything the Sentry SDK is about to send. PocketWalk's own code already
 * reports only closed-set values (see captureUnexpected and the span attributes); this exists because the
 * SDK has other ways to build events (unhandled rejections, uncaught exceptions, console breadcrumbs,
 * request data) that the app does not control, and "we removed one message field" is not a guarantee.
 *
 * Policy:
 *  - exception messages are replaced with "[redacted]" unless they are PocketWalk's own fixed
 *    "unexpected error in <stage>" text. Error class names and stack frames are kept (code locations, not data).
 *  - request data is reduced to method + URL path. No headers, cookies, body, query string, env.
 *  - no user, no breadcrumbs (breadcrumbs can quote console output and URLs), no local variables.
 */
const OWN_MESSAGE = /^unexpected error in [a-z_]{1,24}$/;

type Scrubbable = Event;

export function scrubEvent<T extends Scrubbable>(event: T): T {
  const e = event;

  for (const ex of e.exception?.values ?? []) {
    if (typeof ex.value === 'string' && !OWN_MESSAGE.test(ex.value)) ex.value = '[redacted]';
    for (const frame of ex.stacktrace?.frames ?? []) delete (frame as { vars?: unknown }).vars;
  }
  // `captureMessage` text is only ever a fixed PocketWalk sentence; parameters would be the risk.
  if (e.logentry) delete e.logentry.params;

  if (e.request) {
    const { method, url } = e.request;
    let path: string | undefined;
    try {
      path = url ? new URL(url, 'http://placeholder.invalid').pathname : undefined;
    } catch {
      path = undefined;
    }
    e.request = { ...(method ? { method } : {}), ...(path ? { url: path } : {}) };
  }

  delete e.user;
  e.breadcrumbs = [];
  return event;
}

/** Nothing is worth a breadcrumb here, and console/http breadcrumbs are exactly where raw text hides. */
export function dropBreadcrumb(_crumb: Breadcrumb): null {
  return null;
}

/**
 * Streamed spans (the SDK default) bypass beforeSendTransaction, so spans get their own scrubber. Our own spans
 * only carry closed-set attributes; this removes the network/client/URL-detail attributes the SDK's http
 * instrumentation adds on the server span (peer/local addresses and ports, query, fragment, headers, user).
 */
const DROP_SPAN_ATTRIBUTE = /^(client\.|network\.(peer|local)\.|url\.(query|fragment)$|http\.query$|http\.request\.header\.|http\.response\.header\.|user\.)/;

export function scrubSpan<T extends { attributes?: Record<string, unknown> }>(span: T): T {
  for (const key of Object.keys(span.attributes ?? {})) {
    if (DROP_SPAN_ATTRIBUTE.test(key)) delete span.attributes?.[key];
  }
  return span;
}
