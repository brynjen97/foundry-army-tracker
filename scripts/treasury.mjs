import { MODULE_ID, SETTING_DATA } from "./constants.mjs";
import { round2, fmt, escapeHTML, docClass } from "./util.mjs";
import { getConfig, getRanks, includeOfficers } from "./settings.mjs";
import { officerCount, unitStrength } from "./structure.mjs";
import { record, snapshot } from "./ledger.mjs";
import { UPKEEP_DEFAULTS } from "./treasure.mjs";

/**
 * The army's war chest.
 *
 * The roster tracks what the party earns; this tracks what the army as a whole
 * has, spends and takes. Wages and upkeep are drawn from it every day, plunder
 * refills it, and it is allowed to go negative — an army in arrears is a
 * campaign problem worth playing out, not an error to refuse.
 */

export const DEFAULT_TREASURY = () => ({ balance: 0 });

/** The treasury, normalised. Always returns an object, even for old worlds. */
export function getTreasury(data) {
  const t = data?.treasury ?? {};
  return { balance: round2(t.balance ?? 0) };
}

export function treasuryEnabled() {
  return game.settings.get(MODULE_ID, "treasuryEnabled") !== false;
}

/** Whether Advance Day draws wages and upkeep from the war chest. */
export function chargeUpkeepEnabled() {
  return treasuryEnabled() && game.settings.get(MODULE_ID, "chargeUpkeep") !== false;
}

function rate(key) {
  const value = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(value) && value >= 0 ? round2(value) : UPKEEP_DEFAULTS[key];
}

/* -------------------------------------------- */
/*  Upkeep                                      */
/* -------------------------------------------- */

/**
 * What the standing army costs per day, before the party's own wages.
 *
 * Soldiers come from the structure tree's rolled-up strength, which means an
 * army you have only sketched still costs something — a squad with no named
 * soldiers musters at its configured size and eats accordingly.
 */
export function armyUpkeep(data) {
  const army = data?.structure?.army;
  if (!army) return { soldiers: 0, officers: 0, soldierCost: 0, officerCost: 0, total: 0 };

  const soldiers = unitStrength(army, 0);
  const officers = includeOfficers() ? officerCount(army, 0) : 0;
  const soldierCost = round2(soldiers * rate("upkeepPerSoldier"));
  const officerCost = round2(officers * rate("upkeepPerOfficer"));
  return {
    soldiers,
    officers,
    perSoldier: rate("upkeepPerSoldier"),
    perOfficer: rate("upkeepPerOfficer"),
    soldierCost,
    officerCost,
    total: round2(soldierCost + officerCost)
  };
}

/* -------------------------------------------- */
/*  Who may look at the books                   */
/* -------------------------------------------- */

/**
 * Whether a user may see the army's finances — the treasury, and every
 * army-scope ledger entry.
 *
 * Three modes, set by the GM: nobody but the GM; anyone holding a rank at or
 * above a chosen one; or the whole table. On top of that each roster member
 * carries an override, so the quartermaster can be let into the books without
 * a promotion and the disgraced captain can be shut out without a demotion.
 * A denial always beats a grant.
 *
 * This is a curtain, not a vault: the underlying data is a world setting and a
 * determined player can read it from the console. It is meant to keep the
 * numbers out of sight at the table, not to defend against your own players.
 */
export function canSeeFinances(user = game.user, data = null) {
  if (!user) return false;
  if (user.isGM) return true;
  if (!treasuryEnabled()) return false;

  const mode = game.settings.get(MODULE_ID, "financeVisibility") ?? "gm";
  const roster = (data ?? getArmyDataLite()).roster ?? [];
  const order = new Map(getRanks().map((r, i) => [r.id, i]));
  const threshold = order.get(game.settings.get(MODULE_ID, "financeMinRank")) ?? Infinity;

  let granted = false;
  for (const member of roster) {
    if (!ownedBy(member, user)) continue;
    const override = member.financeAccess;
    if (override === "deny") return false;
    if (override === "grant") granted = true;
    else if (mode === "all") granted = true;
    else if (mode === "rank" && (order.get(member.rank) ?? -1) >= threshold) granted = true;
  }
  return granted;
}

function ownedBy(member, user) {
  if (!member?.actorId) return false;
  const actor = game.actors.get(member.actorId);
  return !!actor?.testUserPermission(user, "OWNER");
}

/** Read the stored blob directly — avoids importing data.mjs and closing a cycle. */
function getArmyDataLite() {
  return game.settings.get(MODULE_ID, SETTING_DATA) ?? { roster: [] };
}

/**
 * Every user who may see the books, as ids for a chat whisper.
 *
 * Army finances go out as a whisper rather than a public card so that the
 * visibility rule holds in chat as well as in the window — there is no point
 * hiding the war chest behind a rank if every payday announces it to the room.
 */
