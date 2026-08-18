import { round2 } from "./util.mjs";

/**
 * Where the money comes from, and what it costs to keep an army standing.
 *
 * All the figures here are anchored to Pathfinder 2e's own tables so that a
 * haul is worth roughly what the system thinks a challenge of that level is
 * worth, and a soldier costs roughly what the system thinks it costs to feed a
 * person. Every one of them is a *default* — the config menu exposes the
 * upkeep rates and the multipliers, because a grim campaign and a heroic one
 * want very different numbers.
 *
 * Everything is in gold pieces. This layer deliberately does not model items:
 * at the scale of an army, plunder is a number in the war chest, and the
 * interesting individual pieces are things the GM hands out as loot in the
 * usual way.
 */

/* -------------------------------------------- */
/*  Treasure by level                           */
/* -------------------------------------------- */

/**
 * PF2e's Party Treasure by Level — the total value a party of four is expected
 * to gain across a level, in gp.
 *
 * It is used here as a yardstick for "how much wealth is in play at level N"
 * rather than as a budget to hand out: a haul is a multiple of the figure for
 * the level of whoever you beat, or of the settlement you took.
 */
export const TREASURE_BY_LEVEL = {
  1: 175,     2: 300,     3: 500,     4: 850,     5: 1350,
  6: 2000,    7: 2900,    8: 4000,    9: 5700,   10: 8000,
  11: 11500, 12: 16500,  13: 25000,  14: 36500,  15: 54500,
  16: 82500, 17: 128000, 18: 208000, 19: 355000, 20: 490000
};

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

export function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n));
}

/** The wealth yardstick for a level, in gp. */
export function treasureForLevel(level) {
  return TREASURE_BY_LEVEL[clampLevel(level)];
}

/* -------------------------------------------- */
/*  What you beat                               */
/* -------------------------------------------- */

/**
 * Kinds of engagement, as a multiple of the treasure yardstick for the
 * adversary's level.
 *
 * The scale reads as: a skirmish yields pocket change, a pitched battle is
 * worth taking, and a siege — a whole campaign's worth of baggage train,
 * war chest and ransomed officers — is the prize that funds the next season.
 * Soldiers are not treasure chests, so even a won battle is deliberately
 * closer to "a month of upkeep" than to a dragon's hoard.
 */
export const HAUL_KINDS = {
  skirmish: { multiplier: 0.25, icon: "fa-person-rifle" },
  raid:     { multiplier: 0.5,  icon: "fa-fire" },
  battle:   { multiplier: 1,    icon: "fa-khanda" },
  siege:    { multiplier: 3,    icon: "fa-chess-rook" },
  sack:     { multiplier: null, icon: "fa-city" },   // scaled by settlement instead
  other:    { multiplier: 1,    icon: "fa-sack-dollar" }
};

/**
 * Settlement sizes, following PF2e's settlement statistics: a village is level
 * 0–1 and a few hundred souls, a town 2–4, a city 5–9, a metropolis 10+.
 *
 * `level` is the default suggested for that size — the dialog lets the GM set
 * the real one. `plunder` is how many times the level's treasure yardstick a
 * thorough sacking is worth, which is where the size of the place (rather than
 * its level) enters the arithmetic: a metropolis and a village can both be
 * dangerous, but only one of them has warehouses.
 */
export const SETTLEMENTS = {
  village:    { level: 1,  plunder: 3 },
  town:       { level: 3,  plunder: 6 },
  city:       { level: 7,  plunder: 10 },
  metropolis: { level: 12, plunder: 20 }
};

/* -------------------------------------------- */
/*  Generating a haul                           */
/* -------------------------------------------- */

/** The multiplier applied for a given engagement, before variance. */
export function haulMultiplier({ kind, settlement }) {
  if (kind === "sack") return SETTLEMENTS[settlement]?.plunder ?? SETTLEMENTS.town.plunder;
  return HAUL_KINDS[kind]?.multiplier ?? 1;
}

/**
 * What an engagement is worth.
 *
 * `variance` spreads the result over ±25%, so two identical battles do not
 * pay identically — a sacked city might have been stripped by its garrison
 * first, or its bank might have been full. Pass `variance: false` for the
 * exact table figure.
 *
 * @returns {{base: number, multiplier: number, roll: number, total: number}}
 */
export function generateHaul({ kind = "battle", level = 1, settlement = "town", variance = true } = {}) {
  const effectiveLevel = kind === "sack" && !level ? SETTLEMENTS[settlement]?.level : level;
  const base = treasureForLevel(effectiveLevel);
  const multiplier = haulMultiplier({ kind, settlement });
  const roll = variance ? 0.75 + Math.random() * 0.5 : 1;
  return {
    base,
    multiplier,
    roll: round2(roll),
    level: clampLevel(effectiveLevel),
    total: round2(base * multiplier * roll)
  };
}

/* -------------------------------------------- */
/*  What it costs to stand still                */
/* -------------------------------------------- */

/**
 * Daily upkeep per head, in gp.
 *
 * PF2e's cost of living puts subsistence at 4 sp a day and a comfortable life
 * at 1 gp. A soldier in the field lives at subsistence; an officer at
 * something nearer comfortable. Both defaults below are those figures halved,
 * because an army is not an individual buying dinner at an inn: it is
 * state-backed, buys grain by the wagon, requisitions at fixed rates and
 * quarters its troops in tents it already owns. Halving is the blunt
 * expression of that buying power, and it keeps the sums legible at the table.
 *
 * Which leaves: 0.2 gp per soldier per day, 0.5 gp per officer per day. A
 * 480-strong host with 40 officers costs 116 gp a day, or ~3,500 a month —
 * about what sacking a mid-sized town brings in.
 */
export const UPKEEP_DEFAULTS = {
  /** PF2e subsistence (4 sp), halved for state provisioning. */
  upkeepPerSoldier: 0.2,
  /** PF2e comfortable (1 gp), halved on the same reasoning. */
  upkeepPerOfficer: 0.5
};

/** PF2e's cost-of-living rates, kept for the config menu's explanatory hints. */
export const COST_OF_LIVING = {
  subsistence: 0.4,
  comfortable: 1,
  fine: 3,
  extravagant: 10
};
