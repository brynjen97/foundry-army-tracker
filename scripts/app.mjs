import { MODULE_ID, LEVELS } from "./constants.mjs";
import {
  advanceDay,
  applyOps,
  bonusFor,
  buildStructure,
  distributeShares,
  collectUnitIds,
  computePay,
  grantBonus,
  memberName,
  escapeHTML,
  fmt,
  getArmyData,
  getConfig,
  getRankWage,
  officerCount,
  requestRequisition,
  requestTransfer,
  round2,
  unitMatches,
  unitStrength
} from "./data.mjs";
import { getCounts, getDeductionTemplate, getOfficerTitles, getRanks, includeOfficers } from "./settings.mjs";
import { listUnits } from "./structure.mjs";
import { ENTRY_TYPES, undoLabel, undoLast } from "./ledger.mjs";
import {
  armyUpkeep,
  canSeeFinances,
  creditTreasury,
  financeVisibilitySummary,
  getTreasury,
  setTreasuryBalance,
  treasuryEnabled
} from "./treasury.mjs";
import { generateHaul, HAUL_KINDS, MAX_LEVEL, SETTLEMENTS } from "./treasure.mjs";
import { ArmyConfigApp } from "./config-app.mjs";
import { carriedGold, coinLabel, giveToActor, itemPriceGold, supportsInventoryTransfer } from "./currency.mjs";
import { MAX_ITEM_LEVEL, openArmyShop, shopAvailable } from "./shop.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** How a member's finance-access override shows on their row. */
const FINANCE_ICONS = {
  inherit: "fa-regular fa-circle",
  grant: "fa-solid fa-eye",
  deny: "fa-solid fa-eye-slash"
};

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

  /** Roster members posted to each unit, rebuilt on every render. */
  #postings = new Map();

  /** Ledger view filters: entry type and roster member, "all" for either. */
  #ledgerType = "all";
  #ledgerMember = "all";

  // Collapse state is tracked as explicit overrides in either direction, so
  // that anything the user has not touched follows the default below: only the
  // army itself opens, which keeps a freshly generated 700-strong army to one
  // readable screen instead of a wall of units.
  #expandedUnits = new Set();
  #collapsedUnits = new Set();

  #isCollapsed(id, depth) {
    if (this.#expandedUnits.has(id)) return false;
    if (this.#collapsedUnits.has(id)) return true;
    return depth > 0;
  }

  #setCollapsed(id, collapsed) {
    if (!id) return;
    if (collapsed) {
      this.#collapsedUnits.add(id);
      this.#expandedUnits.delete(id);
    } else {
      this.#expandedUnits.add(id);
      this.#collapsedUnits.delete(id);
    }
  }

  /** Forget every override so the default (army open, rest closed) applies again. */
  #resetCollapse() {
    this.#expandedUnits.clear();
    this.#collapsedUnits.clear();
  }

  /** Army structure search term, and whether to put the caret back after render. */
  #structureQuery = "";
  #restoreSearchFocus = false;

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
      grantBonus: ArmyTrackerApp._onGrantBonus,
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
      clearSearch: ArmyTrackerApp._onClearSearch,
      expandAll: ArmyTrackerApp._onExpandAll,
      collapseAll: ArmyTrackerApp._onCollapseAll,
      openShop: ArmyTrackerApp._onOpenShop,
      addOfficer: ArmyTrackerApp._onAddOfficer,
      removeOfficer: ArmyTrackerApp._onRemoveOfficer,
      generateArmy: ArmyTrackerApp._onGenerateArmy,
      openConfig: ArmyTrackerApp._onOpenConfig,
      setTreasury: ArmyTrackerApp._onSetTreasury,
      recordLoot: ArmyTrackerApp._onRecordLoot,
      shareOut: ArmyTrackerApp._onShareOut,
      undoLast: ArmyTrackerApp._onUndoLast,
      cycleFinanceAccess: ArmyTrackerApp._onCycleFinanceAccess,
      clearLedgerFilter: ArmyTrackerApp._onClearLedgerFilter
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
        // Requisition needs a real inventory to put the goods into, so it is
        // offered only where an actor is linked on a system we can stock.
        canRequisition: (isGM || !!actor?.isOwner) && !!actor && shopAvailable(),
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
        // A member posted to a unit that has since been deleted or regenerated
        // matches no option and so shows as unassigned, rather than pointing
        // at something that is no longer there.
        unitId: member.unitId ?? "",
        financeAccess: member.financeAccess ?? "inherit",
        financeIcon: FINANCE_ICONS[member.financeAccess ?? "inherit"],
        financeTip: game.i18n.localize(`ARMY.Treasury.access.${member.financeAccess ?? "inherit"}`),
        expanded: this.#expandedRows.has(member.id)
      };
    });

    const totals = data.roster.reduce((acc, member) => {
      acc.net += computePay(member).net;
      acc.debt += Number(member.debt) || 0;
      acc.vault += Number(member.vault) || 0;
      return acc;
    }, { net: 0, debt: 0, vault: 0 });

    // Who is posted where, so a unit header can name the party members serving
    // in it without every node re-scanning the roster.
    this.#postings = new Map();
    for (const member of data.roster) {
      if (!member.unitId) continue;
      const list = this.#postings.get(member.unitId) ?? [];
      list.push(memberName(member));
      this.#postings.set(member.unitId, list);
    }

    const query = this.#structureQuery.trim();
    const stats = { matches: 0 };
    const army = this.#buildNode(data.structure.army, null, null, 0, query, stats);

    const showFinances = canSeeFinances(game.user, data);
    const treasuryOn = treasuryEnabled();
    // A tab that has been hidden out from under the viewer falls back to the
    // roster rather than rendering an empty body.
    if (!treasuryOn || !showFinances) {
      if (this.activeTab === "treasury") this.activeTab = "roster";
    }

    const upkeep = armyUpkeep(data);
    const balance = getTreasury(data).balance;

    return {
      isGM,
      day: data.day ?? 0,
      currency: cfg.currency,
      daysPerWeek: cfg.daysPerWeek,
      daysPerMonth: cfg.daysPerMonth,
      daysPerYear: cfg.daysPerYear,
      loanMonths: cfg.loanMonths,
      treasuryOn,
      showFinances,
      treasury: {
        balance,
        balanceF: fmt(balance),
        inArrears: balance < 0,
        soldiers: upkeep.soldiers,
        officers: upkeep.officers,
        perSoldierF: fmt(upkeep.perSoldier ?? 0),
        perOfficerF: fmt(upkeep.perOfficer ?? 0),
        soldierCostF: fmt(upkeep.soldierCost),
        officerCostF: fmt(upkeep.officerCost),
        dailyF: fmt(upkeep.total),
        monthlyF: fmt(round2(upkeep.total * cfg.daysPerMonth)),
        payrollF: fmt(round2(totals.net)),
        // What the chest can stand at the current burn rate, which is the one
        // number a commander actually wants: how long until we cannot pay.
        daysLeft: this.#solvency(balance, upkeep.total, totals.net),
        visibility: financeVisibilitySummary()
      },
      undoLabel: isGM ? undoLabel(data) : null,
      ledger: this.#ledgerRows(data, showFinances),
      ledgerType: this.#ledgerType,
      ledgerMember: this.#ledgerMember,
      ledgerTypeOptions: this.#ledgerTypeOptions(),
      ledgerMemberOptions: Object.fromEntries([
        ["all", game.i18n.localize("ARMY.Ledger.allMembers")],
        ...data.roster.map((m) => [m.id, memberName(m)])
      ]),
      ledgerFiltered: this.#ledgerType !== "all" || this.#ledgerMember !== "all",
      unitOptions: Object.fromEntries([
        ["", game.i18n.localize("ARMY.Unit.unassigned")],
        ...listUnits(data.structure.army).map((u) => [u.id, u.label])
      ]),
      tabs: {
        roster: this.activeTab === "roster",
        structure: this.activeTab === "structure",
        treasury: this.activeTab === "treasury",
        ledger: this.activeTab === "ledger"
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
      searchQuery: this.#structureQuery,
      searching: !!query,
      noMatches: !!query && !army,
      matchSummary: query
        ? game.i18n.format("ARMY.Search.results", { count: stats.matches })
        : null,
      officersEnabled: includeOfficers(),
      shopAvailable: shopAvailable(),
      maxItemLevel: MAX_ITEM_LEVEL
    };
  }

  /**
   * Build a display node for one unit of the army structure (recursive).
   * The army sits at the root of the tree, so it has no parent array and
   * passes null for arrayPath/index — that is what marks it unremovable.
   *
   * With a search active this doubles as the filter. A unit survives if it
   * matches or if anything beneath it does, so the path down to a hit stays
   * visible; everything else returns null and is pruned. A unit that matched
   * in its own right keeps its whole subtree, since having searched for it you
   * presumably want to see what is in it.
   *
   * @returns {object|null} null when filtered out.
   */
  #buildNode(unit, arrayPath, index, depth, query = "", stats = null) {
    const level = LEVELS[depth];
    const isRoot = arrayPath === null;
    const path = isRoot ? "structure.army" : `${arrayPath}.${index}`;
    const officersOn = includeOfficers();
    const strength = unitStrength(unit, depth);
    const selfMatch = !!query && unitMatches(unit, query);
    if (selfMatch && stats) stats.matches++;

    const node = {
      id: unit.id,
      path,
      arrayPath,
      index,
      depth,
      isRoot,
      name: unit.name ?? "",
      notes: unit.notes ?? "",
      level: isRoot ? (unit.level ?? 1) : null,
      typeLabel: game.i18n.localize(`ARMY.Unit.${level.type}`),
      namePlaceholder: game.i18n.format("ARMY.Unit.namePh", {
        type: game.i18n.localize(`ARMY.Unit.${level.type}`)
      }),
      collapsed: this.#isCollapsed(unit.id, depth),
      posted: this.#postings.get(unit.id)?.join(", ") ?? null,
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

      // The first officer commands the unit, and is shown on its header so a
      // collapsed army still reads as "1st Host — Helm Aldric". A generated
      // army titles every officer but leaves them unnamed, so that case is
      // called out rather than rendered as a title trailing into nothing.
      const primary = officers[0];
      if (primary) {
        const title = (primary.title ?? "").trim();
        const name = (primary.name ?? "").trim();
        node.primaryOfficerVacant = !name;
        if (title && name) node.primaryOfficer = `${title} ${name}`;
        else if (name) node.primaryOfficer = name;
        else if (title) node.primaryOfficer = game.i18n.format("ARMY.OfficerVacant", { title });
        else node.primaryOfficer = null;
      }
    }

    if (level.childKey) {
      const children = unit[level.childKey] ?? [];
      node.childrenPath = `${path}.${level.childKey}`;
      node.childType = level.childType;
      node.addChildLabel = game.i18n.localize(`ARMY.Unit.add.${level.childType}`);
      // A unit that matched shows everything under it; otherwise the search
      // keeps propagating down and only surviving branches come back.
      const childQuery = selfMatch ? "" : query;
      node.children = children
        .map((child, i) => this.#buildNode(child, node.childrenPath, i, depth + 1, childQuery, stats))
        .filter((child) => child !== null);
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

    if (query) {
      const keptChildren = node.children?.length ?? 0;
      if (!selfMatch && !keptChildren) return null;
      node.isMatch = selfMatch;
      // Open the trail down to a hit, or the search would hide its own
      // results. A unit that matched keeps its usual state, so it appears as
      // a closed banner to click into rather than dumping its whole subtree.
      if (!selfMatch) node.collapsed = false;
    }
    return node;
  }

  /**
   * How many days the war chest covers at the current burn rate.
   * Returns null when the army is running a surplus — there is no runway to
   * report when the balance is going up.
   */
  #solvency(balance, upkeep, netPayroll) {
    const burn = round2(upkeep + Math.max(0, netPayroll));
    if (burn <= 0 || balance <= 0) return null;
    return Math.floor(balance / burn);
  }

  /** The type filter's options, only offering types actually present. */
  #ledgerTypeOptions() {
    const options = { all: game.i18n.localize("ARMY.Ledger.allTypes") };
    for (const type of Object.keys(ENTRY_TYPES)) {
      options[type] = game.i18n.localize(`ARMY.Ledger.type.${type}`);
    }
    return options;
  }

  /**
   * The ledger as display rows, newest first.
   *
   * Army-scope entries — the war chest, upkeep, plunder — are held back from
   * anyone the GM has not let into the books. A member's own entries are
   * always their business, so those stay visible either way.
   */
  #ledgerRows(data, showFinances) {
    const cfg = getConfig();
    const owned = new Set(
      data.roster
        .filter((m) => m.actorId && game.actors.get(m.actorId)?.isOwner)
        .map((m) => m.id)
    );

    return (data.ledger ?? [])
      .filter((e) => {
        if (e.scope === "army" && !showFinances) return false;
        if (e.scope === "member" && !game.user.isGM && !showFinances && !owned.has(e.memberId)) return false;
        if (this.#ledgerType !== "all" && e.type !== this.#ledgerType) return false;
        if (this.#ledgerMember !== "all" && e.memberId !== this.#ledgerMember) return false;
        return true;
      })
      .map((e) => ({
        ...e,
        icon: ENTRY_TYPES[e.type]?.icon ?? "fa-circle",
        typeLabel: game.i18n.localize(`ARMY.Ledger.type.${e.type}`),
        amountF: `${e.amount > 0 ? "+" : ""}${fmt(e.amount)}`,
        amountClass: e.amount > 0 ? "at-pos" : (e.amount < 0 ? "at-neg" : ""),
        balanceF: e.balance === null ? null : fmt(e.balance),
        targetLabel: e.target ? game.i18n.localize(`ARMY.Ledger.target.${e.target}`) : "",
        currency: cfg.currency,
        subject: e.memberName ?? game.i18n.localize("ARMY.Ledger.army")
      }))
      .reverse();
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    // Re-rendering on each keystroke replaces the input, so put the caret back.
    if (!this.#restoreSearchFocus) return;
    this.#restoreSearchFocus = false;
    const input = this.element.querySelector(".at-search-input");
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", this.#onChangeInput.bind(this));
    this.element.addEventListener("input", this.#onSearchInput.bind(this));
    // Dropping an item onto a roster row requisitions it against army credit.
    this.element.addEventListener("dragover", this.#onDragOver.bind(this));
    this.element.addEventListener("dragleave", this.#onDragLeave.bind(this));
    this.element.addEventListener("drop", this.#onDrop.bind(this));
  }

  #onSearchInput(event) {
    if (!event.target?.classList?.contains("at-search-input")) return;
    this.#structureQuery = event.target.value;
    this.#restoreSearchFocus = true;
    this.render();
  }

  #requisitionRow(event) {
    const row = event.target?.closest?.("[data-member-id]");
    return row?.dataset.canRequisition === "true" ? row : null;
  }

  #onDragOver(event) {
    const row = this.#requisitionRow(event);
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    row.classList.add("at-drop-target");
  }

  #onDragLeave(event) {
    this.#requisitionRow(event)?.classList.remove("at-drop-target");
  }

  async #onDrop(event) {
    const row = this.#requisitionRow(event);
    if (!row) return;
    row.classList.remove("at-drop-target");

    let payload;
    try {
      payload = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return; // not a Foundry drag payload
    }
    if (payload?.type !== "Item" || !payload.uuid) return;
    event.preventDefault();
    event.stopPropagation();
    await ArmyTrackerApp.#promptRequisition(row.dataset.memberId, payload.uuid);
  }

  /**
   * Confirm a requisition, showing the price against the member's remaining
   * credit. The GM re-validates everything before the item or debt moves.
   */
  static async #promptRequisition(memberId, uuid) {
    const data = getArmyData();
    const member = data.roster.find((m) => m.id === memberId);
    if (!member) return;

    const item = await globalThis.fromUuid?.(uuid);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("ARMY.Requisition.noItem"));
      return;
    }
    const unit = itemPriceGold(item);
    if (unit === null) {
      ui.notifications.warn(game.i18n.format("ARMY.Requisition.noPrice", { item: item.name }));
      return;
    }

    const cfg = getConfig();
    const pay = computePay(member);
    const debt = round2(member.debt ?? 0);
    const capacity = round2(pay.maxLoan - debt);
    if (capacity <= 0) {
      ui.notifications.warn(game.i18n.localize("ARMY.Requisition.noCredit"));
      return;
    }

    const maxQty = unit > 0 ? Math.max(1, Math.floor(capacity / unit)) : 99;
    const content = `
      <p>${game.i18n.format("ARMY.Requisition.prompt", {
        item: escapeHTML(item.name), name: escapeHTML(memberName(member))
      })}</p>
      <div class="at-line"><span>${game.i18n.localize("ARMY.Requisition.unitPrice")}</span><span>${fmt(unit)} ${escapeHTML(cfg.currency)}</span></div>
      <div class="at-line"><span>${game.i18n.localize("ARMY.Requisition.credit")}</span><span>${fmt(capacity)} ${escapeHTML(cfg.currency)}</span></div>
      <div class="form-group">
        <label>${game.i18n.localize("ARMY.Requisition.quantity")}</label>
        <input type="number" name="quantity" min="1" step="1" max="${maxQty}" value="1" autofocus>
      </div>
      <p class="at-hint">${game.i18n.localize("ARMY.Requisition.note")}</p>`;

    const quantity = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.Requisition.title") },
      content,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("ARMY.Requisition.confirm"),
        icon: "fa-solid fa-clipboard-check",
        callback: (event, button) => Number(button.form.elements.quantity.value)
      }
    });
    if (!quantity || Number.isNaN(quantity) || quantity < 1) return;
    await requestRequisition({ memberId, uuid, quantity: Math.floor(quantity) });
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

    // Ledger filters are view state, not stored data — they never leave this client.
    const filter = el.dataset?.ledgerFilter;
    if (filter === "type" || filter === "member") {
      if (filter === "type") this.#ledgerType = el.value;
      else this.#ledgerMember = el.value;
      this.render();
      return;
    }

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
    // The current state comes from the rendered node, since the default
    // depends on depth rather than on membership of either set.
    this.#setCollapsed(target.dataset.id, target.dataset.collapsed !== "true");
    this.render();
  }

  static _onClearSearch() {
    this.#structureQuery = "";
    this.#restoreSearchFocus = true;
    this.render();
  }

  static _onExpandAll() {
    const ids = collectUnitIds(getArmyData().structure.army, 0);
    this.#collapsedUnits.clear();
    for (const id of ids) this.#expandedUnits.add(id);
    this.render();
  }

  static _onCollapseAll() {
    const ids = collectUnitIds(getArmyData().structure.army, 0);
    this.#expandedUnits.clear();
    for (const id of ids) this.#collapsedUnits.add(id);
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

  /**
   * Pay a bonus to the whole roster. The dialog previews what each member
   * would receive under every option, because week and month bonuses vary
   * per character and the totals are otherwise invisible until it is done.
   */
  static async _onGrantBonus() {
    if (!game.user.isGM) return;
    const data = getArmyData();
    if (!data.roster.length) {
      ui.notifications.warn(game.i18n.localize("ARMY.RosterEmptyWarn"));
      return;
    }
    const cfg = getConfig();
    const esc = escapeHTML;
    const loc = (k) => game.i18n.localize(k);

    const preview = data.roster.map((m) => ({
      name: memberName(m),
      week: bonusFor(m, { mode: "week" }),
      month: bonusFor(m, { mode: "month" })
    }));
    const sum = (key) => preview.reduce((t, r) => t + r[key], 0);

    const rows = preview.map((r) => `
      <tr><td>${esc(r.name)}</td><td style="text-align:right">${fmt(r.week)}</td>
      <td style="text-align:right">${fmt(r.month)}</td></tr>`).join("");

    const content = `
      <p>${loc("ARMY.Bonus.prompt")}</p>
      <div class="form-group">
        <label>${loc("ARMY.Bonus.mode")}</label>
        <select name="mode">
          <option value="flat">${loc("ARMY.Bonus.modeFlat")}</option>
          <option value="week">${game.i18n.format("ARMY.Bonus.modeWeek", { days: cfg.daysPerWeek })}</option>
          <option value="month">${game.i18n.format("ARMY.Bonus.modeMonth", { days: cfg.daysPerMonth })}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.format("ARMY.Bonus.amount", { currency: cfg.currency })}</label>
        <input type="number" step="any" min="0" name="amount" value="0">
      </div>
      <label class="at-check" style="display:flex;gap:.4rem;align-items:center;margin:.25rem 0">
        <input type="checkbox" name="clearDebtFirst" style="width:auto">
        <span>${loc("ARMY.Bonus.debtFirst")}</span>
      </label>
      <p class="at-hint">${loc("ARMY.Bonus.basis")}</p>
      <table class="at-bonus-preview">
        <thead><tr>
          <th>${loc("ARMY.Payday.name")}</th>
          <th style="text-align:right">${loc("ARMY.Bonus.weekCol")}</th>
          <th style="text-align:right">${loc("ARMY.Bonus.monthCol")}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <th>${loc("ARMY.Totals")}</th>
          <th style="text-align:right">${fmt(sum("week"))}</th>
          <th style="text-align:right">${fmt(sum("month"))}</th>
        </tr></tfoot>
      </table>`;

    const result = await DialogV2.prompt({
      window: { title: loc("ARMY.Bonus.title") },
      content,
      rejectClose: false,
      ok: {
        label: loc("ARMY.Bonus.grant"),
        icon: "fa-solid fa-gift",
        callback: (event, button) => ({
          mode: button.form.elements.mode.value,
          amount: Number(button.form.elements.amount.value),
          clearDebtFirst: button.form.elements.clearDebtFirst.checked
        })
      }
    });
    if (!result) return;
    if (result.mode === "flat" && !(result.amount > 0)) {
      ui.notifications.warn(game.i18n.localize("ARMY.Bonus.needAmount"));
      return;
    }

    const outcome = await grantBonus(result);
    if (outcome) {
      ui.notifications.info(game.i18n.format("ARMY.Bonus.done", {
        total: fmt(outcome.total), currency: cfg.currency, count: outcome.count
      }));
    }
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
    const esc = escapeHTML;
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

    const actor = member.actorId ? game.actors.get(member.actorId) : null;
    const linked = supportsInventoryTransfer(actor);
    const note = linked ? "" : `<p class="notification warning">${game.i18n.localize("ARMY.LoanLedgerOnly")}</p>`;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.GrantLoan") },
      content: `
        <p>${game.i18n.format("ARMY.LoanPrompt", { available: fmt(available), currency: cfg.currency })}</p>
        ${note}
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

    // Hand over the coin before recording the debt, so a failed payout cannot
    // leave a character owing money they never received. Same order as a
    // requisition, which is a loan spent at the point of purchase.
    if (linked && !(await giveToActor(actor, amount))) {
      ui.notifications.error(game.i18n.localize("ARMY.LoanFailed"));
      return;
    }

    const newDebt = round2(debt + amount);
    const name = memberName(member);
    await applyOps([
      { action: "set", path: `roster.${index}.debt`, value: newDebt },
      {
        action: "ledger",
        entry: {
          type: "loan", memberId: member.id, memberName: name,
          amount, target: "debt", balance: newDebt
        }
      },
      // The coin the member walks away with came out of the war chest.
      { action: "treasury", type: "loan", amount: -amount, memberId: member.id, memberName: name, note: "" }
    ]);
    ui.notifications.info(game.i18n.format(linked ? "ARMY.LoanGranted" : "ARMY.LoanGrantedLedger", {
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
    const name = memberName(member);
    await applyOps([
      { action: "set", path: `roster.${index}.debt`, value: round2(debt - payment) },
      { action: "set", path: `roster.${index}.vault`, value: round2(vault - payment) },
      {
        action: "ledger",
        entry: {
          type: "repay", memberId: member.id, memberName: name,
          amount: -payment, target: "debt", balance: round2(debt - payment)
        }
      },
      // Money owed to the army, returned to the army.
      { action: "treasury", type: "repay", amount: payment, memberId: member.id, memberName: name, note: "" }
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
    const unit = make();
    // Open the parent and the new unit, so what you just added is visible
    // even though units are collapsed by default.
    this.#setCollapsed(parentId, false);
    this.#setCollapsed(unit.id, false);
    await applyOps([{ action: "push", path: arrayPath, value: unit }]);
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
    this.#setCollapsed(parentId, false);
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
    // Drop any stale overrides so the generated army arrives collapsed.
    this.#resetCollapse();
    await applyOps([{ action: "set", path: "structure.army", value: built.army }]);
    ui.notifications.info(game.i18n.format("ARMY.Generate.done", { count: total }));
  }


  /* -------------------------------------------- */
  /*  Actions: treasury & ledger                  */
  /* -------------------------------------------- */

  /** Set the war chest to an exact figure — seeding it, or correcting it. */
  static async _onSetTreasury() {
    if (!game.user.isGM) return;
    const cfg = getConfig();
    const current = getTreasury(getArmyData()).balance;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.Treasury.setTitle") },
      content: `
        <p>${game.i18n.format("ARMY.Treasury.setPrompt", {
          balance: fmt(current), currency: escapeHTML(cfg.currency)
        })}</p>
        <div class="form-group">
          <label>${game.i18n.format("ARMY.Treasury.balanceLabel", { currency: escapeHTML(cfg.currency) })}</label>
          <input type="number" name="balance" step="any" value="${current}" autofocus>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("ARMY.Treasury.noteLabel")}</label>
          <input type="text" name="note" placeholder="${game.i18n.localize("ARMY.Treasury.notePh")}">
        </div>`,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("ARMY.Treasury.set"),
        icon: "fa-solid fa-pen",
        callback: (event, button) => ({
          balance: Number(button.form.elements.balance.value),
          note: button.form.elements.note.value.trim()
        })
      }
    });
    if (!result || Number.isNaN(result.balance)) return;
    await setTreasuryBalance(result.balance, result.note);
  }

  /**
   * Record what a battle, siege or sacking brought in.
   *
   * The generator is a starting point, not a verdict: it works out a figure
   * from the engagement and the level, shows the arithmetic, and drops it into
   * an editable field. A GM who already knows the number types it in and
   * ignores the rest.
   */
  static async _onRecordLoot() {
    if (!game.user.isGM) return;
    const cfg = getConfig();
    const esc = escapeHTML;
    const loc = (k) => game.i18n.localize(k);
    const armyLevel = getArmyData().structure.army?.level ?? 1;

    const kindOptions = Object.keys(HAUL_KINDS)
      .map((k) => `<option value="${k}">${esc(loc(`ARMY.Loot.kind.${k}`))}</option>`).join("");
    const sizeOptions = Object.keys(SETTLEMENTS)
      .map((k) => `<option value="${k}"${k === "town" ? " selected" : ""}>${esc(loc(`ARMY.Loot.size.${k}`))}</option>`).join("");

    const content = `
      <p>${loc("ARMY.Loot.prompt")}</p>
      <div class="form-group">
        <label>${loc("ARMY.Loot.kindLabel")}</label>
        <select name="kind">${kindOptions}</select>
      </div>
      <div class="form-group at-loot-settlement" hidden>
        <label>${loc("ARMY.Loot.sizeLabel")}</label>
        <select name="settlement">${sizeOptions}</select>
      </div>
      <div class="form-group">
        <label>${loc("ARMY.Loot.levelLabel")}</label>
        <input type="number" name="level" min="1" max="${MAX_LEVEL}" step="1" value="${armyLevel}">
      </div>
      <div class="form-group">
        <label>${loc("ARMY.Loot.varianceLabel")}</label>
        <input type="checkbox" name="variance" checked>
      </div>
      <div class="at-btn-row">
        <button type="button" class="at-roll-haul">
          <i class="fa-solid fa-dice-d20"></i> ${loc("ARMY.Loot.roll")}
        </button>
      </div>
      <p class="at-loot-working at-hint">${loc("ARMY.Loot.workingHint")}</p>
      <div class="form-group">
        <label>${game.i18n.format("ARMY.Loot.amountLabel", { currency: esc(cfg.currency) })}</label>
        <input type="number" name="amount" step="any" min="0" value="0">
      </div>
      <div class="form-group">
        <label>${loc("ARMY.Treasury.noteLabel")}</label>
        <input type="text" name="note" placeholder="${loc("ARMY.Loot.notePh")}">
      </div>`;

    const result = await DialogV2.prompt({
      window: { title: loc("ARMY.Loot.title") },
      content,
      rejectClose: false,
      render: (event, dialog) => ArmyTrackerApp.#wireLootDialog(dialog),
      ok: {
        label: loc("ARMY.Loot.confirm"),
        icon: "fa-solid fa-sack-dollar",
        callback: (event, button) => ({
          amount: Number(button.form.elements.amount.value),
          note: button.form.elements.note.value.trim(),
          kind: button.form.elements.kind.value
        })
      }
    });
    if (!result || Number.isNaN(result.amount) || result.amount <= 0) return;

    const label = game.i18n.localize(`ARMY.Loot.kind.${result.kind}`);
    await creditTreasury({
      amount: result.amount,
      type: "loot",
      note: result.note ? `${label} — ${result.note}` : label
    });
  }

  /**
   * Live-wire the haul dialog: show the settlement picker only for a sacking,
   * and put the rolled figure and its working into the form.
   */
  static #wireLootDialog(dialog) {
    const root = dialog?.element ?? dialog;
    const form = root?.querySelector?.("form") ?? root;
    if (!form) return;
    const el = (name) => form.querySelector(`[name="${name}"]`);
    const settlementGroup = form.querySelector(".at-loot-settlement");
    const working = form.querySelector(".at-loot-working");

    const syncKind = () => {
      const sack = el("kind").value === "sack";
      if (settlementGroup) settlementGroup.hidden = !sack;
      if (sack) el("level").value = SETTLEMENTS[el("settlement").value]?.level ?? 3;
    };

    const roll = () => {
      const haul = generateHaul({
        kind: el("kind").value,
        level: Number(el("level").value),
        settlement: el("settlement").value,
        variance: el("variance").checked
      });
      el("amount").value = haul.total;
      if (working) {
        working.textContent = game.i18n.format("ARMY.Loot.working", {
          base: fmt(haul.base),
          level: haul.level,
          multiplier: haul.multiplier,
          roll: haul.roll,
          total: fmt(haul.total)
        });
      }
    };

    el("kind")?.addEventListener("change", syncKind);
    el("settlement")?.addEventListener("change", syncKind);
    form.querySelector(".at-roll-haul")?.addEventListener("click", roll);
    syncKind();
  }

  /** Split a slice of the war chest among the roster. */
  static async _onShareOut() {
    if (!game.user.isGM) return;
    const data = getArmyData();
    if (!data.roster.length) {
      ui.notifications.warn(game.i18n.localize("ARMY.RosterEmptyWarn"));
      return;
    }
    const cfg = getConfig();
    const balance = getTreasury(data).balance;
    if (balance <= 0) {
      ui.notifications.warn(game.i18n.localize("ARMY.Treasury.empty"));
      return;
    }

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize("ARMY.Shares.title") },
      content: `
        <p>${game.i18n.format("ARMY.Shares.prompt", {
          balance: fmt(balance), currency: escapeHTML(cfg.currency), count: data.roster.length
        })}</p>
        <div class="form-group">
          <label>${game.i18n.format("ARMY.Shares.amountLabel", { currency: escapeHTML(cfg.currency) })}</label>
          <input type="number" name="amount" step="any" min="0" max="${balance}" value="${balance}" autofocus>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("ARMY.Shares.modeLabel")}</label>
          <select name="mode">
            <option value="equal">${game.i18n.localize("ARMY.Shares.mode.equal")}</option>
            <option value="rank">${game.i18n.localize("ARMY.Shares.mode.rank")}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("ARMY.Bonus.debtFirst")}</label>
          <input type="checkbox" name="clearDebtFirst">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("ARMY.Treasury.noteLabel")}</label>
          <input type="text" name="note" placeholder="${game.i18n.localize("ARMY.Shares.notePh")}">
        </div>`,
      rejectClose: false,
      ok: {
        label: game.i18n.localize("ARMY.Shares.confirm"),
        icon: "fa-solid fa-hand-holding-heart",
        callback: (event, button) => ({
          amount: Number(button.form.elements.amount.value),
          mode: button.form.elements.mode.value,
          clearDebtFirst: button.form.elements.clearDebtFirst.checked,
          note: button.form.elements.note.value.trim()
        })
      }
    });
    if (!result || Number.isNaN(result.amount) || result.amount <= 0) return;

    const outcome = await distributeShares({
      amount: Math.min(round2(result.amount), balance),
      mode: result.mode,
      clearDebtFirst: result.clearDebtFirst,
      note: result.note
    });
    if (outcome && !outcome.ok) ui.notifications.warn(game.i18n.localize(outcome.error));
  }

  /** Put the balances back as they were before the last batch change. */
  static async _onUndoLast() {
    if (!game.user.isGM) return;
    const data = getArmyData();
    const label = undoLabel(data);
    if (!label) return;

    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("ARMY.Undo.title") },
      content: `<p>${game.i18n.format("ARMY.Undo.prompt", { label: escapeHTML(label) })}</p>`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;

    const undone = await undoLast(data);
    if (undone) ui.notifications.info(game.i18n.format("ARMY.Undo.done", { label: undone.label }));
  }

  /** Cycle a member between inheriting the visibility rule, always, and never. */
  static async _onCycleFinanceAccess(event, target) {
    if (!game.user.isGM) return;
    const order = ["inherit", "grant", "deny"];
    const current = target.dataset.state ?? "inherit";
    const next = order[(order.indexOf(current) + 1) % order.length];
    await applyOps([{
      action: "set",
      path: `roster.${Number(target.dataset.index)}.financeAccess`,
      value: next
    }]);
  }

  static _onClearLedgerFilter() {
    this.#ledgerType = "all";
    this.#ledgerMember = "all";
    this.render();
  }

  static _onOpenConfig() {
    new ArmyConfigApp().render({ force: true });
  }

  /** Read the level from stored data rather than the button, so it is never stale. */
  static async _onOpenShop() {
    await openArmyShop(getArmyData().structure.army?.level ?? 1);
  }
}
