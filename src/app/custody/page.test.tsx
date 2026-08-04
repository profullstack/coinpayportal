/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const isMultisigEnabled = vi.fn();
vi.mock('@/lib/multisig', () => ({
  isMultisigEnabled: () => isMultisigEnabled(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import CustodyPage from './page';

/**
 * The custody page's entire purpose is to not overclaim. These tests exist so a
 * future change can't quietly reintroduce a promise the deployment can't keep —
 * particularly the 2-of-3 multisig escape hatch, which is behind a feature flag
 * that is off in production.
 */
describe('CustodyPage', () => {
  beforeEach(() => {
    isMultisigEnabled.mockReset();
  });

  describe('when multisig escrow is disabled (production today)', () => {
    beforeEach(() => {
      isMultisigEnabled.mockReturnValue(false);
      render(<CustodyPage />);
    });

    it('does not advertise multisig as an available choice', () => {
      expect(screen.queryByText(/create the escrow as/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/use multisig escrow for amounts where our continued existence/i),
      ).not.toBeInTheDocument();
    });

    it('says plainly that multisig is not currently available', () => {
      expect(screen.getByText(/Not currently enabled/i)).toBeInTheDocument();
      expect(screen.getByText(/The escape hatch is not currently open/i)).toBeInTheDocument();
    });

    it('states that no escrow can currently avoid CoinPay custody', () => {
      expect(
        screen.getByText(/no way to create an escrow that CoinPay cannot unilaterally move/i),
      ).toBeInTheDocument();
    });

    it('still discloses the unavoidable payment forwarding window', () => {
      expect(screen.getByText(/There is no mode where a customer pays your wallet directly/i))
        .toBeInTheDocument();
    });
  });

  describe('when multisig escrow is enabled', () => {
    beforeEach(() => {
      isMultisigEnabled.mockReturnValue(true);
      render(<CustodyPage />);
    });

    it('offers multisig as the way to avoid custodial escrow', () => {
      // Stated in both the custody table and the prose beneath it.
      expect(screen.getAllByText(/we hold one key of three/i).length).toBeGreaterThan(0);
    });

    it('does not claim the feature is unavailable', () => {
      expect(screen.queryByText(/The escape hatch is not currently open/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Not currently enabled/i)).not.toBeInTheDocument();
    });
  });

  describe('regardless of flags', () => {
    it.each([true, false])(
      'always discloses that CoinPay is the default dispute arbiter (multisig=%s)',
      (enabled) => {
        isMultisigEnabled.mockReturnValue(enabled);
        render(<CustodyPage />);
        expect(screen.getByText(/If you did not name one, CoinPay decides/i)).toBeInTheDocument();
        expect(screen.getByText(/There is no appeal/i)).toBeInTheDocument();
      },
    );

    it.each([true, false])(
      'never claims custodial balances are insured or recoverable (multisig=%s)',
      (enabled) => {
        isMultisigEnabled.mockReturnValue(enabled);
        const { container } = render(<CustodyPage />);
        expect(container.textContent).toMatch(/no deposit insurance/i);
        expect(container.textContent).not.toMatch(/funds are guaranteed/i);
      },
    );
  });
});
