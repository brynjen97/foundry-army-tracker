# Army Tracker

A Foundry VTT module for running campaigns in a military setting. Track your party's ranks, daily wages and deductions, debts and camp-vault savings — then hit **Advance Day** to pay the troops. An army-wide war chest pays for it all, filled by plunder from battles and sacked cities and drained by wages and upkeep, with every movement written to a ledger you can read back. A structure tab maps your army from hosts down to individual squads, and players can fill in the characters they meet along the way.

Built for **Foundry VTT v14**, and written to keep working back to v12. System-agnostic, with optional **Pathfinder 2e** integration that moves real coin between character inventories and the vault.

The UI is built on ApplicationV2 and DialogV2 throughout, and the module avoids the bare globals that have been migrating into namespaces across recent versions — HTML escaping, document classes and template preloading all resolve the namespaced form first and degrade rather than throw if it isn't there.

## Features

### Pay & Roster

A dedicated, resizable window with a table of party members:

- **Rank** — dropdown of Soldier, Corporal, Sergeant, Lieutenant, Captain. Each rank has a default daily wage, configurable in the module settings.
- **Daily wage override** — leave blank to use the rank default (shown greyed out), or type a value to override it for that member.
- **Daily deductions** — expand a member's row to itemise daily costs (food, camp maintenance, etc.), each with its own label and amount. Two sensible defaults are pre-filled for new members.
- **Salary breakdown** — the expanded row shows net daily pay plus calculated weekly, monthly and yearly salaries (days per week/month/year are configurable).
- **Debt & loans** — track each member's debt. Loans are capped at six months of base salary by default (configurable). The GM can grant loans and repay debt from the vault with one click; a granted loan pays the coin into the character's inventory on PF2e.
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

With the war chest enabled, the same button also draws the day's wages and the army's upkeep out of it, and posts a second card — whispered to whoever is allowed to see the books — showing what it cost and what is left. The **undo** button beside Advance Day puts every balance back as it was, for when the fast-forward was meant to say 2 and said 200.

Bonuses come out of the war chest when one is being tracked.

### Requisition (Pathfinder 2e)

A third way to acquire gear, alongside being given it or buying it: **drag an item onto a member's row** in the roster and the army covers the cost. The item goes into the character's inventory and its price is added to their **debt** — their own coin is never touched.

Mechanically it's a loan spent at the point of purchase, so it's bound by the same six-month cap as a cash loan and is paid off the same way, out of daily wages. The confirmation dialog shows the unit price, the credit remaining, and a quantity capped to what that credit will cover. A requisition that would exceed the cap is refused outright, and the goods are handed over *before* the debt is recorded, so a failed delivery can never leave someone owing money for an item they didn't receive.

The army bought the goods, so the army's money is what paid for them: a requisition debits the war chest as well as recording the member's debt. Players can requisition for characters they own; the GM can for anyone. Every requisition posts a chat card showing the item, cost, resulting debt and remaining credit. Items with no price (feats, spells) can't be requisitioned; free items are delivered with no debt.

**Approval by the ranking member** (on by default, toggleable under *Configure Army Tracker → Requisition*): a player's requisition is held and a prompt is sent to whoever holds the most senior rank on the roster, showing who asked, for what, and at what cost. Nothing is delivered and no debt is recorded until they approve.

Seniority follows the **rank order in the config** — the last rank in the list is the most senior — so dragging ranks up and down also rearranges the chain of command. The config panel names whoever currently holds sign-off. Where members have been posted to units, sign-off follows the tree instead; see *Chain of Command* below.

Three cases skip the prompt: the GM's own requisitions, a requisition by the ranking member themselves, and the toggle being off. If the ranking member's player is offline, the GM is asked in their place.

Approval is decided on the GM's client, so it can't be skipped by a player editing their own; only the user actually asked can answer, and a decision can't be replayed.

### Bonuses

The **Bonus** button (GM only) pays every member of the roster at once, straight into their camp vaults. Three options:

- **Flat amount** — the same figure for everyone.
- **One week's pay** and **one month's pay** — vary per member with their rank and any wage override.

Week and month bonuses use each member's **base wage before deductions**, so daily living costs don't eat into the reward, and a member whose deductions exceed their wage still receives something instead of a negative "bonus". The dialog previews exactly what every member would get under both options, with totals, before you commit. Optionally tick **pay down debt first** to clear outstanding debt before banking the remainder. Each bonus posts a summary card to chat.

### The War Chest

The roster tracks what the party earns. The **War Chest** tab tracks what the *army* has — and it is the tab that makes the rest of the numbers mean something, because now the money has to come from somewhere.

**What drains it.** Every Advance Day the chest pays the roster's wages and the army's upkeep. Upkeep is worked out from the army structure itself: a squad with nobody named in it still musters — and still eats — at its configured size, so a freshly generated 720-strong host costs what 720 soldiers cost. Loans and requisitions come out of the chest too, and debt repaid goes back into it.

What actually *leaves* the chest on payday is whatever reaches the members' vaults. A wage that cancels an existing debt is money the army hands over and takes straight back, so only the remainder ever moves; a member whose deductions exceed their wage is paying the army, and the sum goes the other way.

