import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReputationDocs } from '../ReputationDocs';

describe('ReputationDocs', () => {
  it('should render the section title', () => {
    render(<ReputationDocs />);
    expect(screen.getByText('Reputation & DID')).toBeInTheDocument();
  });

  it('should render all API endpoint paths', () => {
    render(<ReputationDocs />);
    expect(screen.getByText('/api/reputation/receipt')).toBeInTheDocument();
    expect(screen.getByText('/api/reputation/agent/[did]/reputation')).toBeInTheDocument();
    expect(screen.getByText('/api/reputation/credential/[id]')).toBeInTheDocument();
    expect(screen.getByText('/api/reputation/verify')).toBeInTheDocument();
    expect(screen.getByText('/api/reputation/revocation-list')).toBeInTheDocument();
    expect(screen.getByText('/api/reputation/did/claim')).toBeInTheDocument();
    expect(screen.getByText('/api/reputation/did/me')).toBeInTheDocument();
  });

  it('should render DID Management heading', () => {
    render(<ReputationDocs />);
    expect(screen.getByText('DID Management')).toBeInTheDocument();
  });

  it('should render Verifiable Credentials heading', () => {
    render(<ReputationDocs />);
    expect(screen.getByText('Verifiable Credentials')).toBeInTheDocument();
  });

  it('should render the how-it-works explanation', () => {
    render(<ReputationDocs />);
    expect(screen.getByText('How Reputation Works')).toBeInTheDocument();
  });
});
