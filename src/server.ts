// IMPORTANT: instrument must be the first import so Sentry can patch Express and http.
import "./observability/instrument";
import * as Sentry from "@sentry/node";
import { buildAppFromEnv } from "./appFromEnv";
import { loadEnv } from "./config/env";
import { createShutdown } from "./lifecycle/shutdown";

const env = loadEnv();
const { app, readiness, notes } = buildAppFromEnv(env);
for (const n of notes)
  (n.level === "warn" ? console.warn : console.log)(`[pocketwalk] ${n.text}`);

const onListening = (): void => {
  readiness.markReady();
  console.log(
    `[pocketwalk] listening on ${env.HOST ?? "all interfaces"}:${env.PORT} (${env.NODE_ENV})`,
  );
};
const server = env.HOST
  ? app.listen(env.PORT, env.HOST, onListening)
  : app.listen(env.PORT, onListening);

// A port that is taken or not permitted is a startup failure: say so plainly (the code only) and exit non-zero.
server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(
    `[pocketwalk] could not listen on port ${env.PORT}: ${err.code ?? "unknown error"}`,
  );
  process.exit(1);
});

const shutdown = createShutdown({
  server,
  readiness,
  graceMs: env.SHUTDOWN_GRACE_MS,
  closeTelemetry: () => Sentry.close(2000), // flush pending events/traces
  exit: (code) => process.exit(code),
  log: (m) => console.log(m),
});
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// Test-only graceful shutdown trigger for Windows, where child.kill('SIGTERM')
// does not reliably invoke the Node.js signal handler.
if (process.env.POCKETWALK_TEST_SHUTDOWN === "1") {
  process.on("message", (message: unknown) => {
    if (message === "pocketwalk:test-shutdown") {
      void shutdown("SIGTERM");
    }
  });
}
