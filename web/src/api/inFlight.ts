/** DOM-free request activity store. Each begin returns an idempotent release. */
export function createInFlightStore(delay = 150) {
  let count = 0;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: boolean) {
    if (visible === next) return;
    visible = next;
    listeners.forEach((listener) => listener());
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => visible,
    getCount: () => count,
    begin() {
      count++;
      if (count === 1) timer = setTimeout(() => { timer = undefined; publish(true); }, delay);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--count === 0) {
          clearTimeout(timer);
          timer = undefined;
          publish(false);
        }
      };
    },
  };
}
export const inFlight = createInFlightStore();
