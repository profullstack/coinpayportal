/**
 * Where a person downloads each institution's statements by hand, and the
 * clicks to get there. Keys match the statement fetcher's institution keys
 * (`institutionKey` in the SDK). `direct` means the link lands on the
 * statements page itself once signed in; otherwise it is the sign-in page.
 *
 * Gathered from each institution's own help pages on 2026-10-09; menus move,
 * so the steps name the section rather than every click.
 */
/**
 * One short key per institution: the name its site goes by. secure.chase.com
 * and chase.com are both `chase`. The CLI computes the same key, so a run
 * and an account meet on it.
 */
export function institutionKey(domain: string | null | undefined, name: string | null | undefined): string {
  const host = (domain ?? '').replace(/^https?:\/\//, '').split(/[/:]/)[0]!.toLowerCase();
  // Same explicit list as the CLI's HOST_KEYS: webapp.ftb.ca.gov is "ftb", not "ca".
  if (/(^|\.)ftb\.ca\.gov$/.test(host)) return 'ftb';
  if (/(^|\.)irs\.gov$/.test(host)) return 'irs';
  const labels = host.split('.').filter(Boolean);
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'bank';
  if (labels.length >= 2) {
    const second = labels[labels.length - 2]!;
    return slug(labels.length >= 3 && /^(co|com|org|net|gov|ac)$/.test(second) ? labels[labels.length - 3]! : second);
  }
  return slug(name ?? host ?? 'bank');
}

export type StatementPage = { url: string | null; direct: boolean; steps: string };

const PAGES: Record<string, StatementPage> = {
  alliantcreditunion: {
    url: 'https://www.alliantcreditunion.com/OnlineBanking/Login.aspx',
    direct: false,
    steps: 'Sign in, open My Profile & Settings > Statements (or the Statements button beside an account), open the statement and download the PDF. eStatements must be turned on in the same place. Only the last 18 months are online; tax forms are under Tax Statements.',
  },
  americanexpress: {
    url: 'https://global.americanexpress.com/activity/statements',
    direct: true,
    steps: 'Sign in; the link opens Statements & Activity. Pick the billing period and download the PDF statement. Recent statements download directly; older ones may have to be requested.',
  },
  apple: {
    url: 'https://card.apple.com/',
    direct: false,
    steps: 'Sign in with your Apple Account, click Statements in the sidebar, then the download button beside the month (PDF). On iPhone: Wallet > Apple Card > Card Balance > the month > Download PDF Statement.',
  },
  bayfedonline: {
    url: 'https://www.bayfedonline.com/dbank/live/app/login/consumer',
    direct: false,
    steps: 'Sign in to BayFedOnline, open Additional Services > Statements and Documents, and pick the statement date on the left to open the PDF. Only accounts enrolled in eStatements see statements; business accounts use their own login.',
  },
  capitalone: {
    url: 'https://verified.capitalone.com/auth/signin',
    direct: false,
    steps: 'Sign in, select the account, choose View Statements, pick the period and click Download (PDF). Paperless must be on (Account Services & Settings > Paperless). Up to 7 years for open accounts.',
  },
  chase: {
    url: 'https://secure.chase.com/web/auth/dashboard#/dashboard/documents/myDocs/index;mode=documents',
    direct: true,
    steps: 'Sign in; the link opens Statements & documents (also Main Menu > Statements & documents). Choose the account and year, then the download icon beside each statement. Tax forms are in the same place.',
  },
  citi: {
    url: 'https://www.citi.com/',
    direct: false,
    steps: 'Sign in, select the account, click Statements, pick the statement and click Download (PDF). The last 12 months download at once; older ones go back about 7 years and may need an Older Statements request (48-72 hours).',
  },
  dcu: {
    url: 'https://app.dcu.org/login',
    direct: false,
    steps: 'Sign in to DCU Digital Banking, open View Statements and Tax Forms, choose the account and month, and download the PDF. 1098 and 1099-INT forms are in the same section. Some accounts get quarterly statements.',
  },
  etrade: {
    url: 'https://us.etrade.com/etx/pxy/accountdocs',
    direct: true,
    steps: 'Sign in; the link opens Accounts > Documents. On the Statements tab choose the account and date range, then the PDF icon. 1099s are on the Tax Documents tab.',
  },
  itrustcapital: {
    url: 'https://app.itrustcapital.com/',
    direct: false,
    steps: 'Sign in, open Documents Center > Statements & Taxes > Monthly Statements, pick the IRA and the month to download the PDF. Missing older statements are requested through a support ticket.',
  },
  sofi: {
    url: 'https://www.sofi.com/login/',
    direct: false,
    steps: 'Sign in. Checking and Savings: click Statements on the Banking home and download by month (posted in the first 5 business days). Invest: More > Statements and tax forms; only the last 2 years are online.',
  },
  stash: {
    url: 'https://app.stash.com/log-in',
    direct: false,
    steps: 'Sign in, click your name (top right) > Statements and tax documents. Use Account statements for the portfolio or Bank Account Statements for banking, and click Download beside the month. No statement is made for a month with no activity.',
  },
  troweprice: {
    url: 'https://www.troweprice.com/usis/login',
    direct: false,
    steps: 'Sign in and open Statements and Documents, then open or save the statement PDF. Brokerage accounts are monthly, most others quarterly; up to 7 years online. Tax forms are in the same section.',
  },
  techcu: {
    url: 'https://digital.techcu.com/Authentication',
    direct: false,
    steps: 'Sign in to Online Banking and open the Documents tab to download eStatement PDFs (choose Request eStatements there first if not enrolled). Credit card statements are not included there.',
  },
  towerfcu: {
    url: 'https://myaccounts.towerfcu.org/Authentication/Username',
    direct: false,
    steps: 'Sign in to Online Banking, go to Account Services > eStatements, then enroll or open the statement PDF. Home loan and tax statements are in the same section.',
  },
  webull: {
    url: 'https://www.webull.com/edocs',
    direct: true,
    steps: 'Sign in on the E-Docs page, open E-Documents, pick Account Statements (monthly) or Trade Confirmations and download the PDF. Tax forms are on the same site; crypto has no monthly statements.',
  },
  ftb: {
    url: 'https://webapp.ftb.ca.gov/MyFTBAccess/Login/Index',
    direct: false,
    steps: 'Sign in to MyFTB and open your notices / correspondence list; click a notice to view or download its PDF. A new account needs the PIN mailed to you before it works.',
  },
  irs: {
    url: 'https://sa.www4.irs.gov/ola/',
    direct: false,
    steps: 'Sign in with ID.me. Notices and letters holds the digital notices (only some types, about 18 months). Tax records holds transcripts: pick the type and year and download the PDF.',
  },
  'irs-business': {
    url: 'https://sa.www4.irs.gov/bola/',
    direct: false,
    steps: 'Sign in with ID.me (needs an EIN). Notices holds the digital notices; Tax records holds business transcripts (940/941/1065/1120 by entity) to download as PDF.',
  },
};

/** Keys a bank arrives under when SimpleFIN gives no domain, so the key is its name. */
const ALIASES: Record<string, string> = {
  'digital-federal-credit-union': 'dcu',
  'alliant-credit-union': 'alliantcreditunion',
  'bay-federal-credit-union': 'bayfedonline',
  'technology-credit-union': 'techcu',
  'tower-federal-credit-union': 'towerfcu',
  'american-express': 'americanexpress',
};

/** The statements page for a linked bank, falling back to the site SimpleFIN names. */
export function statementPage(bank: { key: string; url?: string | null }): StatementPage & { label: string } {
  const known = PAGES[bank.key] ?? PAGES[ALIASES[bank.key] ?? ''];
  const page = known ?? {
    url: bank.url && /^https:\/\//.test(bank.url) ? bank.url : null,
    direct: false,
    steps: 'Sign in on the bank\'s site and look for Statements, Documents or eStatements (often under the account or a profile menu). Turn on eStatements if no statements are listed, then download the PDF for each month.',
  };
  return { ...page, label: page.direct ? 'Statements' : 'Sign in' };
}
