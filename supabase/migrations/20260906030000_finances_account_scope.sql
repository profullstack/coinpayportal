-- Which side of the books an account belongs to.
--
-- One person's feed routinely carries both a company's accounts and their own,
-- and the two answer different questions: a debt-to-income ratio over the
-- personal side is a solvency read, the same ratio over both is noise. The
-- Debt & Income view therefore splits by scope, and until now it inferred that
-- split from the account name — "Business Checking (4672)" reads as business,
-- everything else falls to personal.
--
-- That guess is right often enough to be useful and wrong in exactly the case
-- that matters: an account whose name says nothing, or a personal card used
-- for company spend. So this is the same shape as `kind_override` — the guess
-- stays derived and unstored, the correction is stored separately, and a
-- re-sync re-deriving the guess cannot clobber it.
--
-- Deliberately two values and not a free-text tag. Scope decides which set of
-- books a balance lands in, and a third spelling of "business" would silently
-- create a third set.

alter table public.finance_accounts
  add column if not exists scope_override text
    check (scope_override in ('business', 'personal'));

comment on column public.finance_accounts.scope_override is
  'Operator correction for which side of the books this account belongs to: '
  'business, personal, or null to use the name-derived guess. Never written by '
  'a sync — see kind_override for the same pattern.';

-- Reads filter the whole account set by scope; a partial index keeps that cheap
-- without paying for the rows that carry no correction, which is most of them.
create index if not exists finance_accounts_scope_override_idx
  on public.finance_accounts (scope_override)
  where scope_override is not null;
