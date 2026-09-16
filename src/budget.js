/**
 * Shared Budget Prediction logic — single source of truth for the frontend.
 * Backend (backend/main.py budget endpoint) mirrors this exact formula.
 *
 * CPI-based EAC: predicted = actual / (progress / 100)
 */

/**
 * @param {{ total_budget: number, actual_spent: number, progress: number }} input
 * @returns {{
 *   total_budget: number, actual_spent: number, progress: number,
 *   remaining: number, predicted: number | null,
 *   overrun: number | null, overrun_pct: number | null,
 *   risk: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN",
 *   note: string | null
 * }}
 */
export function calcBudget({ total_budget = 0, actual_spent = 0, progress = 0 }) {
  const budget = Number(total_budget) || 0;
  const spent = Number(actual_spent) || 0;
  const prog = Number(progress) || 0;
  const remaining = budget - spent;

  if (budget <= 0) {
    return {
      total_budget: budget,
      actual_spent: spent,
      progress: prog,
      remaining,
      predicted: null,
      overrun: null,
      overrun_pct: null,
      risk: "UNKNOWN",
      note: "No budget set for this project yet.",
    };
  }

  if (prog <= 0) {
    return {
      total_budget: budget,
      actual_spent: spent,
      progress: prog,
      remaining,
      predicted: null,
      overrun: null,
      overrun_pct: null,
      risk: "UNKNOWN",
      note: "Not enough progress to forecast yet.",
    };
  }

  // Mirror of backend _calc_budget: zero spend with real progress is a
  // missing-data state, not a ₹0 forecast. Keep UNKNOWN, never invent.
  if (spent <= 0) {
    return {
      total_budget: budget,
      actual_spent: spent,
      progress: prog,
      remaining,
      predicted: null,
      overrun: null,
      overrun_pct: null,
      risk: "UNKNOWN",
      note: "No material consumption recorded yet — add used quantities to forecast.",
    };
  }

  const predicted = spent / (prog / 100);
  const overrun = predicted - budget;
  const overrun_pct = (overrun / budget) * 100;
  const risk = overrun_pct > 10 ? "HIGH" : overrun_pct > 0 ? "MEDIUM" : "LOW";

  return {
    total_budget: budget,
    actual_spent: spent,
    progress: prog,
    remaining,
    predicted,
    overrun,
    overrun_pct,
    risk,
    note: null,
  };
}

/** Actual Spent from a materials list: SUM(cost * used_qty). */
export function actualFromMaterials(materials = []) {
  return materials.reduce(
    (sum, m) => sum + (Number(m.cost) || 0) * (Number(m.used_qty ?? m.used) || 0),
    0
  );
}

export function formatINR(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return "₹" + Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** Compact Indian units: ₹5.0 Cr / ₹60 Lakh / full ₹ below 1 Lakh. Mirrors backend _inr_compact. */
export function formatINRCompact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const v = Number(value);
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)} Cr`;
  if (a >= 1e5) return `${sign}₹${Math.round(a / 1e5)} Lakh`;
  return formatINR(v);
}

export const RISK_META = {
  HIGH: { color: "#dc2626", label: "High Risk" },
  MEDIUM: { color: "#ea580c", label: "Medium Risk" },
  LOW: { color: "#16a34a", label: "On Track" },
  UNKNOWN: { color: "#78716c", label: "Unknown" },
};
