import { round2 } from "./util.mjs";

/**
 * Optional Pathfinder 2e integration.
 *
 * Vault balances are plain numbers, interpreted as gold pieces. Because a gp is
 * exactly 100 cp, rounding balances to two decimals keeps every vault figure on
 * a whole copper piece — no value is ever lost in conversion.
 *
 * Every helper here degrades gracefully: on other systems the tracker still
 * works, deposits and withdrawals just move the ledger without touching any
 * character sheet.
 */

export function isPF2e() {
  return game.system?.id === "pf2e";
}

/** Whether we can actually move coins in and out of this actor's inventory. */
export function supportsInventoryTransfer(actor) {
  return !!actor
    && isPF2e()
    && typeof actor.inventory?.addCoins === "function"
    && typeof actor.inventory?.removeCoins === "function";
}

/**
 * Total coin the actor is carrying, in gp.
 * @returns {number|null} null when the system has no inventory integration.
 */
export function carriedGold(actor) {
  if (!supportsInventoryTransfer(actor)) return null;
  const coins = actor.inventory.coins ?? {};
  const pp = Number(coins.pp) || 0;
  const gp = Number(coins.gp) || 0;
  const sp = Number(coins.sp) || 0;
  const cp = Number(coins.cp) || 0;
  return round2(pp * 10 + gp + sp / 10 + cp / 100);
}

/** Split a gp amount into PF2e denominations, largest first (no platinum). */
export function goldToCoins(gold) {
  let remainder = Math.max(0, Math.round(round2(gold) * 100));
  const gp = Math.floor(remainder / 100);
  remainder -= gp * 100;
  const sp = Math.floor(remainder / 10);
  remainder -= sp * 10;
  return { gp, sp, cp: remainder };
}

/** Human-readable coin string, e.g. "12 gp 5 sp". */
export function coinLabel(gold) {
  const { gp, sp, cp } = goldToCoins(gold);
  const parts = [];
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (cp) parts.push(`${cp} cp`);
  return parts.join(" ") || "0 gp";
}

/**
 * Remove coin from the actor's inventory. PF2e makes change across
 * denominations automatically when removing by value.
 * @returns {Promise<boolean>} false when the actor cannot cover the amount.
 */
export async function takeFromActor(actor, gold) {
  if (!supportsInventoryTransfer(actor)) return true;
  try {
    const removed = await actor.inventory.removeCoins(goldToCoins(gold), { byValue: true });
    return removed !== false;
  } catch (err) {
    console.error("foundry-army-tracker | Failed to remove coins", err);
    return false;
  }
}

/**
 * Add coin to the actor's inventory.
 * @returns {Promise<boolean>} false when the coins could not be created.
 */
export async function giveToActor(actor, gold) {
  if (!supportsInventoryTransfer(actor)) return true;
  try {
    await actor.inventory.addCoins(goldToCoins(gold));
    return true;
  } catch (err) {
    console.error("foundry-army-tracker | Failed to add coins", err);
    return false;
  }
}
