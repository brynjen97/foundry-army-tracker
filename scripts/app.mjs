import { MODULE_ID, LEVELS } from "./constants.mjs";
import {
  advanceDay,
  applyOps,
  buildStructure,
  computePay,
  fmt,
  getArmyData,
  getConfig,
  getRankWage,
  officerCount,
  requestTransfer,
  round2,
  unitStrength
} from "./data.mjs";
import { getCounts, getDeductionTemplate, getOfficerTitles, getRanks, includeOfficers } from "./settings.mjs";
import { ArmyConfigApp } from "./config-app.mjs";
import { carriedGold, coinLabel } from "./currency.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class ArmyTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {ArmyTrackerApp|null} */
  static instance = null;

  static open() {
    this.instance ??= new this();
    this.instance.render({ force: true });
    return this.instance;
  }

  activeTab = "roster";
  #expandedRows = new Set();
  #collapsedUnits = new Set();

  static DEFAULT_OPTIONS = {
    id: "army-tracker",
    classes: ["army-tracker"],
    window: {
      title: "ARMY.Title",
      icon: "fa-solid fa-flag",
      resizable: true
    },
    position: { width: 920, height: 640 },
    actions: {
      switchTab: ArmyTrackerApp._onSwitchTab,
      advanceDay: ArmyTrackerApp._onAdvanceDay,
      advanceDays: ArmyTrackerApp._onAdvanceDays,
      addMember: ArmyTrackerApp._onAddMember,
      removeMember: ArmyTrackerApp._onRemoveMember,
      toggleRow: ArmyTrackerApp._onToggleRow,
      addDeduction: ArmyTrackerApp._onAddDeduction,
      removeDeduction: ArmyTrackerApp._onRemoveDeduction,
      grantLoan: ArmyTrackerApp._onGrantLoan,
      repayDebt: ArmyTrackerApp._onRepayDebt,
      depositVault: ArmyTrackerApp._onDepositVault,
      withdrawVault: ArmyTrackerApp._onWithdrawVault,
      addUnit: ArmyTrackerApp._onAddUnit,
      removeUnit: ArmyTrackerApp._onRemoveUnit,
      toggleUnit: ArmyTrackerApp._onToggleUnit,
      addOfficer: ArmyTrackerApp._onAddOfficer,
      removeOfficer: ArmyTrackerApp._onRemoveOfficer,
      generateArmy: ArmyTrackerApp._onGenerateArmy,
      openConfig: ArmyTrackerApp._onOpenConfig
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/army-tracker.hbs`,
      scrollable: [".at-body"]
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const data = getArmyData();
    const cfg = getConfig();
    const isGM = game.user.isGM;

    const ranks = getRanks();
    const rankOptions = Object.fromEntries(ranks.map((r) => [r.id, r.label]));
    // Keep a member on a rank that was deleted from the config visible as such,
    // rather than silently re-banding them under whichever rank sorts first.
    for (const member of data.roster) {
      if (member.rank && !rankOptions[member.rank]) {
        rankOptions[member.rank] = game.i18n.format("ARMY.UnknownRank", { id: member.rank });
      }
    }

    const roster = data.roster.map((member, index) => {
      const actor = member.actorId ? game.actors.get(member.actorId) : null;
      const pay = computePay(member);
      const path = `roster.${index}`;
      const carried = carriedGold(actor);
      return {
        id: member.id,
        index,
        path,
        canTransact: isGM || !!actor?.isOwner,
        carriedF: carried === null ? null : fmt(carried),
        carriedCoins: carried === null ? null : coinLabel(carried),
        name: actor?.name ?? member.name ?? game.i18n.localize("ARMY.UnnamedMember"),
        img: actor?.img ?? null,
        rank: member.rank,
        wageOverride: member.wageOverride ?? null,
        defaultWage: fmt(getRankWage(member.rank)),
        debt: round2(member.debt ?? 0),
        vault: round2(member.vault ?? 0),
        debtF: fmt(member.debt ?? 0),
        vaultF: fmt(member.vault ?? 0),
        netClass: pay.net > 0 ? "at-pos" : (pay.net < 0 ? "at-neg" : ""),
        pay: {
          baseF: fmt(pay.base),
          dedF: fmt(pay.deductions),
          netF: fmt(pay.net),
          weeklyF: fmt(pay.weekly),
          monthlyF: fmt(pay.monthly),
          yearlyF: fmt(pay.yearly),
          maxLoanF: fmt(pay.maxLoan)
        },
        deductions: (member.deductions ?? []).map((d, j) => ({
          ...d,
          path: `${path}.deductions.${j}`,
          arrayPath: `${path}.deductions`,
          index: j
        })),
        expanded: this.#expandedRows.has(member.id)
      };
    });

    const totals = data.roster.reduce((acc, member) => {
      acc.net += computePay(member).net;
      acc.debt += Number(member.debt) || 0;
      acc.vault += Number(member.vault) || 0;
      return acc;
    }, { net: 0, debt: 0, vault: 0 });

    const army = this.#buildNode(data.structure.army, null, null, 0);

    return {
      isGM,
      day: data.day ?? 0,
      currency: cfg.currency,
      daysPerWeek: cfg.daysPerWeek,
      daysPerMonth: cfg.daysPerMonth,
      daysPerYear: cfg.daysPerYear,
      loanMonths: cfg.loanMonths,
      tabs: {
        roster: this.activeTab === "roster",
        structure: this.activeTab === "structure"
      },
      rankOptions,
      roster,
      colspan: isGM ? 8 : 7,
      totals: {
        netF: fmt(totals.net),
        debtF: fmt(totals.debt),
        vaultF: fmt(totals.vault)
      },
      army,
      officersEnabled: includeOfficers()
    };
  }

  /**
   * Build a display node for one unit of the army structure (recursive).
   * The army sits at the root of the tree, so it has no parent array and
   * passes null for arrayPath/index — that is what marks it unremovable.
   */
  #buildNode(unit, arrayPath, index, depth) {
    const level = LEVELS[depth];
    const isRoot = arrayPath === null;
    const path = isRoot ? "structure.army" : `${arrayPath}.${index}`;
    const officersOn = includeOfficers();
    const strength = unitStrength(unit, depth);

    const node = {
      id: unit.id,
      path,
      arrayPath,
      index,
      depth,
      isRoot,
      name: unit.name ?? "",
      notes: unit.notes ?? "",
      typeLabel: game.i18n.localize(`ARMY.Unit.${level.type}`),
      namePlaceholder: game.i18n.format("ARMY.Unit.namePh", {
        type: game.i18n.localize(`ARMY.Unit.${level.type}`)
      }),
      collapsed: this.#collapsedUnits.has(unit.id),
      isSquad: !level.childKey,
      strength,
      strengthLabel: game.i18n.format("ARMY.Unit.strength", { count: strength })
    };

    if (officersOn) {
      const officers = unit.officers ?? [];
      node.officersPath = `${path}.officers`;
      node.defaultOfficerTitle = getOfficerTitles()[level.type];
      node.officers = officers.map((o, i) => ({
        ...o,
        path: `${node.officersPath}.${i}`,
        arrayPath: node.officersPath,
        index: i
      }));
      node.officerTotal = officerCount(unit, depth);
    }

    if (level.childKey) {
      const children = unit[level.childKey] ?? [];
      node.childrenPath = `${path}.${level.childKey}`;
      node.childType = level.childType;
      node.addChildLabel = game.i18n.localize(`ARMY.Unit.add.${level.childType}`);
      node.children = children.map((child, i) => this.#buildNode(child, node.childrenPath, i, depth + 1));
      node.summary = `${children.length} ${game.i18n.localize(`ARMY.Unit.count.${level.childKey}`)}`;
    } else {
      const members = unit.members ?? [];
      node.membersPath = `${path}.members`;
      node.addChildLabel = game.i18n.localize("ARMY.Unit.add.member");
      node.members = members.map((m, i) => ({
        ...m,
        path: `${node.membersPath}.${i}`,
        arrayPath: node.membersPath,
        index: i
      }));
      // With no soldiers named, the squad still musters at its configured size.
      node.impliedStrength = !members.length;
      node.summary = members.length
        ? `${members.length} ${game.i18n.localize("ARMY.Unit.count.members")}`
        : game.i18n.format("ARMY.Unit.impliedStrength", { count: strength });
    }
    return node;
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", this.#onChangeInput.bind(this));
  }

  _onClose(options) {
    super._onClose(options);
    ArmyTrackerApp.instance = null;
  }

  /* -------------------------------------------- */
  /*  Input handling                              */
  /* -------------------------------------------- */

  async #onChangeInput(event) {
    const el = event.target;
    const path = el.dataset?.path;
    if (!path) return;

    let value = el.value;
    if (el.dataset.dtype === "Number") {
      value = value === "" ? null : Number(value);
      if (value !== null && Number.isNaN(value)) value = null;
      if (value === null && !("nullable" in el.dataset)) value = 0;
      if (value !== null) value = round2(value);
    }

    const ok = await applyOps([{ action: "set", path, value }]);
    if (!ok) this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: general                            */
  /* -------------------------------------------- */

  static _onSwitchTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static _onToggleRow(event, target) {
    const id = target.dataset.id;
    if (this.#expandedRows.has(id)) this.#expandedRows.delete(id);
    else this.#expandedRows.add(id);
    this.render();
  }

  static _onToggleUnit(event, target) {
    const id = target.dataset.id;
    if (this.#collapsedUnits.has(id)) this.#collapsedUnits.delete(id);
    else this.#collapsedUnits.add(id);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: roster                             */
  /* -------------------------------------------- */

  static async _onAdvanceDay() {
    if (!game.user.isGM) return;
    const data = getArmyData();
    if (!data.roster.length) {
      ui.notifications.warn(game.i18n.localize("ARMY.RosterEmptyWarn"));
      return;
    }
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("ARMY.AdvanceDay") },
      content: `<p>${game.i18n.format("ARMY.AdvanceDayConfirm", { day: (data.day ?? 0) + 1 })}</p>`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
    await advanceDay();
    ui.notifications.info(game.i18n.format("ARMY.AdvancedNotice", { day: (data.day ?? 0) + 1 }));
  }

  static async _onAdvanceDays() {
    if (!game.user.isGM) return;
    const data = getArmyData();
    if (!data.roster.length) {
      ui.notifications.warn(game.i18n.localize("ARMY.RosterEmptyWarn"));
      return;
    }
    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.AdvanceDays") },
      content: `
        <p>${game.i18n.localize("ARMY.AdvanceDaysPrompt")}</p>
        <div class="form-group">
          <label>${game.i18n.localize("ARMY.AdvanceDaysLabel")}</label>
          <input type="number" name="days" min="1" max="3650" step="1" value="7" autofocus>
        </div>`,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("ARMY.AdvanceDays"),
        icon: "fa-solid fa-forward-fast",
        callback: (event, button) => Number(button.form.elements.days.value)
      }
    });
    if (!result || Number.isNaN(result) || result < 1) return;
    const days = Math.max(1, Math.min(3650, Math.floor(result)));
    await advanceDay(days);
    ui.notifications.info(game.i18n.format("ARMY.AdvancedNoticeMulti", {
      days,
      day: (data.day ?? 0) + days
    }));
  }

  static async _onAddMember() {
    if (!game.user.isGM) return;
    const data = getArmyData();
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));
    const taken = new Set(data.roster.map((m) => m.actorId).filter(Boolean));
    const actors = game.actors.contents
      .filter((a) => !taken.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const options = actors.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");

    const content = `
      <div class="form-group">
        <label>${game.i18n.localize("ARMY.AddDialog.actor")}</label>
        <select name="actorId">
          <option value="">${game.i18n.localize("ARMY.AddDialog.none")}</option>
          ${options}
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("ARMY.AddDialog.name")}</label>
        <input type="text" name="customName" placeholder="${game.i18n.localize("ARMY.AddDialog.namePh")}">
      </div>`;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.AddMember") },
      content,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("ARMY.Add"),
        icon: "fa-solid fa-user-plus",
        callback: (event, button) => ({
          actorId: button.form.elements.actorId.value,
          customName: button.form.elements.customName.value.trim()
        })
      }
    });
    if (!result) return;

    const actor = result.actorId ? game.actors.get(result.actorId) : null;
    const member = {
      id: foundry.utils.randomID(),
      actorId: actor?.id ?? null,
      name: result.customName || actor?.name || game.i18n.localize("ARMY.UnnamedMember"),
      rank: getRanks()[0]?.id ?? "soldier",
      wageOverride: null,
      deductions: getDeductionTemplate().map((d) => ({
        id: foundry.utils.randomID(),
        label: d.label,
        amount: d.amount
      })),
      debt: 0,
      vault: 0
    };
    this.#expandedRows.add(member.id);
    await applyOps([{ action: "push", path: "roster", value: member }]);
  }

  static async _onRemoveMember(event, target) {
    if (!game.user.isGM) return;
    const index = Number(target.dataset.index);
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("ARMY.RemoveMember") },
      content: `<p>${game.i18n.format("ARMY.RemoveConfirm", { name: target.dataset.name ?? "" })}</p>`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
    await applyOps([{ action: "remove", path: "roster", index }]);
  }

  static async _onAddDeduction(event, target) {
    if (!game.user.isGM) return;
    await applyOps([{
      action: "push",
      path: target.dataset.arrayPath,
      value: { id: foundry.utils.randomID(), label: "", amount: 0 }
    }]);
  }

  static async _onRemoveDeduction(event, target) {
    if (!game.user.isGM) return;
    await applyOps([{
      action: "remove",
      path: target.dataset.arrayPath,
      index: Number(target.dataset.index)
    }]);
  }

  static async _onGrantLoan(event, target) {
    if (!game.user.isGM) return;
    const index = Number(target.dataset.index);
    const data = getArmyData();
    const member = data.roster[index];
    if (!member) return;

    const cfg = getConfig();
    const pay = computePay(member);
    const debt = round2(member.debt ?? 0);
    const available = round2(pay.maxLoan - debt);
    if (available <= 0) {
      ui.notifications.warn(game.i18n.localize("ARMY.LoanMaxed"));
      return;
    }

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.GrantLoan") },
      content: `
        <p>${game.i18n.format("ARMY.LoanPrompt", { available: fmt(available), currency: cfg.currency })}</p>
        <div class="form-group">
          <input type="number" name="amount" step="any" min="0" max="${available}" value="${available}" autofocus>
        </div>`,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("ARMY.GrantLoan"),
        icon: "fa-solid fa-hand-holding-dollar",
        callback: (event, button) => Number(button.form.elements.amount.value)
      }
    });
    if (!result || Number.isNaN(result) || result <= 0) return;

    const amount = Math.min(round2(result), available);
    await applyOps([{ action: "set", path: `roster.${index}.debt`, value: round2(debt + amount) }]);
    ui.notifications.info(game.i18n.format("ARMY.LoanGranted", {
      amount: fmt(amount),
      currency: cfg.currency,
      name: target.dataset.name ?? ""
    }));
  }

  static async _onRepayDebt(event, target) {
    if (!game.user.isGM) return;
    const index = Number(target.dataset.index);
    const data = getArmyData();
    const member = data.roster[index];
    if (!member) return;

    const debt = round2(member.debt ?? 0);
    const vault = round2(member.vault ?? 0);
    const payment = Math.min(debt, vault);
    if (payment <= 0) {
      ui.notifications.warn(game.i18n.localize("ARMY.NothingToRepay"));
      return;
    }
    await applyOps([
      { action: "set", path: `roster.${index}.debt`, value: round2(debt - payment) },
      { action: "set", path: `roster.${index}.vault`, value: round2(vault - payment) }
    ]);
  }

  /* -------------------------------------------- */
  /*  Actions: vault deposits & withdrawals       */
  /* -------------------------------------------- */

  static async _onDepositVault(event, target) {
    await ArmyTrackerApp.#promptTransfer(target.dataset.id, "deposit");
  }

  static async _onWithdrawVault(event, target) {
    await ArmyTrackerApp.#promptTransfer(target.dataset.id, "withdraw");
  }

  /**
   * Ask how much to move between a character's purse and the camp vault.
   * The available figure is a convenience only — the GM re-validates the
   * request before any coin or vault balance actually changes.
   */
  static async #promptTransfer(memberId, direction) {
    const data = getArmyData();
    const member = data.roster.find((m) => m.id === memberId);
    if (!member) return;

    const cfg = getConfig();
    const actor = member.actorId ? game.actors.get(member.actorId) : null;
    const vault = round2(member.vault ?? 0);
    const carried = carriedGold(actor);
    const deposit = direction === "deposit";

    // Only cap the field when we know the real figure on this side of the move.
    const max = deposit ? carried : vault;

    if (!deposit && vault <= 0) {
      ui.notifications.warn(game.i18n.localize("ARMY.Transfer.EmptyVault"));
      return;
    }
    if (deposit && carried !== null && carried <= 0) {
      ui.notifications.warn(game.i18n.localize("ARMY.Transfer.NoCoin"));
      return;
    }

    const available = deposit
      ? game.i18n.format("ARMY.Transfer.carried", { amount: fmt(carried ?? 0), coins: coinLabel(carried ?? 0) })
      : game.i18n.format("ARMY.Transfer.inVault", { amount: fmt(vault), currency: cfg.currency });

    const note = max === null
      ? `<p class="notification warning">${game.i18n.localize("ARMY.Transfer.ledgerOnly")}</p>`
      : "";

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize(deposit ? "ARMY.Transfer.deposit" : "ARMY.Transfer.withdraw") },
      content: `
        <p>${game.i18n.localize(deposit ? "ARMY.Transfer.depositPrompt" : "ARMY.Transfer.withdrawPrompt")}</p>
        ${max === null ? "" : `<p><strong>${available}</strong></p>`}
        ${note}
        <div class="form-group">
          <label>${game.i18n.format("ARMY.Transfer.amountLabel", { currency: cfg.currency })}</label>
          <input type="number" name="amount" step="0.01" min="0"
                 ${max === null ? "" : `max="${max}" value="${max}"`} autofocus>
        </div>`,
      rejectClose: false,
      ok: {
        label: game.i18n.localize(deposit ? "ARMY.Transfer.deposit" : "ARMY.Transfer.withdraw"),
        icon: deposit ? "fa-solid fa-arrow-down-to-bracket" : "fa-solid fa-arrow-up-from-bracket",
        callback: (event, button) => Number(button.form.elements.amount.value)
      }
    });
    if (result === null || result === undefined || Number.isNaN(result) || result <= 0) return;

    const amount = round2(max === null ? result : Math.min(result, max));
    if (amount <= 0) return;
    await requestTransfer({ memberId, direction, amount });
  }

  /* -------------------------------------------- */
  /*  Actions: army structure                     */
  /* -------------------------------------------- */

  static async _onAddUnit(event, target) {
    const { arrayPath, unitType, parentId } = target.dataset;
    const makers = {
      host: () => ({ id: foundry.utils.randomID(), name: "", officers: [], companies: [] }),
      company: () => ({ id: foundry.utils.randomID(), name: "", officers: [], cohorts: [] }),
      cohort: () => ({ id: foundry.utils.randomID(), name: "", officers: [], squads: [] }),
      squad: () => ({ id: foundry.utils.randomID(), name: "", officers: [], members: [] }),
      member: () => ({ id: foundry.utils.randomID(), name: "", title: "", notes: "" })
    };
    const make = makers[unitType];
    if (!make || !arrayPath) return;
    if (parentId) this.#collapsedUnits.delete(parentId);
    await applyOps([{ action: "push", path: arrayPath, value: make() }]);
  }

  static async _onRemoveUnit(event, target) {
    const { arrayPath, kind } = target.dataset;
    const index = Number(target.dataset.index);
    if (kind !== "member") {
      const name = target.dataset.name || target.dataset.typeLabel || "";
      const confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize("ARMY.RemoveUnit") },
        content: `<p>${game.i18n.format("ARMY.RemoveUnitConfirm", { name })}</p>`,
        rejectClose: false,
        modal: true
      });
      if (!confirmed) return;
    }
    await applyOps([{ action: "remove", path: arrayPath, index }]);
  }

  /* -------------------------------------------- */
  /*  Actions: officers                           */
  /* -------------------------------------------- */

  static async _onAddOfficer(event, target) {
    const { arrayPath, title, parentId } = target.dataset;
    if (!arrayPath) return;
    if (parentId) this.#collapsedUnits.delete(parentId);
    await applyOps([{
      action: "push",
      path: arrayPath,
      value: { id: foundry.utils.randomID(), title: title ?? "", name: "", notes: "" }
    }]);
  }

  static async _onRemoveOfficer(event, target) {
    await applyOps([{
      action: "remove",
      path: target.dataset.arrayPath,
      index: Number(target.dataset.index)
    }]);
  }

  /* -------------------------------------------- */
  /*  Actions: army generation                    */
  /* -------------------------------------------- */

  static async _onGenerateArmy() {
    if (!game.user.isGM) return;
    const counts = getCounts();
    const data = getArmyData();
    const existing = data.structure.army;
    const hasContent = (existing.hosts ?? []).length
      || (existing.officers ?? []).length
      || existing.name
      || existing.notes;

    const preview = buildStructure();
    const total = unitStrength(preview.army, 0);

    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("ARMY.Generate.title") },
      content: `
        <p>${game.i18n.format("ARMY.Generate.summary", {
          hosts: counts.hostsPerArmy,
          companies: counts.companiesPerHost,
          cohorts: counts.cohortsPerCompany,
          squads: counts.squadsPerCohort,
          soldiers: counts.soldiersPerSquad
        })}</p>
        <p><strong>${game.i18n.format("ARMY.Generate.total", { count: total })}</strong></p>
        ${hasContent ? `<p class="notification warning">${game.i18n.localize("ARMY.Generate.overwrite")}</p>` : ""}`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;

    // Keep the army's own name and notes; only the hierarchy is rebuilt.
    const built = buildStructure();
    built.army.name = existing.name || built.army.name;
    built.army.notes = existing.notes ?? "";
    await applyOps([{ action: "set", path: "structure.army", value: built.army }]);
    ui.notifications.info(game.i18n.format("ARMY.Generate.done", { count: total }));
  }

  static _onOpenConfig() {
    new ArmyConfigApp().render({ force: true });
  }
}
