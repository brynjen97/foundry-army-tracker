export const MODULE_ID = "foundry-army-tracker";

export const SETTING_DATA = "armyData";

/** Ranks seeded on first run. Fully editable under Configure Army Tracker. */
export const DEFAULT_RANKS = [
  { id: "soldier",    label: "ARMY.Rank.soldier",    wage: 1 },
  { id: "corporal",   label: "ARMY.Rank.corporal",   wage: 2 },
  { id: "sergeant",   label: "ARMY.Rank.sergeant",   wage: 3 },
  { id: "lieutenant", label: "ARMY.Rank.lieutenant", wage: 5 },
  { id: "captain",    label: "ARMY.Rank.captain",    wage: 8 }
];

/** Deductions applied to newly added roster members. Editable in the config menu. */
export const DEFAULT_DEDUCTIONS = [
  { label: "ARMY.DefaultDeduction.food",   amount: 0.2 },
  { label: "ARMY.DefaultDeduction.upkeep", amount: 0.1 }
];

/**
 * Army hierarchy, largest to smallest. The army is the single root of the tree;
 * squads are the leaves and hold individual soldiers.
 */
export const LEVELS = [
  { type: "army",    childKey: "hosts",     childType: "host" },
  { type: "host",    childKey: "companies", childType: "company" },
  { type: "company", childKey: "cohorts",   childType: "cohort" },
  { type: "cohort",  childKey: "squads",    childType: "squad" },
  { type: "squad",   childKey: null,        childType: null }
];

/** Depth of each level, keyed by type — handy when walking the tree. */
export const LEVEL_DEPTH = Object.fromEntries(LEVELS.map((l, i) => [l.type, i]));

/** Default title given to the commanding officer at each level. */
export const DEFAULT_OFFICER_TITLES = {
  army: "ARMY.OfficerTitle.army",
  host: "ARMY.OfficerTitle.host",
  company: "ARMY.OfficerTitle.company",
  cohort: "ARMY.OfficerTitle.cohort",
  squad: "ARMY.OfficerTitle.squad"
};

/** How many of each sub-unit "automatically populate army" creates. */
export const COUNT_SETTINGS = {
  hostsPerArmy: 2,
  companiesPerHost: 3,
  cohortsPerCompany: 3,
  squadsPerCohort: 4,
  soldiersPerSquad: 10
};
