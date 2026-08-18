import { MODULE_ID, SETTING_DATA } from "./constants.mjs";
import { round2 } from "./util.mjs";

/**
 * The campaign's account book.
 *
 * Every figure in the tracker is the *result* of something — a payday, a loan,
 * a sacked city — and by the time anyone asks "why does Aldric owe 47 gp?" the
 * chat card that would have answered has long since scrolled away. The ledger
 * keeps the answer: an append-only list of entries, written by the same
 * functions that move the money, so a balance can always be traced back.
 *
 * Entries are records of what happened, never a source of truth to recompute
 * from. Balances live on the roster and the treasury as before; the ledger
 * only remembers how they got there.
 */

/** Every entry type, with the icon and tone the UI renders it in. */
export const ENTRY_TYPES = {
  payday:      { icon: "fa-coins",              scope: "member" },
  upkeep:      { icon: "fa-tents",              scope: "army" },
  payroll:     { icon: "fa-money-check-dollar", scope: "army" },
  loan:        { icon: "fa-hand-holding-dollar", scope: "member" },
  repay:       { icon: "fa-rotate-left",        scope: "member" },
  requisition: { icon: "fa-clipboard-check",    scope: "member" },
  deposit:     { icon: "fa-arrow-down-to-bracket", scope: "member" },
  withdraw:    { icon: "fa-arrow-up-from-bracket", scope: "member" },
  bonus:       { icon: "fa-gift",               scope: "member" },
  loot:        { icon: "fa-sack-dollar",        scope: "army" },
  shares:      { icon: "fa-hand-holding-heart", scope: "member" },
  adjust:      { icon: "fa-pen",                scope: "army" },
  undo:        { icon: "fa-clock-rotate-left",  scope: "army" }
};

/** How many entries to keep. Old ones fall off the end rather than growing the world setting without bound. */
export function ledgerCap() {
  const value = Math.floor(Number(game.settings.get(MODULE_ID, "ledgerCap")));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 5000) : 500;
}

/**
 * Append entries to a data object *in memory*.
 *
 * The caller is expected to be mid-mutation and about to persist `data`
 * itself, so this never writes settings — that keeps a money movement and its
 * ledger entry in the same save, and means a failed save loses both together
 * rather than leaving a record of something that never happened.
 */
export function record(data, entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  data.ledger ??= [];

  const day = data.day ?? 0;
  const ts = Date.now();
  const user = game.user?.name ?? "";
  const userId = game.user?.id ?? "";

  for (const entry of list) {
    if (!entry) continue;
    data.ledger.push({
      id: foundry.utils.randomID(),
      day: entry.day ?? day,
      ts,
      user,
      userId,
      type: entry.type ?? "adjust",
      scope: entry.scope ?? ENTRY_TYPES[entry.type]?.scope ?? "army",
      memberId: entry.memberId ?? null,
      memberName: entry.memberName ?? null,
      amount: round2(entry.amount ?? 0),
      target: entry.target ?? "",
      balance: entry.balance === null || entry.balance === undefined ? null : round2(entry.balance),
      note: entry.note ?? ""
    });
  }

  const cap = ledgerCap();
  if (data.ledger.length > cap) data.ledger.splice(0, data.ledger.length - cap);
}

/* -------------------------------------------- */
/*  Undo                                        */
/* -------------------------------------------- */

/**
 * Photograph the balances before a batch change, so one can be taken back.
 *
 * Only one step is kept. The operations worth undoing — a payday, a bonus, a
 * haul — are the ones where a mistyped number moves every balance at once, and
 * a single "that was wrong, put it back" covers the realistic mistake without
 * pretending to be a full history you can walk backwards through.
 *
 * Call this on the data object *before* mutating it.
 */
export function snapshot(data, label) {
  data.undo = {
    label,
    ts: Date.now(),
    day: data.day ?? 0,
    roster: foundry.utils.deepClone(data.roster ?? []),
    treasury: foundry.utils.deepClone(data.treasury ?? {}),
    ledgerLength: (data.ledger ?? []).length
  };
}

/** Whether there is a step to take back, and what it was. */
export function undoLabel(data) {
  return data?.undo?.label ?? null;
}

/**
 * Put the balances back as they were before the last snapshotted change.
 *
 * The ledger is rewound to its previous length and a single `undo` entry is
 * written in place of what was removed, so the book still says something
 * happened — an account that quietly loses a page is worse than one that
 * records the correction.
 */
export async function undoLast(data) {
  const snap = data.undo;
  if (!snap) return null;

  data.roster = foundry.utils.deepClone(snap.roster);
  data.treasury = foundry.utils.deepClone(snap.treasury);
  data.day = snap.day;

  const removed = Math.max(0, (data.ledger ?? []).length - snap.ledgerLength);
  if (removed) data.ledger.splice(snap.ledgerLength, removed);
  delete data.undo;

  record(data, {
    type: "undo",
    scope: "army",
    amount: 0,
    balance: null,
    note: game.i18n.format("ARMY.Ledger.undoNote", { label: snap.label, count: removed })
  });

  await game.settings.set(MODULE_ID, SETTING_DATA, data);
  return { label: snap.label, removed };
}
