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

### Bonuses

The **Bonus** button (GM only) pays every member of the roster at once, straight into their camp vaults. Three options:

- **Flat amount** — the same figure for everyone.
- **One week's pay** and **one month's pay** — vary per member with their rank and any wage override.

Week and month bonuses use each member's **base wage before deductions**, so daily living costs don't eat into the reward, and a member whose deductions exceed their wage still receives something instead of a negative "bonus". The dialog previews exactly what every member would get under both options, with totals, before you commit. Optionally tick **pay down debt first** to clear outstanding debt before banking the remainder. Each bonus posts a summary card to chat.

### Army Structure

A collapsible hierarchy — **Army → Host → Company → Cohort → Squad** — that anyone at the table can edit:

- The army carries a **level**, shown on its header. On **Pathfinder 2e** a shop icon sits beside it and opens the system's compendium browser on the equipment tab, filtered to **common items at or below that level** — a quick way to see what the army could plausibly source. The icon only appears on PF2e; the level field itself is available on any system.
- Units start **collapsed** — only the army itself opens by default, so a generated army of several hundred soldiers fits on one screen instead of unrolling into a wall of units. **Expand all** / **Collapse all** buttons sit above the tree, and opening a unit remembers itself while the window stays open.
- Name each unit and add sub-units with the **+** button on its header. Adding one opens both it and its parent, so what you just created is visible.
- Squads hold a roster of named characters with a rank/role and free-text notes, so players can record the NPCs they serve alongside.
- The **Army** sits at the root of the tree and carries a free-text notes field for campaign notes and standing orders.
- Collapsed units show a summary count, keeping big armies readable.

**Officers** (on by default, toggleable): every unit gets an officer slot, and you can add as many more as a unit needs. The first officer in a unit's list commands it, and is shown on the unit's header — so a collapsed army still reads as *1st Host — Helm Aldric*. A freshly generated army has titled but unnamed officers, which show greyed as *Helm (unnamed)* until you fill them in. Default titles per level — General for the army, Helm for a host, Captain for a company, Lieutenant for a cohort, Sergeant for a squad — are all editable, and any individual officer can be retitled afterwards.

**Strength** rolls up the tree. A squad counts the soldiers actually named in it, or falls back to the configured squad size when none have been recorded — so every cohort, company, host and the army itself shows a running headcount even before you name a single soldier. Officers are counted separately rather than padding the figure.

**Generate Army** builds the whole hierarchy in one click from the configured counts, naming units by position (1st Squad, 2nd Squad, …). It keeps the army's own name and notes and replaces the structure beneath.

Player edits are relayed through the GM's client, so a GM must be connected for changes to save.

## Opening the tracker

- Click the **Army Tracker** button at the top of the **Actors** sidebar tab, or
- Bind a key under *Configure Controls → Army Tracker*, or
- From a macro or the console: `game.modules.get("foundry-army-tracker").api.open()`

## Installation

### Option 1 — Manual (works immediately)

Drop the files into your Foundry user data folder. The folder **must** be named `foundry-army-tracker`, matching the `id` in `module.json`, or Foundry will refuse to load it.

```bash
cd /path/to/FoundryVTT/Data/modules
git clone https://github.com/Dingus17/foundry-army-tracker.git foundry-army-tracker
```

Or without git: download the repository as a ZIP from GitHub (*Code → Download ZIP*), unpack it, and rename the extracted `foundry-army-tracker-main` folder to `foundry-army-tracker`.

To pick up later changes, `git pull` inside that folder and reload Foundry (F5).

Where `Data` lives depends on your platform — Foundry shows the exact path under *Configuration → User Data Path*:

| Platform | Default location |
| --- | --- |
| Windows | `%localappdata%\FoundryVTT\Data\modules` |
| macOS | `~/Library/Application Support/FoundryVTT/Data/modules` |
| Linux | `~/.local/share/FoundryVTT/Data/modules` |

Then restart Foundry, and enable **Army Tracker** under *Game Settings → Manage Modules* in your world.

### Option 2 — Manifest URL (needs a release first)

A release has to exist before this URL resolves. The included GitHub Action builds one, and you can run it **entirely from the browser**:

> **Actions** tab → **Release Module** → **Run workflow** → enter `0.1.0` → **Run workflow**

No tag needed beforehand — the workflow creates the tag itself at the commit it runs against.

If you prefer the command line, pushing a version tag triggers the same workflow:

```bash
git tag v0.1.0
git push origin v0.1.0     # a plain `git push` does NOT send tags
```

Two things that quietly produce no release:

- `git tag v0.1.0` on its own only creates the tag **locally**. It has to be pushed explicitly, as above.
- In the Releases UI, **Save draft** does not create the tag. Only **Publish release** does.

Once the run finishes green, install in Foundry via *Add-on Modules → Install Module → Manifest URL*:

```
https://github.com/Dingus17/foundry-army-tracker/releases/latest/download/module.json
```

This path also gives you update notifications in Foundry when you tag future versions.

## Settings

All settings are world-scoped and GM-only. Simple values live in *Configure Settings → Army Tracker*:

| Setting | Default | Notes |
| --- | --- | --- |
| Days per week | 7 | Weekly salary calculation |
| Days per month | 30 | Monthly salary and loan cap |
| Days per year | 360 | Yearly salary calculation |
| Loan cap | 6 months | Of the member's *base* (pre-deduction) salary |
| Currency label | gp | Cosmetic; PF2e transfers still treat vault amounts as gold |

Anything that's a list sits behind the **Configure Army Tracker** button in that same panel (also reachable from the Army Structure tab):

- **Ranks & daily pay** — add, rename, reorder and delete ranks, each with its own default daily wage. The defaults are Soldier / Corporal / Sergeant / Lieutenant / Captain at 1 / 2 / 3 / 5 / 8, but nothing is fixed. Deleting a rank someone currently holds warns you first, and those members show as holding a removed rank rather than being silently re-banded.
- **Default deductions** — the lines each new recruit starts with (Food and Camp maintenance by default). Existing members are untouched when you change these.
- **Officers** — the include-officers toggle and the default title for each level.
- **Army generation** — how many hosts per army, companies per host, cohorts per company, squads per cohort and soldiers per squad, with a live projected total strength.

## Notes

- All data is stored in a world setting, so it lives with your world and is included in world backups.
- Granting a loan increases the member's debt; handing the actual coin to the character is left to the GM. To pay it out for real on PF2e, grant the loan and then use **Withdraw** for the same amount.
- The roster is GM-editable only, except for vault deposits and withdrawals, which players may perform for their own characters. The Army Structure tab is editable by everyone.
- Player actions are relayed through the GM's client, so a GM must be connected.
