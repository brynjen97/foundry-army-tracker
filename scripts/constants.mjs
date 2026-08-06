export const MODULE_ID = "foundry-army-tracker";

export const SETTING_DATA = "armyData";

/** Ranks available in the roster, with their default daily wage (configurable in settings). */
export const RANKS = {
  soldier:    { label: "ARMY.Rank.soldier",    setting: "wageSoldier",    defaultWage: 1 },
  corporal:   { label: "ARMY.Rank.corporal",   setting: "wageCorporal",   defaultWage: 2 },
  sergeant:   { label: "ARMY.Rank.sergeant",   setting: "wageSergeant",   defaultWage: 3 },
  lieutenant: { label: "ARMY.Rank.lieutenant", setting: "wageLieutenant", defaultWage: 5 },
  captain:    { label: "ARMY.Rank.captain",    setting: "wageCaptain",    defaultWage: 8 }
};

/** Army hierarchy, largest to smallest. Squads hold individual members. */
export const LEVELS = [
  { type: "host",    childKey: "companies", childType: "company" },
  { type: "company", childKey: "cohorts",   childType: "cohort" },
  { type: "cohort",  childKey: "squads",    childType: "squad" },
  { type: "squad",   childKey: null,        childType: null }
];
