import {
  COUNT_SETTINGS,
  DEFAULT_DEDUCTIONS,
  DEFAULT_OFFICER_TITLES,
  DEFAULT_RANKS,
  LEVELS,
  MODULE_ID,
  SETTING_DATA
} from "./constants.mjs";
import { UPKEEP_DEFAULTS } from "./treasure.mjs";

/**
 * Settings live in two places:
 *  - simple scalars (day lengths, loan cap, currency) appear directly in
 *    Foundry's settings panel;
 *  - lists that need a richer editor (ranks, deductions, officer titles,
 *    army generation) sit behind the "Configure Army Tracker" menu.
 */

export const DEFAULT_STRUCTURE = () => ({
  army: { id: foundry.utils.randomID(), name: "", notes: "", officers: [], hosts: [] }
});

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_DATA, {
    scope: "world",
    config: false,
    type: Object,
    default: { day: 0, roster: [], structure: DEFAULT_STRUCTURE() }
  });

  // Edited through the config menu rather than the settings panel.
  const menuBacked = [
    ["ranks", Array, []],
    ["deductionTemplate", Array, []],
    ["officerTitles", Object, {}],
    ["includeOfficers", Boolean, true],
    ["autoPopulate", Boolean, false],
    ["requisitionApproval", Boolean, true],
    // Army treasury: whether it is tracked at all, whether Advance Day draws
    // from it, and who besides the GM is allowed to look at it.
    ["treasuryEnabled", Boolean, true],
    ["chargeUpkeep", Boolean, true],
    ["financeVisibility", String, "gm"],
    ["financeMinRank", String, ""],
    // Set once the GM's defaults have been written, so that a deliberately
    // emptied list is not mistaken for "never configured" and re-seeded.
    ["seeded", Boolean, false]
  ];
  for (const [key, type, def] of menuBacked) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type, default: def });
  }

  for (const [key, def] of Object.entries(COUNT_SETTINGS)) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: Number, default: def });
  }

  for (const [key, def] of Object.entries(UPKEEP_DEFAULTS)) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: Number, default: def });
  }

  const scalars = [
    ["daysPerWeek", 7],
    ["daysPerMonth", 30],
    ["daysPerYear", 360],
    ["loanMonths", 6],
    ["ledgerCap", 500]
  ];
  for (const [key, def] of scalars) {
    game.settings.register(MODULE_ID, key, {
      name: `ARMY.Settings.${key}.name`,
      hint: `ARMY.Settings.${key}.hint`,
      scope: "world",
      config: true,
      type: Number,
      default: def
    });
  }

  game.settings.register(MODULE_ID, "currency", {
    name: "ARMY.Settings.currency.name",
    hint: "ARMY.Settings.currency.hint",
    scope: "world",
    config: true,
    type: String,
    default: "gp"
  });
}

/* -------------------------------------------- */
/*  Ranks                                       */
/* -------------------------------------------- */

/** Built-in ranks with their labels run through i18n. */
export function builtinRanks() {
  return DEFAULT_RANKS.map((r) => ({ ...r, label: game.i18n.localize(r.label) }));
}

/**
 * Configured ranks, falling back to the built-ins until the GM saves their own.
 * Always returns at least one rank so the roster dropdown is never empty.
 */
export function getRanks() {
  const stored = game.settings.get(MODULE_ID, "ranks");
  if (!Array.isArray(stored) || !stored.length) return builtinRanks();
  // A rank list that lost every entry would break the roster dropdown.
  return stored
    .filter((r) => r && r.id)
    .map((r) => ({ id: r.id, label: r.label ?? "", wage: Number(r.wage) || 0 }));
}

export function getRank(rankId) {
  const ranks = getRanks();
  return ranks.find((r) => r.id === rankId) ?? null;
}

/* -------------------------------------------- */
/*  Deductions                                  */
/* -------------------------------------------- */

export function builtinDeductions() {
  return DEFAULT_DEDUCTIONS.map((d) => ({ ...d, label: game.i18n.localize(d.label) }));
}

/** Deduction lines given to each newly added roster member. May be empty by choice. */
export function getDeductionTemplate() {
  const stored = game.settings.get(MODULE_ID, "deductionTemplate");
  if (!Array.isArray(stored)) return builtinDeductions();
  if (!stored.length && !isSeeded()) return builtinDeductions();
  return stored.map((d) => ({ label: d.label ?? "", amount: Number(d.amount) || 0 }));
}

export function isSeeded() {
  return game.settings.get(MODULE_ID, "seeded") === true;
}

/**
 * Write the built-in defaults into the editable settings the first time a GM
 * loads the world, so the config menu opens with something to edit rather than
 * a blank form. Runs once; afterwards the GM's own values stand.
 */
export async function seedDefaults() {
  if (!game.user.isGM || isSeeded()) return;
  if (!game.settings.get(MODULE_ID, "ranks")?.length) {
    await game.settings.set(MODULE_ID, "ranks", builtinRanks());
  }
  if (!game.settings.get(MODULE_ID, "deductionTemplate")?.length) {
    await game.settings.set(MODULE_ID, "deductionTemplate", builtinDeductions());
  }
  const titles = game.settings.get(MODULE_ID, "officerTitles") ?? {};
  if (!Object.keys(titles).length) {
    await game.settings.set(MODULE_ID, "officerTitles", getOfficerTitles());
  }
  await game.settings.set(MODULE_ID, "seeded", true);
}

/* -------------------------------------------- */
/*  Officers                                    */
/* -------------------------------------------- */

export function includeOfficers() {
  return game.settings.get(MODULE_ID, "includeOfficers") !== false;
}

/** Default officer title for each level, stored values overriding the built-ins. */
export function getOfficerTitles() {
  const stored = game.settings.get(MODULE_ID, "officerTitles") ?? {};
  const titles = {};
  for (const level of LEVELS) {
    const custom = stored[level.type];
    titles[level.type] = (typeof custom === "string" && custom.trim())
      ? custom
      : game.i18n.localize(DEFAULT_OFFICER_TITLES[level.type]);
  }
  return titles;
}

/* -------------------------------------------- */
/*  Army generation                             */
/* -------------------------------------------- */

export function getCounts() {
  const counts = {};
  for (const key of Object.keys(COUNT_SETTINGS)) {
    const value = Math.floor(Number(game.settings.get(MODULE_ID, key)));
    counts[key] = Number.isFinite(value) && value >= 0 ? value : COUNT_SETTINGS[key];
  }
  return counts;
}

export function autoPopulateEnabled() {
  return game.settings.get(MODULE_ID, "autoPopulate") === true;
}

/** Whether requisitions must be signed off by the ranking party member. */
export function requisitionApprovalRequired() {
  return game.settings.get(MODULE_ID, "requisitionApproval") === true;
}

export function soldiersPerSquad() {
  return getCounts().soldiersPerSquad;
}

/* -------------------------------------------- */
/*  Pay periods                                 */
/* -------------------------------------------- */

export function getConfig() {
  return {
    daysPerWeek: game.settings.get(MODULE_ID, "daysPerWeek"),
    daysPerMonth: game.settings.get(MODULE_ID, "daysPerMonth"),
    daysPerYear: game.settings.get(MODULE_ID, "daysPerYear"),
    loanMonths: game.settings.get(MODULE_ID, "loanMonths"),
    currency: game.settings.get(MODULE_ID, "currency"),
    ledgerCap: game.settings.get(MODULE_ID, "ledgerCap")
  };
}
