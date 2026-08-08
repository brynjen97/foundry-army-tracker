import { LEVELS, MODULE_ID, SETTING_DATA } from "./constants.mjs";
import { round2, fmt, escapeHTML, docClass } from "./util.mjs";
import { addItemToActor, giveToActor, itemPriceGold, supportsInventoryTransfer, takeFromActor } from "./currency.mjs";
import {
  DEFAULT_STRUCTURE,
  getConfig,
  getCounts,
  getDeductionTemplate,
  getOfficerTitles,
  getRank,
  getRanks,
  includeOfficers,
  registerSettings,
  requisitionApprovalRequired,
  seedDefaults,
  soldiersPerSquad
} from "./settings.mjs";

export { round2, fmt, escapeHTML, getConfig, registerSettings, seedDefaults, getRanks };

export const DEFAULT_DATA = () => ({ day: 0, roster: [], structure: DEFAULT_STRUCTURE() });

/* -------------------------------------------- */
/*  Data access                                 */
/* -------------------------------------------- */

export function getArmyData() {
  const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_DATA) ?? {});
  const data = foundry.utils.mergeObject(DEFAULT_DATA(), stored, { inplace: false });
  data.roster ??= [];
  data.structure ??= {};

  // Pre-army-level worlds stored hosts at the root; adopt them under the army.
  if (Array.isArray(data.structure.hosts) && !data.structure.army) {
    data.structure = {
      army: { id: foundry.utils.randomID(), name: "", notes: "", officers: [], hosts: data.structure.hosts }
    };
  }
  delete data.structure.hosts;

  const army = data.structure.army ?? (data.structure.army = {});
  army.id ??= foundry.utils.randomID();
  army.name ??= "";
  army.notes ??= "";
  army.level ??= 1;
  army.officers ??= [];
  army.hosts ??= [];
  return data;
}

/* -------------------------------------------- */
/*  Pay                                         */
/* -------------------------------------------- */

export function getRankWage(rankId) {
  return getRank(rankId)?.wage ?? 0;
}

/** The wage actually paid: manual override if set, otherwise the rank's default. */
export function effectiveWage(member) {
  return member.wageOverride ?? getRankWage(member.rank);
}

export function memberName(member) {
  if (member.actorId) {
    const actor = game.actors.get(member.actorId);
    if (actor) return actor.name;
  }
  return member.name || game.i18n.localize("ARMY.UnnamedMember");
}

/** Compute all derived pay values for a roster member. */
export function computePay(member) {
  const cfg = getConfig();
  const base = round2(effectiveWage(member));
  const deductions = round2((member.deductions ?? []).reduce((sum, d) => sum + (Number(d.amount) || 0), 0));
  const net = round2(base - deductions);
  return {
    base,
    deductions,
    net,
    weekly: round2(net * cfg.daysPerWeek),
    monthly: round2(net * cfg.daysPerMonth),
    yearly: round2(net * cfg.daysPerYear),
    maxLoan: round2(base * cfg.daysPerMonth * cfg.loanMonths)
  };
}

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
/*  Updates (GM-authoritative via socket)       */
/* -------------------------------------------- */

/**
 * Apply a list of update operations to the army data.
 * Ops: {action:"set", path, value} | {action:"push", path, value} | {action:"remove", path, index}
 * GMs apply directly; players relay to the active GM over the module socket.
 * Players may only modify the army structure (paths under "structure.").
 * @returns {Promise<boolean>} whether the update was applied or relayed
 */
export async function applyOps(ops) {
  if (game.user.isGM) {
    await applyOpsAsGM(ops, game.user.id);
    return true;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("ARMY.NoGM"));
    return false;
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "ops", ops, userId: game.user.id });
  return true;
}