**What fills it.** The **Record plunder** button. Pick what you fought — skirmish, raid, pitched battle, siege, or the sacking of a settlement — give the level of the enemy or the town, and it works out a figure. The arithmetic is shown, the result drops into an editable field, and a GM who already knows the number just types it in and ignores the rest.

The figures are anchored to Pathfinder 2e's **Party Treasure by Level**, used as a yardstick for how much wealth is in play at a given level rather than as a budget to hand out. A pitched battle is worth one such yardstick, a skirmish a quarter of it, a siege three. Sacking a settlement scales by size instead — following PF2e's settlement statistics, a village is level 0–1, a town 2–4, a city 5–9, a metropolis 10+ — because a metropolis and a village can both be dangerous but only one of them has warehouses. Every result varies by ±25% unless you turn that off, so two identical battles do not pay identically.

This layer deliberately does **not** track items. At the scale of an army, plunder is a number in the war chest; the interesting individual pieces are still loot you hand out the usual way.

**Shares of plunder.** The **Share out** button splits a slice of the chest among the roster, either evenly or weighted by rank — which here means by base daily wage, so a captain on 8 gp draws eight times a soldier on 1 gp. Tick *pay down debts first* and a member's share clears what they owe before the rest reaches their vault; that part never leaves the coffers, because the army was owed it anyway. The shares always add back up to exactly the pot.

**Upkeep rates.** The defaults are **0.2 gp per soldier per day** and **0.5 gp per officer**. Those come from PF2e's cost of living — subsistence at 4 sp a day, comfortable at 1 gp — halved, on the grounds that a state-backed army buys grain by the wagon, requisitions at fixed rates and quarters its troops in tents it already owns. Both rates are editable under *Configure Army Tracker → War chest*.

The chest is allowed to go **negative**. An army in arrears is a campaign problem worth playing out, not an error to refuse, so it says so in red and carries on.

**Who can see it.** Three modes, set by the GM: nobody but the GM, anyone holding a chosen rank or above, or the whole table. On top of that every roster member has an override on their Finances panel — an eye icon cycling between *follows the rule*, *always allowed* and *never allowed* — so the quartermaster can be let into the books without a promotion and the disgraced captain shut out without a demotion. A denial always beats a grant. Army finance chat cards are whispered to exactly that audience, so hiding the chest behind a rank is not undone by the next payday announcing it to the room.

This is a curtain, not a vault: the data lives in a world setting and a determined player can read it from the console. It keeps the numbers out of sight at the table; it is not a defence against your own players.

### The Ledger

Every figure in the tracker is the *result* of something, and by the time anyone asks "why does Aldric owe 47 gp?" the chat card that would have answered has long since scrolled away. The **Ledger** tab keeps the answer.

Paydays, upkeep, loans, repayments, requisitions, vault deposits and withdrawals, bonuses, plunder and shares all write a line as they happen — in the same save as the change itself, so a failed write never leaves a record of something that did not happen. Each line carries the in-world day, who it concerned, the amount, and the balance it left behind. Filter by entry type or by member; the oldest lines fall off once the ledger reaches its configured size (500 by default) so the saved world data does not grow without bound.

Army-scope lines follow the same visibility rule as the war chest. A member's own lines are always their own business.

### Chain of Command

Roster members can be **posted to a unit** from the Finances panel on their row. Once they are, requisition sign-off follows the actual chain of command: the search starts in the member's own unit and climbs — squad, cohort, company, host, army — returning the first person it meets who outranks them. A sergeant in 3rd Squad answers to her own captain, not to whichever captain happens to sort first. Unit headers name the party members serving in them, and anyone unassigned falls back to the ranking member of the roster as before.

### Sharing & Notes

By default the tracker's data lives in a world setting, and Foundry only lets a GM write those — so every player edit is relayed to a connected GM's client, and nothing saves at all when none is online. That is the right shape for a game being run, and the wrong shape for a shared notebook the table fills in between sessions.

**Let players save changes without a GM online** (*Configure Army Tracker → Players & sharing*, off by default) fixes that. The data moves into a JournalEntry that every player owns, so they write it directly — no GM connected, no relay, no waiting.

With it on, players can:

- edit the **army structure** as before — units, officers, squad rosters, notes;
- **add people to the roster**, name them, write free-text **notes** on them, and post them to a unit.

They still cannot touch anything the economy depends on: rank, wages, deductions, debt, vaults, the war chest, the ledger and the day count all stay with the GM. A roster entry can be deleted only while no money is attached to it, so a mistyped note can be tidied away but an account cannot be wiped — entries holding money show a padlock instead of a bin.

Each roster row gains a **Notes** panel in its expanded view: a name field (for entries with no linked actor — a linked character supplies its own name) and a free-text box for whatever the table wants to remember about them.

The journal entry is named **"Army Tracker — shared data"** and is created the first time a GM logs in after the toggle is switched on. Leave it where it is. Turning the toggle back off copies everything the table wrote back into the world setting and leaves the journal in place, so nothing is stranded and nothing is destroyed — switching back and forth is safe.

