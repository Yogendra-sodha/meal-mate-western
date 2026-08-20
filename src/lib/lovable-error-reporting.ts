export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  // No-op in production build. Error reporting can be integrated with services like
  // Sentry, LogRocket, or similar by replacing this implementation.
  if (typeof window === "undefined") return;
  console.error("Application error:", error, context);
}
