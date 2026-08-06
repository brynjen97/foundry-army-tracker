# Army Tracker

A Foundry VTT module for running campaigns in a military setting. Track your party's ranks, daily wages and deductions, debts and camp-vault savings — then hit **Advance Day** to pay the troops. A second tab maps your army's structure from hosts down to individual squads, and players can fill in the characters they meet along the way.

Compatible with **Foundry VTT v12 and v13**. System-agnostic, with optional **Pathfinder 2e** integration that moves real coin between character inventories and the vault.

## Features

### Pay & Roster

A dedicated, resizable window with a table of party members:

- **Rank** — dropdown of Soldier, Corporal, Sergeant, Lieutenant, Captain. Each rank has a default daily wage, configurable in the module settings.
- **Daily wage override** — leave blank to use the rank default (shown greyed out), or type a value to override it for that member.
- **Daily deductions** — expand a member's row to itemise daily costs (food, camp maintenance, etc.), each with its own label and amount. Two sensible defaults are pre-filled for new members.
- **Salary breakdown** — the expanded row shows net daily pay plus calculated weekly, monthly and yearly salaries (days per week/month/year are configurable).
- **Debt & loans** — track each member's debt. Loans are capped at six months of base salary by default (configurable). The GM can grant loans and repay debt from the vault with one click.
- **Camp vault** — each member's money stored in the camp vault, with a running total for the whole party. Players can **deposit and withdraw** their own savings (see below).

### Deposits & withdrawals

Each expanded row has a **Camp Vault** panel with **Deposit** and **Withdraw** buttons. Players see them for characters they own; the GM sees them for everyone.

On **Pathfinder 2e** this moves real coin: depositing removes it from the character's inventory (PF2e makes change across denominations automatically, so paying 20 gp out of platinum and silver just works), and withdrawing adds it back as gp/sp/cp. The panel shows what the character is currently carrying alongside their vault balance.

Every transfer is carried out by the GM's client, which means:

- A player can only move money for a character they own.
- Coin is taken **before** the vault is credited, and handed over **before** the vault is debited — so a failed transfer never creates or destroys money.
- Each transfer posts a short line to chat, giving the table a ledger of who moved what.

On other systems the buttons still work as **ledger-only** bookkeeping: the vault balance changes and the dialog reminds you to move the coin on the character sheet yourself. Vault amounts are interpreted as **gold pieces** for PF2e conversion (1 gp = 100 cp), so balances stay exact to the copper.

### Advance Day

The **Advance Day** button (GM only) pays every roster member their net daily wage:

1. Pay is applied to outstanding **debt** first.
2. Whatever remains goes into the member's **camp vault** stash.
3. If deductions exceed the wage, the shortfall is drawn from the vault — and becomes debt once the vault runs dry.

Each payday posts a summary card to chat showing everyone's pay, vault and debt changes.

The fast-forward button next to it advances **multiple days at once** (e.g. skip 20 days of travel) — pay is applied day by day so debt is still paid off before vault savings accumulate, and a single chat card summarises the whole period.

### Army Structure

A collapsible hierarchy — **Host → Company → Cohort → Squad** — that anyone at the table can edit:

- Name each unit and add sub-units with the **+** button on its header.
- Squads hold a roster of named characters with a rank/role and free-text notes, so players can record the NPCs they serve alongside.
- Collapsed units show a summary count, keeping big armies readable.

Player edits are relayed through the GM's client, so a GM must be connected for changes to save.

## Opening the tracker

- Click the **Army Tracker** button at the top of the **Actors** sidebar tab, or
- Bind a key under *Configure Controls → Army Tracker*, or
- From a macro or the console: `game.modules.get("foundry-army-tracker").api.open()`

## Installation

**Manifest URL** (Foundry → Add-on Modules → Install Module):

```
https://github.com/dingus17/foundry-army-tracker/releases/latest/download/module.json
```

**Manual**: clone or download this repository into your user data folder as `Data/modules/foundry-army-tracker`, then restart Foundry and enable *Army Tracker* in your world.

## Settings

All settings are world-scoped (Configure Settings → Army Tracker):

| Setting | Default | Notes |
| --- | --- | --- |
| Daily wage per rank | 1 / 2 / 3 / 5 / 8 | Soldier → Captain |
| Days per week | 7 | Weekly salary calculation |
| Days per month | 30 | Monthly salary and loan cap |
| Days per year | 360 | Yearly salary calculation |
| Loan cap | 6 months | Of the member's *base* (pre-deduction) salary |
| Currency label | gp | Purely cosmetic — use whatever fits your setting |

## Notes

- All data is stored in a world setting, so it lives with your world and is included in world backups.
- Granting a loan increases the member's debt; handing the actual coin to the character is left to the GM. To pay it out for real on PF2e, grant the loan and then use **Withdraw** for the same amount.
- The roster is GM-editable only, except for vault deposits and withdrawals, which players may perform for their own characters. The Army Structure tab is editable by everyone.
- Player actions are relayed through the GM's client, so a GM must be connected.