Two caveats worth knowing:

- Like the finance curtain, this governs what the module will do when asked. A player determined to drive Foundry's document API from the console is not stopped by it.
- Direct writes are no longer serialised through one GM client, so two people editing the same unit in the same second can have one edit overwrite the other. In practice this is a notebook being filled in, not a contended database.

### Army Structure

A collapsible hierarchy — **Army → Host → Company → Cohort → Squad** — that anyone at the table can edit:

- The army carries a **level**, shown on its header. On **Pathfinder 2e** a shop icon sits beside it and opens the system's compendium browser on the equipment tab, filtered to **common items at or below that level** — a quick way to see what the army could plausibly source. The icon only appears on PF2e; the level field itself is available on any system.
- A **search box** filters the tree by unit name (`5th Company`) or by an officer's name *or* title (`Aldric`, or `Helm` to find every host commander at once). Matches are highlighted, the path down to each one is kept and opened automatically — otherwise the search would hide its own results — and everything else is pruned. A unit that matched keeps its whole subtree, since having searched for it you probably want to see inside. The box shows a match count and clears with one click.
- Units start **collapsed** — only the army itself opens by default, so a generated army of several hundred soldiers fits on one screen instead of unrolling into a wall of units. **Expand all** / **Collapse all** buttons sit above the tree, and opening a unit remembers itself while the window stays open.
- Name each unit and add sub-units with the **+** button on its header. Adding one opens both it and its parent, so what you just created is visible.
- Squads hold a roster of named characters with a rank/role and free-text notes, so players can record the NPCs they serve alongside.
- The **Army** sits at the root of the tree and carries a free-text notes field for campaign notes and standing orders.
- Collapsed units show a summary count, keeping big armies readable.

**Officers** (on by default, toggleable): every unit gets an officer slot, and you can add as many more as a unit needs. The first officer in a unit's list commands it, and is shown on the unit's header — so a collapsed army still reads as *1st Host — Helm Aldric*. A freshly generated army has titled but unnamed officers, which show greyed as *Helm (unnamed)* until you fill them in. Default titles per level — General for the army, Helm for a host, Captain for a company, Lieutenant for a cohort, Sergeant for a squad — are all editable, and any individual officer can be retitled afterwards.

**Strength** rolls up the tree. A squad counts the soldiers actually named in it, or falls back to the configured squad size when none have been recorded — so every cohort, company, host and the army itself shows a running headcount even before you name a single soldier. Officers are counted separately rather than padding the figure.

**Generate Army** builds the whole hierarchy in one click from the configured counts, naming units by position (1st Squad, 2nd Squad, …). It keeps the army's own name and notes and replaces the structure beneath.

Player edits are relayed through the GM's client, so a GM must be connected for changes to save — or turn on *let players save changes without a GM online* and they will not need one.

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
| Ledger entries kept | 500 | Older lines are dropped once the ledger reaches this size |

Anything that's a list sits behind the **Configure Army Tracker** button in that same panel (also reachable from the Army Structure tab):

- **Ranks & daily pay** — add, rename, reorder and delete ranks, each with its own default daily wage. The defaults are Soldier / Corporal / Sergeant / Lieutenant / Captain at 1 / 2 / 3 / 5 / 8, but nothing is fixed. Deleting a rank someone currently holds warns you first, and those members show as holding a removed rank rather than being silently re-banded.
- **Default deductions** — the lines each new recruit starts with (Food and Camp maintenance by default). Existing members are untouched when you change these.
- **Officers** — the include-officers toggle and the default title for each level.
- **Players & sharing** — whether players can save changes with no GM connected, which also lets them keep the roster as a notebook. See **Sharing & Notes** above.
- **War chest** — whether the army treasury is tracked at all, whether Advance Day draws wages and upkeep from it, the per-soldier and per-officer upkeep rates (with the PF2e cost-of-living figures they came from spelled out), and who besides the GM may see the books.
- **Army generation** — how many hosts per army, companies per host, cohorts per company, squads per cohort and soldiers per squad, with a live projected total strength.

## Notes

- All data is stored in a world setting, so it lives with your world and is included in world backups.
- Granting a loan pays the coin straight into the character's inventory on PF2e and records the debt against the member. The coin is handed over *before* the debt is written, so a failed payout never leaves someone owing money they never received. Without a linked PF2e inventory the dialog says so up front and the loan only records the debt — hand over the coin on the sheet yourself.
- The roster is GM-editable only, except for vault deposits and withdrawals, which players may perform for their own characters. The Army Structure tab is editable by everyone.
- Player actions are relayed through the GM's client, so a GM must be connected — unless *let players save changes without a GM online* is enabled, in which case they save their own work directly. See **Sharing & Notes**.
- The war chest starts empty. Before the first Advance Day, either seed it with **Set balance** or turn *draw wages and upkeep from the war chest* off in the config — otherwise the army goes into arrears immediately, which is accurate but probably not what you meant.
- Undo keeps a single step. It covers the realistic mistake — a mistyped fast-forward, a bonus at the wrong rate — rather than pretending to be a history you can walk backwards through.
