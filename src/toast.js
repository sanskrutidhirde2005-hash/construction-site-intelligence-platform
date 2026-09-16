/* Minimal toast bus — notify("Saved") from anywhere, <ToastHost /> renders.
   No dependencies, no context: a tiny subscriber list + auto-dismiss. */

const listeners = new Set();
let seq = 0;

function emit(change) {
  for (const fn of listeners) {
    try {
      fn(change);
    } catch {
      /* a dead host must never break the caller */
    }
  }
}

export function notify(message, kind = "info") {
  emit({ id: `${Date.now()}-${seq++}`, message: String(message), kind });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
