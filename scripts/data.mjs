import { MODULE_ID, RANKS, SETTING_DATA } from "./constants.mjs";
import { round2, fmt } from "./util.mjs";
import { giveToActor, supportsInventoryTransfer, takeFromActor } from "./currency.mjs";

export { round2, fmt };

export const DEFAULT_DATA = { day: 0, roster: [], structure: { hosts: [] } };

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_DATA, {
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_DATA)
  });

  for (const rank of Object.values(RANKS)) {
    game.settings.register(MODULE_ID, rank.setting, {
      name: `ARMY.Settings.${rank.setting}.name`,
      hint: "ARMY.Settings.wageHint",
      scope: "world",
      config: true,
      type: Number,
      default: rank.defaultWage
    });
  }

  const numeric = [
    ["daysPerWeek", 7],
    ["daysPerMonth", 30],
    ["daysPerYear", 360],
    ["loanMonths", 6]
  ];
  for (const [key, def] of numeric) {
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

export function getConfig() {
  return {
    daysPerWeek: game.settings.get(MODULE_ID, "daysPerWeek"),
    daysPerMonth: game.settings.get(MODULE_ID, "daysPerMonth"),
    daysPerYear: game.settings.get(MODULE_ID, "daysPerYear"),
    loanMonths: game.settings.get(MODULE_ID, "loanMonths"),
    currency: game.settings.get(MODULE_ID, "currency")
  };
}

/* -------------------------------------------- */
/*  Data access                                 */
/* -------------------------------------------- */

export function getArmyData() {
  const stored = game.settings.get(MODULE_ID, SETTING_DATA) ?? {};
  const data = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_DATA), foundry.utils.deepClone(stored), { inplace: false });
  data.roster ??= [];
  data.structure ??= { hosts: [] };
  data.structure.hosts ??= [];
  return data;
}

export function getRankWage(rank) {
  const r = RANKS[rank] ?? RANKS.soldier;
  return Number(game.settings.get(MODULE_ID, r.setting)) || 0;
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
      <p class="at-currency-note">${game.i18n.format("ARMY.Payday.currencyNote", { currency: esc(cfg.currency) })}</p>
      ` : `<p>${loc("ARMY.Payday.empty")}</p>`}
    </div>`;

  await ChatMessage.create({
    content,
    speaker: { alias: loc("ARMY.Payday.speaker") }
  });
}
