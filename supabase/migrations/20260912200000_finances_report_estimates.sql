-- Reports may, on request, fill the leading gap an institution never
-- supplied with an extrapolation of the observed daily mean. Off by
-- default; the choice is recorded on the report so a reader knows which
-- figures are arithmetic and which are rows.
alter table public.finance_reports
  add column if not exists estimate_gaps boolean not null default false;

comment on column public.finance_reports.estimate_gaps is
  'When true, the dataset carries per-currency estimates for the days before the first observed posting, labelled as estimates. Observed totals are never changed.';
