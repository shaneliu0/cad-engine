export interface Limiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export function createLimiter(maxActive: number): Limiter {
  let active: number = 0;
  const queue: Array<() => void> = [];

  function startNext(): void {
    if (active >= maxActive) {
      return;
    }
    const start: (() => void) | undefined = queue.shift();
    if (start !== undefined) {
      active += 1;
      start();
    }
  }

  function finish(): void {
    active -= 1;
    startNext();
  }

  return {
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      return new Promise<T>((resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
        queue.push((): void => {
          if (signal?.aborted) {
            reject(signal.reason);
            finish();
            return;
          }
          task().then(resolve, reject).finally(finish);
        });
        startNext();
      });
    },
  };
}
