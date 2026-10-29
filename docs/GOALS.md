# Finance goals

Save for a house or a car, build an emergency fund, or pay off a debt, by a deadline.
Page: `/finances/goals`. Not financial advice; nothing here moves money.

## How progress is computed

| Goal | Linked | Progress |
| --- | --- | --- |
| save (house, car, emergency_fund, custom) | accounts and/or web wallets | linked balances now + contributions |
| save | nothing | `startingAmount` (already saved) + contributions |
| payoff (debt_payoff) | debt accounts (cards, loans) | `startingAmount` (debt at the start) - owed now + contributions |
| payoff | nothing | contributions (payments recorded by hand) |

- Linked accounts are finance accounts from SimpleFIN/Plaid; history comes from
  `finance_balance_snapshots`, so period reports use the balance at the period's start.
  Before the first snapshot the earliest known balance stands in and the line says so.
- Web wallets (`wallet_account_links`) count at their cached balances priced in USD, only on USD goals,
  with no history (their period change is 0 unless a contribution is recorded).
- Accounts in a currency other than the goal's are ignored.
- A card or loan linked to a save goal counts against it (net worth), never as money held.
- Every goal carries `sources`: one line per linked account (signed amount, institution, kind,
  `asOf`, `stale` when the balance is over 7 days old), the wallets, the starting point and recorded
  contributions. The counted amounts add up to `snapshot.progress`. The page shows it under
  "Show what makes up ..."; the report text and email list it under "Made of:".
- Only the ticked accounts count. Edit a goal to change them ("Check all" / "None" in the picker).
- `start_progress` is the progress at creation; "on track" compares progress with a straight line
  from it on the start date to the target on the deadline (half a percent of the target is noise).
- Status: `achieved`, `on_track`, `behind`, `overdue` (deadline passed, target not reached).

## Reports

`GET /api/finances/goals/report?period=daily|weekly|monthly|quarterly[&format=json|text|html]`:
trailing 1 day, 7 days, 1 month, 3 months. Per goal: change in the period, what the period needed
at the pace that lands the goal on time (from where it stood at the period's start), pace
(`ahead`, `on_pace`, `short`, `done`), and the overall snapshot (required per day/week/month/quarter,
the last 90 days' pace and where it lands).

The email is the opt-in `goals_digest` schedule kind in `finance_email_schedules`, with
`cadence` daily (every day), weekly (on `weekdays[0]`, Monday by default), monthly (the 1st) or
quarterly (Jan/Apr/Jul/Oct 1st), at `hour` in the schedule's timezone. One-click unsubscribe.

## API

- `GET/POST /api/finances/goals[?archived=1]`, `GET/PATCH/DELETE /api/finances/goals/{id}`.
  PATCH takes any create field plus `archived: true|false`. Archived goals are hidden unless
  `?archived=1` and are left out of the report and the email. Changing links, kind, start or target
  re-reads `startProgress` from the new set (pass `startProgress` to set it yourself).
- `GET/POST /api/finances/goals/{id}/contributions`, `DELETE .../contributions/{contributionId}`
- `GET /api/finances/goals/sources` (linkable accounts and wallets)
- `GET /api/finances/goals/report`
- `POST /api/finances/email-schedules {kind:"goals_digest", cadence}`, `DELETE ?kind=goals_digest`,
  `POST /api/finances/email-schedules/send-now?kind=goals_digest`

CLI: `coinpay finances goals ...` (SDK 0.28.0: `edit`, `archive`, `unarchive`, `show` prints the
breakdown). MCP: `finance_goals`, `finance_goal_create`, `finance_goal_update`, `finance_goal_delete`,
`finance_goal_contribute`, `finance_goals_report`, `finance_goals_digest`.
Migration: `supabase/migrations/20261028200000_finance_goals.sql`.
