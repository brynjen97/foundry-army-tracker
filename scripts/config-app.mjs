import { COUNT_SETTINGS, LEVELS, MODULE_ID } from "./constants.mjs";
import { round2 } from "./util.mjs";
import { highestRankingMember, memberName } from "./data.mjs";
import {
  builtinDeductions,
  builtinRanks,
  getCounts,
  getDeductionTemplate,
  getOfficerTitles,
  getRanks
} from "./settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Editor for everything that is a list rather than a single value: ranks and
 * their pay, the deduction template given to new recruits, officer titles per
 * level, and the army generator.
 *
 * Edits are held in memory and only written to settings on Save, so backing
 * out of a half-finished change costs nothing.
 */
export class ArmyConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "army-tracker-config",
    classes: ["army-tracker", "army-tracker-config"],
    tag: "form",
    window: {
      title: "ARMY.Config.title",
      icon: "fa-solid fa-sliders",
      resizable: true
    },
    position: { width: 640, height: 700 },
    form: {
      handler: ArmyConfigApp._onSubmit,
      closeOnSubmit: true
    },
    actions: {
      addRank: ArmyConfigApp._onAddRank,
      removeRank: ArmyConfigApp._onRemoveRank,
      moveRank: ArmyConfigApp._onMoveRank,
      resetRanks: ArmyConfigApp._onResetRanks,
      addDeduction: ArmyConfigApp._onAddDeduction,
      removeDeduction: ArmyConfigApp._onRemoveDeduction,
      resetDeductions: ArmyConfigApp._onResetDeductions
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/config.hbs`,
      scrollable: [".at-config-body"]
    }
  };

  /** Working copy; nothing is persisted until the form is submitted. */
  #draft = null;

  get draft() {
    this.#draft ??= {
      ranks: getRanks().map((r) => ({ ...r })),
      deductions: getDeductionTemplate().map((d) => ({ ...d })),
      officerTitles: { ...getOfficerTitles() },
      includeOfficers: game.settings.get(MODULE_ID, "includeOfficers") !== false,
      autoPopulate: game.settings.get(MODULE_ID, "autoPopulate") === true,
      requisitionApproval: game.settings.get(MODULE_ID, "requisitionApproval") === true,
      counts: getCounts()
    };
    return this.#draft;
  }

  async _prepareContext() {
    const d = this.draft;
    return {
      ranks: d.ranks.map((r, i) => ({ ...r, index: i, first: i === 0, last: i === d.ranks.length - 1 })),
      deductions: d.deductions.map((x, i) => ({ ...x, index: i })),
      includeOfficers: d.includeOfficers,
      officerLevels: LEVELS.map((l) => ({
        type: l.type,
        label: game.i18n.localize(`ARMY.Unit.${l.type}`),
        title: d.officerTitles[l.type] ?? ""
      })),
      autoPopulate: d.autoPopulate,
      requisitionApproval: d.requisitionApproval,
      // Name whoever currently holds sign-off, so the setting is concrete.
      approverName: (() => {
        const senior = highestRankingMember();
        return senior ? memberName(senior) : null;
      })(),
      counts: Object.keys(COUNT_SETTINGS).map((key) => ({
        key,
        value: d.counts[key],
        label: game.i18n.localize(`ARMY.Config.count.${key}`)
      })),
      projected: this.#projectedStrength(d)
    };
  }

  /** Total soldiers the current counts would produce, shown live in the form. */
  #projectedStrength(d) {
    const c = d.counts;
    return c.hostsPerArmy * c.companiesPerHost * c.cohortsPerCompany * c.squadsPerCohort * c.soldiersPerSquad;
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("input", this.#onInput.bind(this));
  }

  /** Mirror every field into the draft so re-renders never lose typing. */
  #onInput(event) {
    const el = event.target;
    const { field, index, key } = el.dataset;
    if (!field) return;
    const d = this.draft;

    switch (field) {
      case "rankLabel": d.ranks[Number(index)].label = el.value; break;
      case "rankWage": d.ranks[Number(index)].wage = round2(el.value); break;
      case "dedLabel": d.deductions[Number(index)].label = el.value; break;
      case "dedAmount": d.deductions[Number(index)].amount = round2(el.value); break;
      case "officerTitle": d.officerTitles[key] = el.value; break;
      case "includeOfficers":
        d.includeOfficers = el.checked;
        this.render();
        break;
      case "autoPopulate":
        d.autoPopulate = el.checked;
        this.render();
        break;
      case "requisitionApproval":
        d.requisitionApproval = el.checked;
        break;
      case "count": {
        const n = Math.max(0, Math.floor(Number(el.value) || 0));
        d.counts[key] = n;
        const out = this.element.querySelector(".at-projected");
        if (out) out.textContent = game.i18n.format("ARMY.Config.projected", { count: this.#projectedStrength(d) });
        break;
      }
    }
  }

  /* -------------------------------------------- */
  /*  Ranks                                       */
  /* -------------------------------------------- */

  static _onAddRank() {
    this.draft.ranks.push({
      id: foundry.utils.randomID(),
      label: game.i18n.localize("ARMY.Config.newRank"),
      wage: 1
    });
    this.render();
  }

  static async _onRemoveRank(event, target) {
    const index = Number(target.dataset.index);
    const rank = this.draft.ranks[index];
    if (this.draft.ranks.length <= 1) {
      ui.notifications.warn(game.i18n.localize("ARMY.Config.needOneRank"));
      return;
    }
    // Deleting a rank someone currently holds would leave them unbanded.
    const inUse = getArmyRosterRankCount(rank.id);
    if (inUse) {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("ARMY.Config.removeRank") },
        content: `<p>${game.i18n.format("ARMY.Config.rankInUse", { label: rank.label, count: inUse })}</p>`,
        rejectClose: false,
        modal: true
      });
      if (!ok) return;
    }
    this.draft.ranks.splice(index, 1);
    this.render();
  }

  /** Ranks are displayed in list order, so let the GM arrange them by seniority. */
  static _onMoveRank(event, target) {
    const index = Number(target.dataset.index);
    const delta = target.dataset.dir === "up" ? -1 : 1;
    const to = index + delta;
    const ranks = this.draft.ranks;
    if (to < 0 || to >= ranks.length) return;
    [ranks[index], ranks[to]] = [ranks[to], ranks[index]];
    this.render();
  }

  static _onResetRanks() {
    const d = this.draft;
    d.ranks = builtinRanks();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Deductions                                  */
  /* -------------------------------------------- */

  static _onAddDeduction() {
    this.draft.deductions.push({ label: "", amount: 0 });
    this.render();
  }

  static _onRemoveDeduction(event, target) {
    this.draft.deductions.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static _onResetDeductions() {
    const d = this.draft;
    d.deductions = builtinDeductions();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Save                                        */
  /* -------------------------------------------- */

  static async _onSubmit() {
    const d = this.draft;
    const ranks = d.ranks
      .map((r) => ({ id: r.id, label: (r.label ?? "").trim(), wage: round2(r.wage) }))
      .filter((r) => r.label);
    if (!ranks.length) {
      ui.notifications.error(game.i18n.localize("ARMY.Config.needOneRank"));
      return;
    }

    await game.settings.set(MODULE_ID, "ranks", ranks);
    await game.settings.set(MODULE_ID, "deductionTemplate",
      d.deductions.map((x) => ({ label: (x.label ?? "").trim(), amount: round2(x.amount) })));
    await game.settings.set(MODULE_ID, "officerTitles", d.officerTitles);
    await game.settings.set(MODULE_ID, "includeOfficers", d.includeOfficers);
    await game.settings.set(MODULE_ID, "autoPopulate", d.autoPopulate);
    await game.settings.set(MODULE_ID, "requisitionApproval", d.requisitionApproval);
    for (const [key, value] of Object.entries(d.counts)) {
      await game.settings.set(MODULE_ID, key, value);
    }
    await game.settings.set(MODULE_ID, "seeded", true);
    ui.notifications.info(game.i18n.localize("ARMY.Config.saved"));
  }
}

/** How many roster members currently hold a given rank. */
function getArmyRosterRankCount(rankId) {
  const data = game.settings.get(MODULE_ID, "armyData") ?? {};
  return (data.roster ?? []).filter((m) => m.rank === rankId).length;
}
