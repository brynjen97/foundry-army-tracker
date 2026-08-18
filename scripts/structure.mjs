import { LEVELS } from "./constants.mjs";
import { getCounts, getOfficerTitles, includeOfficers, soldiersPerSquad } from "./settings.mjs";

/**
 * The shape of the army: counting it, searching it, and building one.
 *
 * These are pure functions over the structure tree, kept apart from the money
 * so that the treasury can ask "how many mouths am I feeding?" without the
 * ledger and the roster having to know about each other.
 */

/* -------------------------------------------- */
/*  Army strength                               */
/* -------------------------------------------- */

/**
 * How many soldiers a unit contains.
 *
 * A squad counts the soldiers actually named in it; when none have been
 * recorded it falls back to the configured squad size, so a freshly generated
 * army still reports a realistic strength. Every level above a squad is the
 * sum of its children, which is what makes the figure roll all the way up to
 * the army itself.
 *
 * Officers are counted separately — they lead the soldiers rather than
 * padding the headcount.
 */
export function unitStrength(unit, depth) {
  const level = LEVELS[depth];
  if (!level?.childKey) {
    const named = (unit.members ?? []).length;
    return named || soldiersPerSquad();
  }
  return (unit[level.childKey] ?? []).reduce((sum, child) => sum + unitStrength(child, depth + 1), 0);
}

/**
 * Whether a unit answers to a search term, by its own name or by any of its
 * officers. Officer titles count as well as names, so searching "helm" finds
 * every host commander rather than only people called Helm.
 */
export function unitMatches(unit, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const hit = (value) => String(value ?? "").toLowerCase().includes(q);
  if (hit(unit?.name)) return true;
  return (unit?.officers ?? []).some((o) => hit(o.name) || hit(o.title));
}

/** Every unit id at or beneath this one, for bulk expand/collapse. */
export function collectUnitIds(unit, depth, out = []) {
  if (!unit) return out;
  out.push(unit.id);
  const level = LEVELS[depth];
  if (level?.childKey) {
    for (const child of unit[level.childKey] ?? []) collectUnitIds(child, depth + 1, out);
  }
  return out;
}

/** How many officers sit at this unit and every unit beneath it. */
export function officerCount(unit, depth) {
  const level = LEVELS[depth];
  const own = (unit.officers ?? []).length;
  if (!level?.childKey) return own;
  return (unit[level.childKey] ?? []).reduce((sum, child) => sum + officerCount(child, depth + 1), own);
}

/* -------------------------------------------- */
/*  Army generation                             */
/* -------------------------------------------- */

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th" … */
export function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = n % 100;
  return `${n}${suffixes[(remainder - 20) % 10] ?? suffixes[remainder] ?? suffixes[0]}`;
}

function makeOfficer(title) {
  return { id: foundry.utils.randomID(), title: title ?? "", name: "", notes: "" };
}

/**
 * Build a complete army from the configured counts, naming each unit by its
 * ordinal position ("1st Squad", "2nd Squad", …). Squads are left without
 * named soldiers so their strength comes from the squad-size setting; the
 * players can fill in real names as they meet them.
 */
export function buildStructure() {
  const counts = getCounts();
  const titles = getOfficerTitles();
  const withOfficers = includeOfficers();
  const unitName = (index, type) => game.i18n.format("ARMY.Generate.unitName", {
    ordinal: ordinal(index),
    type: game.i18n.localize(`ARMY.Unit.${type}`)
  });

  const make = (type, index) => {
    const level = LEVELS[LEVELS.findIndex((l) => l.type === type)];
    const unit = {
      id: foundry.utils.randomID(),
      name: index === null ? "" : unitName(index, type),
      officers: withOfficers ? [makeOfficer(titles[type])] : []
    };
    if (level.childKey) {
      const perParent = {
        hosts: counts.hostsPerArmy,
        companies: counts.companiesPerHost,
        cohorts: counts.cohortsPerCompany,
        squads: counts.squadsPerCohort
      }[level.childKey] ?? 0;
      unit[level.childKey] = Array.from({ length: perParent }, (_, i) => make(level.childType, i + 1));
    } else {
      unit.members = [];
    }
    return unit;
  };

  const army = make("army", null);
  army.notes = "";
  return { army };
}

/* -------------------------------------------- */
/*  Finding your way around the tree            */
/* -------------------------------------------- */

/**
 * The chain of units from the army down to one particular unit.
 * @returns {Array<{unit: object, depth: number}>|null} null when not found.
 */
export function unitPath(unit, unitId, depth = 0, trail = []) {
  if (!unit) return null;
  const here = [...trail, { unit, depth }];
  if (unit.id === unitId) return here;
  const level = LEVELS[depth];
  if (!level?.childKey) return null;
  for (const child of unit[level.childKey] ?? []) {
    const found = unitPath(child, unitId, depth + 1, here);
    if (found) return found;
  }
  return null;
}

/**
 * Every unit in the tree as a flat list, in reading order, each labelled with
 * its type and indented by depth — the shape a dropdown wants.
 */
export function listUnits(unit, depth = 0, out = []) {
  if (!unit) return out;
  const type = LEVELS[depth].type;
  const name = (unit.name ?? "").trim() || game.i18n.localize(`ARMY.Unit.${type}`);
  out.push({
    id: unit.id,
    depth,
    type,
    name,
    label: `${"\u00a0\u00a0".repeat(depth)}${name}`
  });
  const level = LEVELS[depth];
  if (level?.childKey) {
    for (const child of unit[level.childKey] ?? []) listUnits(child, depth + 1, out);
  }
  return out;
}
