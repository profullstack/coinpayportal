import { FinanceOwnerSwitcher } from './FinanceOwnerSwitcher';

export default function FinancesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FinanceOwnerSwitcher />
      {children}
    </>
  );
}
