// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import AdminNav from './AdminNav';
import { ADMIN_SECTIONS } from './admin-navigation';

let pathname = '/admin';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
afterEach(cleanup);

describe('shared admin navigation', () => {
  it('makes every admin page discoverable', () => {
    const pages: string[] = [];
    function visit(dir: string, route: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) visit(join(dir, entry.name), `${route}/${entry.name}`);
        else if (entry.name === 'page.tsx') pages.push(route);
      }
    }
    visit(join(process.cwd(), 'src/app/admin'), '/admin');
    expect(ADMIN_SECTIONS.map((section) => section.href).sort()).toEqual(pages.sort());
  });

  it.each(ADMIN_SECTIONS)('shows all sections and marks only $label current', ({ href }) => {
    pathname = href;
    render(<AdminNav />);
    const links = screen.getByRole('navigation', { name: 'Administration' }).querySelectorAll('a');
    expect(links).toHaveLength(8);
    expect([...links].filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('href'))).toEqual([href]);
    expect(screen.getByRole('link', { name: 'Operator vault' }).getAttribute('href')).toBe('/admin/operator-vault');
  });

  it('keeps a nested section active without matching a similar prefix', () => {
    pathname = '/admin/users/someone';
    const view = render(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Admin home' }).getAttribute('aria-current')).toBeNull();
    pathname = '/admin/users-other';
    view.rerender(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBeNull();
  });
});