export function financeAudience(data = null) {
  return game.users
    .filter((u) => u.active && canSeeFinances(u, data))
    .map((u) => u.id);
}

/** A one-line description of the current visibility rule, for the config menu. */
export function financeVisibilitySummary() {
  const mode = game.settings.get(MODULE_ID, "financeVisibility") ?? "gm";
  if (mode === "all") return game.i18n.localize("ARMY.Treasury.visibility.allSummary");
  if (mode === "gm") return game.i18n.localize("ARMY.Treasury.visibility.gmSummary");
  const rank = getRanks().find((r) => r.id === game.settings.get(MODULE_ID, "financeMinRank"));
  return game.i18n.format("ARMY.Treasury.visibility.rankSummary", {
    rank: rank?.label ?? game.i18n.localize("ARMY.Treasury.visibility.noRank")
  });
}

/* -------------------------------------------- */
/*  Moving money in and out                     */
/* -------------------------------------------- */

/**
 * Credit or debit the war chest and write it to the book.
 * Mutates `data` in memory; the caller persists.
 * @returns {number} the resulting balance.
 */
export function applyToTreasury(data, { amount, type, note, memberName = null, memberId = null }) {
  const treasury = getTreasury(data);
  const balance = round2(treasury.balance + round2(amount));
  data.treasury = { ...treasury, balance };
  record(data, { type, scope: "army", amount: round2(amount), target: "treasury", balance, note, memberName, memberId });
  return balance;
}

/** GM-only: record a haul, a grant, or a correction against the war chest. */
export async function creditTreasury({ amount, type = "loot", note = "", announce = true }) {
  if (!game.user.isGM) return null;
  const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_DATA) ?? {});
  data.roster ??= [];
  snapshot(data, game.i18n.localize(`ARMY.Ledger.type.${type}`));
  const balance = applyToTreasury(data, { amount, type, note });
  await game.settings.set(MODULE_ID, SETTING_DATA, data);
  if (announce) await announceTreasury({ amount, note, balance, type });
  return balance;
}

/** GM-only: set the war chest to an exact figure, recording the difference. */
export async function setTreasuryBalance(target, note = "") {
  if (!game.user.isGM) return null;
  const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_DATA) ?? {});
  data.roster ??= [];
  const current = getTreasury(data).balance;
  const delta = round2(round2(target) - current);
  if (!delta) return current;
  snapshot(data, game.i18n.localize("ARMY.Ledger.type.adjust"));
  const balance = applyToTreasury(data, { amount: delta, type: "adjust", note });
  await game.settings.set(MODULE_ID, SETTING_DATA, data);
  return balance;
}

async function announceTreasury({ amount, note, balance, type }) {
  const cfg = getConfig();
  const positive = amount >= 0;
  await docClass("ChatMessage").create({
    content: `
      <div class="at-payday">
        <h3><i class="fa-solid fa-sack-dollar"></i> ${game.i18n.localize(`ARMY.Ledger.type.${type}`)}</h3>
        <p>${game.i18n.format(positive ? "ARMY.Treasury.chatGain" : "ARMY.Treasury.chatLoss", {
          amount: fmt(Math.abs(amount)),
          currency: escapeHTML(cfg.currency)
        })}</p>
        ${note ? `<p>${escapeHTML(note)}</p>` : ""}
        <p class="at-currency-note">${game.i18n.format("ARMY.Treasury.chatBalance", {
          balance: fmt(balance), currency: escapeHTML(cfg.currency)
        })}</p>
      </div>`,
    speaker: { alias: game.i18n.localize("ARMY.Payday.speaker") }
  });
}

/* -------------------------------------------- */
/*  Shares of plunder                           */
/* -------------------------------------------- */

/**
 * What each member takes from a distribution.
 *
 * Equal shares split the pot evenly. Shares by rank weight each member by
 * their base daily wage, which is already the module's measure of seniority
 * and saves inventing a second one — a captain on 8 gp draws eight times a
 * soldier on 1 gp. A roster where every weight is zero falls back to equal
 * shares rather than dividing by nothing.
 */
export function shareSplit(roster, { amount, mode = "equal", wageOf }) {
  const total = round2(amount);
  if (!roster.length || total <= 0) return [];

  const weights = roster.map((m) => (mode === "rank" ? Math.max(0, round2(wageOf(m))) : 1));
  let sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shareSplit(roster, { amount, mode: "equal", wageOf });

  // Hand out the rounded shares, then give the rounding crumbs to the last
  // member, so the parts always add up to exactly what left the war chest.
  const shares = weights.map((w) => round2((total * w) / sum));
  const drift = round2(total - shares.reduce((a, b) => a + b, 0));
  if (drift) shares[shares.length - 1] = round2(shares[shares.length - 1] + drift);
  return roster.map((member, i) => ({ member, share: shares[i] }));
}
