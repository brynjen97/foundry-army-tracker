/** Round to two decimals — one hundredth of a gold piece is exactly one copper. */
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Format a number for display, dropping ".00" from whole values. */
export const fmt = (v) => {
  const n = round2(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/**
 * Escape text destined for chat HTML.
 *
 * Foundry exposes Handlebars globally today, but the bare globals have been
 * moving into namespaces across versions, and escaping is too important to
 * let depend on one. Use Handlebars when it is there, otherwise escape here.
 */
export const escapeHTML = (value) => {
  const str = String(value ?? "");
  const hb = globalThis.Handlebars;
  if (typeof hb?.escapeExpression === "function") return hb.escapeExpression(str);
  return str.replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]);
};

/** Resolve a core document class from its namespace, falling back to the global. */
export const docClass = (name) =>
  globalThis.foundry?.documents?.[name] ?? globalThis[name];
