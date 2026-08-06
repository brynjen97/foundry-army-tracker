/** Round to two decimals — one hundredth of a gold piece is exactly one copper. */
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Format a number for display, dropping ".00" from whole values. */
export const fmt = (v) => {
  const n = round2(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};