async function applyOpsAsGM(ops, userId) {
  const isGM = game.users.get(userId)?.isGM ?? false;
  const data = getArmyData();
  let changed = false;
  for (const op of ops) {
    const path = String(op.path ?? "");
    if (!path || path.includes("-=")) continue;
    if (!isGM && !path.startsWith("structure.") && path !== "structure") continue;
    try {
      switch (op.action) {
        case "set":
          foundry.utils.setProperty(data, path, op.value);
          changed = true;
          break;
        case "push": {
          const arr = foundry.utils.getProperty(data, path);
          if (Array.isArray(arr)) {
            arr.push(op.value);
            changed = true;
          }
          break;
        }
        case "remove": {
          const arr = foundry.utils.getProperty(data, path);
          if (Array.isArray(arr) && Number.isInteger(op.index) && op.index >= 0 && op.index < arr.length) {
            arr.splice(op.index, 1);
            changed = true;
          }
          break;
        }
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to apply op`, op, err);
    }
  }
  if (changed) await game.settings.set(MODULE_ID, SETTING_DATA, data);
}

/** Socket handler: only the active GM applies relayed player updates. */
export function onSocketMessage(message) {
  switch (message?.type) {
    case "ops":
      if (!game.user.isGM || game.user !== game.users.activeGM) return;
      applyOpsAsGM(message.ops ?? [], message.userId);
      return;
    case "transfer":
      if (!game.user.isGM || game.user !== game.users.activeGM) return;
      performTransfer(message).then((result) => {
        game.socket.emit(`module.${MODULE_ID}`, { type: "transferResult", userId: message.userId, result });
      });
      return;
    case "transferResult":
      if (message.userId !== game.user.id) return;
      reportTransfer(message.result);
      return;
    case "requisition":
      if (!game.user.isGM || game.user !== game.users.activeGM) return;
      routeRequisition(message);
      return;
    case "requisitionResult":
      if (message.userId !== game.user.id) return;
      reportRequisition(message.result);
      return;
    case "requisitionPending":
      if (message.userId !== game.user.id) return;
      reportPending(message.approverName);
      return;
    case "requisitionApproval":
      // Only the ranking member's owner is asked; everyone else ignores it.
      if (!message.approvers?.includes(game.user.id)) return;
      promptApproval(message.request).then((approved) => {
        game.socket.emit(`module.${MODULE_ID}`, {
          type: "requisitionDecision",
          requestId: message.request.requestId,
          approved: approved === true,
          userId: game.user.id
        });
      });
      return;
    case "requisitionDecision":
      if (!game.user.isGM || game.user !== game.users.activeGM) return;
      onRequisitionDecision(message);
      return;
  }
}

/* -------------------------------------------- */
/*  Vault deposits & withdrawals                */
/* -------------------------------------------- */

/**
 * Move money between a character's inventory and their camp vault.
 * Always executed by the active GM so the coin change and the vault change
 * happen together, and so a player cannot touch someone else's purse.
 * @returns {Promise<object>} {ok, error?, direction, amount, vault, name}
 */
export async function performTransfer({ memberId, direction, amount, userId }) {
  const data = getArmyData();
  const member = data.roster.find((m) => m.id === memberId);
  if (!member) return { ok: false, error: "ARMY.Transfer.NoMember" };

  const user = game.users.get(userId);
  if (!user) return { ok: false, error: "ARMY.Transfer.NoUser" };

  const actor = member.actorId ? game.actors.get(member.actorId) : null;

  // Players may only move their own character's money.
  if (!user.isGM && !actor?.testUserPermission(user, "OWNER")) {
    return { ok: false, error: "ARMY.Transfer.NotOwner" };
  }

  amount = round2(amount);
  if (!(amount > 0)) return { ok: false, error: "ARMY.Transfer.BadAmount" };

  const vault = round2(member.vault ?? 0);
  const linked = supportsInventoryTransfer(actor);
  const name = memberName(member);

  if (direction === "deposit") {
    // Take the coin first: if the character cannot cover it, nothing is credited.
    if (linked && !(await takeFromActor(actor, amount))) {
      return { ok: false, error: "ARMY.Transfer.Insufficient" };
    }
    member.vault = round2(vault + amount);
  } else {
    if (amount > vault) return { ok: false, error: "ARMY.Transfer.VaultShort" };
    // Hand over the coin first: if the items cannot be created, the vault is untouched.
    if (linked && !(await giveToActor(actor, amount))) {
      return { ok: false, error: "ARMY.Transfer.Failed" };
    }
    member.vault = round2(vault - amount);
  }

  await game.settings.set(MODULE_ID, SETTING_DATA, data);

  const cfg = getConfig();
  await docClass("ChatMessage").create({
    content: `
      <div class="at-payday">
        <h3><i class="fa-solid fa-vault"></i> ${game.i18n.localize("ARMY.Transfer.chatHeader")}</h3>
        <p>${game.i18n.format(`ARMY.Transfer.chat.${direction}`, {
          name: escapeHTML(name),
          amount: fmt(amount),
          currency: escapeHTML(cfg.currency)
        })}</p>
        <p class="at-currency-note">${game.i18n.format("ARMY.Transfer.chatBalance", {
          vault: fmt(member.vault),
          currency: escapeHTML(cfg.currency)
        })}</p>
      </div>`,
    speaker: { alias: game.i18n.localize("ARMY.Payday.speaker") }
  });

  return { ok: true, direction, amount, vault: member.vault, name, linked };
}

/** Show the outcome of a transfer to the user who requested it. */
export function reportTransfer(result) {
  if (!result) return;
  const cfg = getConfig();
  if (!result.ok) {
    ui.notifications.warn(game.i18n.localize(result.error ?? "ARMY.Transfer.Failed"));
    return;
  }
  ui.notifications.info(game.i18n.format(`ARMY.Transfer.done.${result.direction}`, {
    amount: fmt(result.amount),
    currency: cfg.currency,
    vault: fmt(result.vault)
  }));
}

/* -------------------------------------------- */
/*  Chain of command                            */
/* -------------------------------------------- */

/**
 * The senior member of the roster.
 *
 * Seniority comes from the order of the configured rank list — the last rank
 * is the most senior — so the GM controls it by arranging ranks in the config
 * menu. Ties are broken by effective wage, then by roster order, so the answer
 * is stable rather than depending on iteration luck.
 */
export function highestRankingMember(roster = null) {
  const list = roster ?? getArmyData().roster;
  if (!list?.length) return null;
  const order = new Map(getRanks().map((r, i) => [r.id, i]));
  let best = null;
  let bestRank = -Infinity;
  let bestWage = -Infinity;
  for (const member of list) {
    const rank = order.has(member.rank) ? order.get(member.rank) : -1;
    const wage = round2(effectiveWage(member));
    if (rank > bestRank || (rank === bestRank && wage > bestWage)) {
      best = member;
      bestRank = rank;
      bestWage = wage;
    }
  }
  return best;
}

/** Online, non-GM users who own the member's character. */
function ownersOnline(member) {
  if (!member?.actorId) return [];
  const actor = game.actors.get(member.actorId);
  if (!actor) return [];
  return game.users
    .filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))
    .map((u) => u.id);
}

/* -------------------------------------------- */
/*  Requisition                                 */
/* -------------------------------------------- */

/**
 * Draw an item against the army's credit rather than the character's purse.
 *
 * Mechanically this is a loan spent at the point of purchase: the item goes
 * into the character's inventory and its price is added to their debt, so it
 * is bound by the same cap as a cash loan and is paid off the same way, out
 * of daily wages. The character's own coin is never touched.
 */
export async function performRequisition({ memberId, uuid, quantity, userId }) {
  const data = getArmyData();
  const member = data.roster.find((m) => m.id === memberId);
  if (!member) return { ok: false, error: "ARMY.Transfer.NoMember" };

  const user = game.users.get(userId);
  if (!user) return { ok: false, error: "ARMY.Transfer.NoUser" };

  const actor = member.actorId ? game.actors.get(member.actorId) : null;
  if (!actor) return { ok: false, error: "ARMY.Requisition.noActor" };
  if (!user.isGM && !actor.testUserPermission(user, "OWNER")) {
    return { ok: false, error: "ARMY.Transfer.NotOwner" };
  }

  const item = await globalThis.fromUuid?.(uuid);
  if (!item) return { ok: false, error: "ARMY.Requisition.noItem" };

  const unit = itemPriceGold(item);
  if (unit === null) return { ok: false, error: "ARMY.Requisition.noPrice" };

  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const total = round2(unit * qty);

  const cfg = getConfig();
  const pay = computePay(member);
  const debt = round2(member.debt ?? 0);
  const capacity = round2(pay.maxLoan - debt);
  if (total > capacity) {
    return {
      ok: false,
      error: "ARMY.Requisition.overCap",
      detail: game.i18n.format("ARMY.Requisition.overCapDetail", {
        total: fmt(total), capacity: fmt(Math.max(0, capacity)), currency: cfg.currency
      })
    };
  }

  // Hand over the goods before recording the debt, so a failed creation
  // cannot leave a character owing money for an item they never received.
  if (!(await addItemToActor(actor, item, qty))) {
    return { ok: false, error: "ARMY.Requisition.failed" };
  }
  member.debt = round2(debt + total);
  await game.settings.set(MODULE_ID, SETTING_DATA, data);

  await docClass("ChatMessage").create({
    content: `
      <div class="at-payday">
        <h3><i class="fa-solid fa-clipboard-check"></i> ${game.i18n.localize("ARMY.Requisition.chatHeader")}</h3>
        <p>${game.i18n.format("ARMY.Requisition.chat", {
          name: escapeHTML(memberName(member)),
          item: escapeHTML(item.name),
          qty,
          total: fmt(total),
          currency: escapeHTML(cfg.currency)
        })}</p>
        <p class="at-currency-note">${game.i18n.format("ARMY.Requisition.chatDebt", {
          debt: fmt(member.debt),
          remaining: fmt(round2(capacity - total)),
          currency: escapeHTML(cfg.currency)
        })}</p>
      </div>`,
    speaker: { alias: game.i18n.localize("ARMY.Payday.speaker") }
  });

  return {
    ok: true,
    item: item.name,
    qty,
    total,
    debt: member.debt,
    remaining: round2(capacity - total)
  };
}

/* -------------------------------------------- */
/*  Requisition approval                        */
/* -------------------------------------------- */

/** Requests awaiting sign-off, held on the GM's client only. */
const pendingRequisitions = new Map();

/** Requests are dropped rather than left hanging if nobody answers. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function prunePending() {
  const cutoff = Date.now() - APPROVAL_TIMEOUT_MS;
  for (const [id, entry] of pendingRequisitions) {
    if (entry.at < cutoff) pendingRequisitions.delete(id);
  }
}

/**
 * Decide whether a requisition needs sign-off, and either run it or send the
 * request to the ranking member. Runs on the active GM, so the approval step
 * cannot be skipped by a player editing their own client.
 */
export async function routeRequisition(message) {
  prunePending();
  const requester = game.users.get(message.userId);

  // The GM is the authority here, so their own requisitions do not queue.
  if (!requisitionApprovalRequired() || requester?.isGM) {
    return respondRequisition(message.userId, await performRequisition(message));
  }

  const data = getArmyData();
  const approver = highestRankingMember(data.roster);

  // Nobody outranks the requester, so there is no one to ask.
  if (!approver || approver.id === message.memberId) {
    return respondRequisition(message.userId, await performRequisition(message));
  }

  // Preview the cost so the approver sees what they are signing off.
  const item = await globalThis.fromUuid?.(message.uuid);
  const unit = itemPriceGold(item);
  if (!item || unit === null) {
    return respondRequisition(message.userId, await performRequisition(message));
  }

  const member = data.roster.find((m) => m.id === message.memberId);
  const qty = Math.max(1, Math.floor(Number(message.quantity) || 1));
  const approvers = ownersOnline(approver);
  const request = {
    requestId: foundry.utils.randomID(),
    requesterName: memberName(member ?? {}),
    approverName: memberName(approver),
    item: item.name,
    qty,
    total: round2(unit * qty)
  };

  // With no player at the keyboard for the ranking member, the GM signs off.
  if (!approvers.length) {
    const approved = await promptApproval(request);
    return respondRequisition(message.userId, approved
      ? await performRequisition(message)
      : { ok: false, error: "ARMY.Requisition.denied" });
  }

  pendingRequisitions.set(request.requestId, {
    payload: message, approvers, at: Date.now()
  });
  game.socket.emit(`module.${MODULE_ID}`, {
    type: "requisitionApproval", approvers, request
  });
  game.socket.emit(`module.${MODULE_ID}`, {
    type: "requisitionPending", userId: message.userId, approverName: request.approverName
  });
  if (message.userId === game.user.id) reportPending(request.approverName);
}

/** Handle a decision coming back from the ranking member's client. */
export async function onRequisitionDecision(message) {
  const entry = pendingRequisitions.get(message.requestId);
  if (!entry) return; // already answered, or expired
  // Only a user who was actually asked may answer.
  if (!entry.approvers.includes(message.userId)) return;
  pendingRequisitions.delete(message.requestId);

  respondRequisition(entry.payload.userId, message.approved
    ? await performRequisition(entry.payload)
    : { ok: false, error: "ARMY.Requisition.denied" });
}

/** Show the approval prompt and return the decision. */
export async function promptApproval(request) {
  const cfg = getConfig();
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("ARMY.Requisition.approvalTitle") },
    content: `
      <p>${game.i18n.format("ARMY.Requisition.approvalPrompt", {
        requester: escapeHTML(request.requesterName),
        qty: request.qty,
        item: escapeHTML(request.item),
        total: fmt(request.total),
        currency: escapeHTML(cfg.currency)
      })}</p>
      <p class="at-hint">${game.i18n.format("ARMY.Requisition.approvalNote", {
        approver: escapeHTML(request.approverName)
      })}</p>`,
    yes: { label: game.i18n.localize("ARMY.Requisition.approve"), icon: "fa-solid fa-check" },
    no: { label: game.i18n.localize("ARMY.Requisition.deny"), icon: "fa-solid fa-xmark" },
    rejectClose: false,
    modal: true
  });
}

function respondRequisition(userId, result) {
  if (userId === game.user.id) return reportRequisition(result);
  game.socket.emit(`module.${MODULE_ID}`, { type: "requisitionResult", userId, result });
}

export function reportPending(approverName) {
  ui.notifications.info(game.i18n.format("ARMY.Requisition.pending", { approver: approverName }));
}

export function reportRequisition(result) {
  if (!result) return;
  const cfg = getConfig();
  if (!result.ok) {
    const base = game.i18n.localize(result.error ?? "ARMY.Requisition.failed");
    ui.notifications.warn(result.detail ? `${base} ${result.detail}` : base);
    return;
  }
  ui.notifications.info(game.i18n.format("ARMY.Requisition.done", {
    item: result.item, qty: result.qty, total: fmt(result.total), currency: cfg.currency
  }));
}

/** Request a requisition: GMs route it locally, players relay to the active GM. */
export async function requestRequisition({ memberId, uuid, quantity }) {
  if (game.user.isGM) {
    await routeRequisition({ memberId, uuid, quantity, userId: game.user.id });
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("ARMY.NoGM"));
    return;
  }
  game.socket.emit(`module.${MODULE_ID}`, {
    type: "requisition", memberId, uuid, quantity, userId: game.user.id
  });
}

/** Request a transfer: GMs run it directly, players relay it to the active GM. */
export async function requestTransfer({ memberId, direction, amount }) {
  if (game.user.isGM) {
    reportTransfer(await performTransfer({ memberId, direction, amount, userId: game.user.id }));
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("ARMY.NoGM"));
    return;
  }
  game.socket.emit(`module.${MODULE_ID}`, {
    type: "transfer",
    memberId,
    direction,
    amount,
    userId: game.user.id
  });
}

/* -------------------------------------------- */
/*  Advance day                                 */
/* -------------------------------------------- */

/**
 * Advance the campaign by one or more days (GM only). Each day, every member's
 * net daily pay is applied to their debt first; the remainder goes into their
 * camp vault stash. A negative net wage is drawn from the vault, then becomes
 * debt. Multi-day advances apply the same logic day by day, so pay keeps
 * chipping away at debt before it starts accumulating in the vault.
 * @param {number} [days=1]  Number of days to advance (1–3650).
 */
export async function advanceDay(days = 1) {
  if (!game.user.isGM) return;
  days = Math.max(1, Math.min(3650, Math.floor(Number(days) || 1)));
  const data = getArmyData();
  const cfg = getConfig();
  const rows = [];

  for (const member of data.roster) {
    const pay = computePay(member);
    const oldDebt = round2(member.debt ?? 0);
    const oldVault = round2(member.vault ?? 0);
    let debt = oldDebt;
    let vault = oldVault;

    for (let i = 0; i < days; i++) {
      if (pay.net >= 0) {
        const towardDebt = Math.min(debt, pay.net);
        debt = round2(debt - towardDebt);
        vault = round2(vault + (pay.net - towardDebt));
      } else {
        const deficit = -pay.net;
        const fromVault = Math.min(vault, deficit);
        vault = round2(vault - fromVault);
        debt = round2(debt + (deficit - fromVault));
      }
    }

    member.debt = debt;
    member.vault = vault;
    rows.push({
      name: memberName(member),
      net: round2(pay.net * days),
      debtDelta: round2(debt - oldDebt),
      vaultDelta: round2(vault - oldVault),
      debt,
      vault
    });
  }

  const startDay = (data.day ?? 0) + 1;
  data.day = (data.day ?? 0) + days;
  await game.settings.set(MODULE_ID, SETTING_DATA, data);

  const esc = escapeHTML;
  const signed = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));
  const deltaClass = (v, goodWhenPositive) => {
    if (v === 0) return "";
    return (v > 0) === goodWhenPositive ? "at-pos" : "at-neg";
  };
  const loc = (k) => game.i18n.localize(k);

  const body = rows.map((r) => `
    <tr>
      <td class="at-c-name">${esc(r.name)}</td>
      <td>${fmt(r.net)}</td>
      <td class="${deltaClass(r.vaultDelta, true)}">${signed(r.vaultDelta)}</td>
      <td class="${deltaClass(r.debtDelta, false)}">${signed(r.debtDelta)}</td>
      <td>${fmt(r.vault)}</td>
      <td>${fmt(r.debt)}</td>
    </tr>`).join("");

  const header = days > 1
    ? game.i18n.format("ARMY.Payday.headerMulti", { from: startDay, to: data.day, days })
    : game.i18n.format("ARMY.Payday.header", { day: data.day });

  const content = `
    <div class="at-payday">
      <h3><i class="fa-solid fa-coins"></i> ${header}</h3>
      ${rows.length ? `
      <div class="at-payday-scroll">
      <table>
        <thead>
          <tr>
            <th class="at-c-name">${loc("ARMY.Payday.name")}</th>
            <th>${loc("ARMY.Payday.net")}${days > 1 ? ` (${days}d)` : ""}</th>
            <th>${loc("ARMY.Payday.vaultDelta")}</th>
            <th>${loc("ARMY.Payday.debtDelta")}</th>
            <th>${loc("ARMY.Payday.vault")}</th>
            <th>${loc("ARMY.Payday.debt")}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      </div>
      <p class="at-currency-note">${game.i18n.format("ARMY.Payday.currencyNote", { currency: esc(cfg.currency) })}</p>
      ` : `<p>${loc("ARMY.Payday.empty")}</p>`}
    </div>`;

  await docClass("ChatMessage").create({
    content,
    speaker: { alias: loc("ARMY.Payday.speaker") }
  });
}

/* -------------------------------------------- */
/*  Bonuses                                     */
/* -------------------------------------------- */

/**
 * What a single member would receive from a bonus.
 *
 * Week and month bonuses are worked out from the member's *base* wage rather
 * than their net pay. A bonus is a reward on top of their wages, so daily
 * living costs should not eat into it — and it means a member whose
 * deductions exceed their wage still receives something rather than a
 * negative "bonus".
 */
export function bonusFor(member, { mode, amount = 0 }) {
  const cfg = getConfig();
  const base = round2(effectiveWage(member));
  let value;
  switch (mode) {
    case "week": value = base * cfg.daysPerWeek; break;
    case "month": value = base * cfg.daysPerMonth; break;
    default: value = Number(amount) || 0;
  }
  return Math.max(0, round2(value));
}

/**
 * Pay a bonus to every member of the roster (GM only).
 * Goes straight into each member's camp vault unless clearDebtFirst is set,
 * in which case it pays down debt first the way ordinary wages do.
 */
export async function grantBonus({ mode, amount = 0, clearDebtFirst = false }) {
  if (!game.user.isGM) return null;
  const data = getArmyData();
  const cfg = getConfig();
  const rows = [];
  let total = 0;

  for (const member of data.roster) {
    const bonus = bonusFor(member, { mode, amount });
    const oldDebt = round2(member.debt ?? 0);
    let debt = oldDebt;
    let vault = round2(member.vault ?? 0);

    if (clearDebtFirst) {
      const towardDebt = Math.min(debt, bonus);
      debt = round2(debt - towardDebt);
      vault = round2(vault + (bonus - towardDebt));
    } else {
      vault = round2(vault + bonus);
    }

    member.debt = debt;
    member.vault = vault;
    total = round2(total + bonus);
    rows.push({
      name: memberName(member),
      bonus,
      debtDelta: round2(debt - oldDebt),
      vault,
      debt
    });
  }

  await game.settings.set(MODULE_ID, SETTING_DATA, data);

  const esc = escapeHTML;
  const loc = (k) => game.i18n.localize(k);
  const body = rows.map((r) => `
    <tr>
      <td class="at-c-name">${esc(r.name)}</td>
      <td class="${r.bonus ? "at-pos" : ""}">${r.bonus ? `+${fmt(r.bonus)}` : fmt(0)}</td>
      <td class="${r.debtDelta < 0 ? "at-pos" : ""}">${r.debtDelta ? fmt(r.debtDelta) : "—"}</td>
      <td>${fmt(r.vault)}</td>
      <td>${fmt(r.debt)}</td>
    </tr>`).join("");

  const content = `
    <div class="at-payday">
      <h3><i class="fa-solid fa-gift"></i> ${loc(`ARMY.Bonus.header.${mode}`)}</h3>
      ${rows.length ? `
      <div class="at-payday-scroll">
      <table>
        <thead>
          <tr>
            <th class="at-c-name">${loc("ARMY.Payday.name")}</th>
            <th>${loc("ARMY.Bonus.col")}</th>
            <th>${loc("ARMY.Payday.debtDelta")}</th>
            <th>${loc("ARMY.Payday.vault")}</th>
            <th>${loc("ARMY.Payday.debt")}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      </div>
      <p class="at-currency-note">${game.i18n.format("ARMY.Bonus.total", {
        total: fmt(total), currency: esc(cfg.currency), count: rows.length
      })}</p>
      ` : `<p>${loc("ARMY.Payday.empty")}</p>`}
    </div>`;

  await docClass("ChatMessage").create({
    content,
    speaker: { alias: loc("ARMY.Payday.speaker") }
  });

  return { total, count: rows.length };
}
