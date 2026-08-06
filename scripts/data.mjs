import { LEVELS, MODULE_ID, SETTING_DATA } from "./constants.mjs";
import { round2, fmt } from "./util.mjs";
import { giveToActor, supportsInventoryTransfer, takeFromActor } from "./currency.mjs";
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
  seedDefaults,
  soldiersPerSquad
} from "./settings.mjs";

export { round2, fmt, getConfig, registerSettings, seedDefaults, getRanks };

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
  await ChatMessage.create({
    content: `
      <div class="at-payday">
        <h3><i class="fa-solid fa-vault"></i> ${game.i18n.localize("ARMY.Transfer.chatHeader")}</h3>
        <p>${game.i18n.format(`ARMY.Transfer.chat.${direction}`, {
          name: Handlebars.escapeExpression(name),
          amount: fmt(amount),
          currency: Handlebars.escapeExpression(cfg.currency)
        })}</p>
        <p class="at-currency-note">${game.i18n.format("ARMY.Transfer.chatBalance", {
          vault: fmt(member.vault),
          currency: Handlebars.escapeExpression(cfg.currency)
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

  const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));
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

  await ChatMessage.create({
    content,
    speaker: { alias: loc("ARMY.Payday.speaker") }
  });
}
