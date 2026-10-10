import * as Sentry from '@sentry/node';
import { dropBreadcrumb, scrubEvent, scrubSpan } from './scrubEvent';

/**
 * Hosts that receive a user's city or rounded coordinates in the query string.
 * Sentry's automatic fetch instrumentation records the full URL of outgoing requests (span attributes
 * and breadcrumbs), which would put a location into telemetry. Requests to these hosts are therefore
 * excluded from automatic spans and breadcrumbs. PocketWalk's own `weather.fetch` span still measures
 * the lookup, with enumerated attributes only.
 */
export const LOCATION_HOSTS = ['api.open-meteo.com', 'geocoding-api.open-meteo.com'];

function isLocationUrl(url: string, hosts: readonly string[]): boolean {
  try {
    return hosts.includes(new URL(url).host);
  } catch {
    return false;
  }
}

/** Privacy settings shared by production (instrument.ts) and the privacy test, so they cannot drift apart. */
export function sentryPrivacyOptions(hosts: readonly string[] = LOCATION_HOSTS): Pick<Sentry.NodeOptions, 'dataCollection' | 'integrations' | 'beforeSend' | 'beforeSendSpan' | 'beforeBreadcrumb'> {
  return {
    // PocketWalk never needs user info, cookies, headers, query strings, or bodies in Sentry.
    // (@sentry/node v11 replaced `sendDefaultPii` with `dataCollection`.)
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: (event) => scrubEvent(event),
    // Spans are streamed by default in this SDK, so beforeSendTransaction would be ignored (and warn).
    beforeSendSpan: Sentry.withStreamedSpan((span) => scrubSpan(span)),
    beforeBreadcrumb: dropBreadcrumb,
    integrations: [Sentry.nativeNodeFetchIntegration({ ignoreOutgoingRequests: (url) => isLocationUrl(url, hosts) })],
  };
}
