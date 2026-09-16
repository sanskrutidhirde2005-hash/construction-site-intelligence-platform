import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { subscribe } from "./toast";

/* Fixed bottom-center toasts. Auto-dismiss after 4s, click to dismiss
   early, role="status" so screen readers announce them. */

const ICONS = { info: "bell", success: "check", error: "alert" };

function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(
    () =>
      subscribe((toast) => {
        setItems((prev) => [...prev.slice(-2), toast]);
        setTimeout(() => {
          setItems((prev) => prev.filter((t) => t.id !== toast.id));
        }, 4000);
      }),
    []
  );

  if (items.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="status"
          className={`toast toast-${t.kind}`}
          onClick={() =>
            setItems((prev) => prev.filter((x) => x.id !== t.id))
          }
          title="Dismiss"
        >
          <Icon name={ICONS[t.kind] || "bell"} />
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  );
}

export default ToastHost;
