import { spyOn } from "bun:test";

/** Hold a deadline's SIGTERM until the child confirms its handler is installed. */
export async function withReadyTimeout<T>(
  timeoutMs: number,
  isReady: () => Promise<boolean>,
  run: () => Promise<T>,
): Promise<T> {
  const nativeSetTimeout = globalThis.setTimeout;
  let readinessError: unknown;
  const gatedSetTimeout = (...[callback, delay, ...args]: Parameters<typeof setTimeout>) =>
    nativeSetTimeout(
      delay === timeoutMs
        ? async () => {
            try {
              const deadline = performance.now() + 10_000;
              while (!(await isReady())) {
                if (performance.now() >= deadline) throw new Error("Child did not become ready");
                await new Promise((resolve) => nativeSetTimeout(resolve, 10));
              }
            } catch (error) {
              readinessError = error;
            }
            // Also terminate on handshake failure, so the child cannot outlive the test.
            callback(...args);
          }
        : callback,
      delay,
      ...args,
    );
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(
    Object.assign(gatedSetTimeout, nativeSetTimeout),
  );
  try {
    const result = await run();
    if (readinessError !== undefined) throw readinessError;
    return result;
  } finally {
    timer.mockRestore();
  }
}
