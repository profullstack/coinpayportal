// Content for the CoinPayPortal founder's field guide (rebuilt edition).
//
// Educational, vendor-authored and AI-assisted. Nothing here is legal, tax,
// accounting or investment advice. Topics, dollar figures and city procedures
// change; every reader is told, repeatedly, to confirm specifics with the
// relevant authority or a licensed professional before acting.

export const META = {
  title: 'The Online S-Corp Field Guide',
  subtitle: 'Los Gatos & surrounding cities',
  edition: 'Complimentary PDF edition',
  publisher: 'Profullstack, Inc. — the team behind CoinPayPortal',
  contactEmail: 'support@coinpayportal.com',
  contactPhone: '(888) 526-4640',
  contactUrl: 'https://coinpayportal.com/contact',
};

// A short, plain-language callout inviting an optional regional setup call.
// Placed at a few points through the book (the spec asks for setup callouts).
export const REGIONAL_CALLOUT = {
  heading: 'Outside Santa Clara County, or want a hand?',
  body:
    'This guide is written around Los Gatos and its neighboring cities, but the ' +
    'shape of the work is the same anywhere. If you would like a regional setup ' +
    'call to walk through your own city and county, reach the team through the ' +
    'official contact page. No consultation price, CPA service, attorney service ' +
    'or guaranteed availability is implied.',
};

export const DISCLAIMER_PARAS = [
  'This is a vendor-authored, AI-assisted educational guide. It is not independent ' +
    'product review, and it is not individualized legal, tax, accounting, or ' +
    'investment advice. Reading it does not create any professional relationship.',
  'Laws, tax rules, filing thresholds, fees and city procedures change and vary by ' +
    'situation. Every figure and procedure here is general and may be out of date by ' +
    'the time you read it. Confirm the current rules with the relevant agency, and ' +
    'confirm how they apply to you with a licensed attorney, CPA or enrolled agent ' +
    'before you act.',
  'CoinPayPortal, Mercury and moomoo are separate companies that perform different ' +
    'roles. Mentions of Mercury and moomoo are editorial preferences, not a universal ' +
    'ranking, an endorsement, a sponsorship, or a promise of any integration. Prices ' +
    'and ebook examples that appear in CoinPayPortal materials are examples, not a ' +
    'checkout price or a claimed former price for this complimentary guide.',
  'Dollar amounts are illustrative round numbers chosen to explain a mechanic, not ' +
    'quotes. Do not put sensitive information into a form or document because a guide ' +
    'told you to; think about what you share and with whom.',
];

export const HOW_TO_USE = {
  title: 'How to use this guide',
  forHumans: [
    'Read Part I before you file anything. The order of operations matters: a few ' +
      'choices made at formation are tedious to unwind later.',
    'Parts II and III are reference. Skim the chapter headings, then read the one ' +
      'you need the week you need it. Each chapter ends with a short checklist.',
    'The worksheets at the back are the point. Reading about reasonable ' +
      'compensation is not the same as writing your number down and keeping the ' +
      'reasoning. Fill them in and keep them with your records.',
  ],
  forAgents: [
    'If you are an automated agent operating a business on an owner\'s behalf, treat ' +
      'every number and date in this guide as a value to verify against a primary ' +
      'source, never as a constant to hard-code.',
    'Surface the dated cost comparisons as "as-of" figures and re-check them before ' +
      'relying on them. Do not represent editorial tool preferences as rankings.',
    'Escalate anything irreversible — an entity election, a tax filing, a payroll ' +
      'run — to the human owner for explicit approval. The owner authorizes; you ' +
      'prepare.',
  ],
};

// 14 chapters, grouped into three parts. Each chapter: title, intro, sections
// [{ h, p: [..] }], and a short checklist [..].
export const PARTS = [
  {
    part: 'Part I',
    name: 'Standing up the entity',
    chapters: [
      {
        title: 'What an "online S-corp" actually is',
        intro:
          'An S-corp is not a kind of company you form. It is a tax election you ask ' +
          'the IRS to apply to a company you have already formed — usually an LLC or a ' +
          'corporation. Getting that distinction right saves a lot of confused paperwork.',
        sections: [
          {
            h: 'Entity versus election',
            p: [
              'You first create a legal entity at the state level: in California, most ' +
                'small online businesses form an LLC with the Secretary of State. That ' +
                'entity exists whether or not it is ever taxed as an S-corp.',
              'Separately, you can file an election (IRS Form 2553) asking that the ' +
                'entity be taxed under Subchapter S. The company does not change its ' +
                'name, its bank account or its contracts. Only the way its profit is ' +
                'taxed changes.',
              'This is why people say "my LLC is taxed as an S-corp." Both things are ' +
                'true at once: an LLC for liability and state law, an S-corp for ' +
                'federal tax treatment.',
            ],
          },
          {
            h: 'Why anyone bothers',
            p: [
              'The usual reason is self-employment tax. A sole proprietor or a default ' +
                'LLC generally pays self-employment tax on all of the business profit. ' +
                'An S-corp splits the owner\'s take into a reasonable salary (which is ' +
                'subject to payroll taxes) and a distribution (which is not subject to ' +
                'self-employment tax).',
              'That split can lower the total tax bill once profit is high enough to ' +
                'justify the extra payroll, bookkeeping and filing work. Below that ' +
                'point the overhead can cost more than it saves. Chapter 6 walks ' +
                'through where that line tends to fall and why it is personal.',
            ],
          },
          {
            h: 'The costs you are signing up for',
            p: [
              'An S-corp means running payroll for yourself, filing a separate ' +
                'business return (Form 1120-S) with K-1s, keeping cleaner books, and ' +
                'in California paying the annual franchise tax plus the 1.5% S-corp ' +
                'tax on net income. None of this is hard, but it is real recurring ' +
                'work. Decide with eyes open.',
            ],
          },
        ],
        checklist: [
          'Understand that "form an LLC" and "elect S-corp" are two separate steps.',
          'Write down the single reason you want the election. If it is not tax ' +
            'savings large enough to beat the overhead, revisit.',
          'Confirm the current California franchise tax and 1.5% S-corp tax figures ' +
            'with the Franchise Tax Board before you model anything.',
        ],
      },
      {
        title: 'Forming the entity in California',
        intro:
          'The mechanical steps of getting a California LLC on its feet, in the order ' +
          'that avoids rework.',
        sections: [
          {
            h: 'Name, agent, and the filing',
            p: [
              'Pick a name that is available with the Secretary of State and whose ' +
                'domain and handles you can actually get. Appoint a registered agent ' +
                'for service of process — you can be your own, but a service keeps your ' +
                'home address off the public record.',
              'File the Articles of Organization (Form LLC-1) with the Secretary of ' +
                'State. Within 90 days file the initial Statement of Information ' +
                '(LLC-12), and then every two years after that.',
            ],
          },
          {
            h: 'EIN and the operating agreement',
            p: [
              'Get an EIN from the IRS directly — it is free and takes minutes online. ' +
                'Never pay a third party for an EIN.',
              'Write an operating agreement even if you are the only member. It is what ' +
                'separates you from the company in the eyes of a court and a bank, and ' +
                'banks increasingly ask to see it.',
            ],
          },
          {
            h: 'The S-corp election timing',
            p: [
              'Form 2553 has deadlines tied to the start of the tax year you want the ' +
                'election to take effect. Miss the window and you may wait a year or ' +
                'rely on late-election relief. If the election is your plan, calendar ' +
                'the deadline the day you form the entity.',
            ],
          },
        ],
        checklist: [
          'Articles of Organization filed; registered agent named.',
          'EIN obtained directly from the IRS at no cost.',
          'Operating agreement signed and stored with your records.',
          'Statement of Information deadline (90 days, then biennial) calendared.',
          'Form 2553 deadline calendared if electing S-corp.',
        ],
      },
      {
        title: 'Local approvals in Los Gatos and nearby cities',
        intro:
          'State formation is only half of it. The city you operate in almost always ' +
          'wants its own registration, and a home-based online business is not exempt ' +
          'just because there is no storefront.',
        sections: [
          {
            h: 'The city business license',
            p: [
              'Most Santa Clara County cities — Los Gatos, Campbell, Saratoga, San ' +
                'Jose, Cupertino and their neighbors — require a business license or ' +
                'business tax certificate, including for home-based and online-only ' +
                'businesses. The office that handles it is usually the city\'s finance ' +
                'department.',
              'Fees and renewal cycles differ by city and are often tied to gross ' +
                'receipts or employee count. Treat any number you hear secondhand as a ' +
                'starting point and confirm it on your own city\'s website.',
            ],
          },
          {
            h: 'Home occupation and zoning',
            p: [
              'Running the business from home commonly triggers a home occupation ' +
                'permit or at least a set of home occupation rules: no signage, limited ' +
                'client visits, no employees reporting to the house. These rules are ' +
                'city-specific. Read yours before you assume an online business is ' +
                'invisible to zoning.',
            ],
          },
          {
            h: 'Seller\'s permit and district tax',
            p: [
              'If you sell physical goods, California generally requires a seller\'s ' +
                'permit from the CDTFA and collection of sales tax, including ' +
                'district taxes that vary by locale. Purely digital or service ' +
                'businesses may not need one — but "may not" is a question for the ' +
                'CDTFA and your accountant, not a guess.',
            ],
          },
        ],
        checklist: [
          'Confirm your city\'s business license requirement and fee with its finance ' +
            'department.',
          'Check whether a home occupation permit applies to you.',
          'Determine with the CDTFA whether you need a seller\'s permit.',
          'Calendar every renewal date the moment you register.',
        ],
      },
      {
        title: 'Licenses, insurance, and the paper trail',
        intro:
          'The unglamorous records that make the difference between a clean year and a ' +
          'painful one.',
        sections: [
          {
            h: 'Insurance worth pricing',
            p: [
              'General liability and professional liability (errors and omissions) are ' +
                'the two most online founders actually use. If you hold client data, ' +
                'price cyber coverage too. Insurance is not a legal filing, but it is ' +
                'part of keeping the liability shield meaningful.',
            ],
          },
          {
            h: 'Keeping the corporate veil',
            p: [
              'The protection an entity offers depends on treating it as separate from ' +
                'you: its own bank account, no mixing of personal and business ' +
                'spending, contracts signed in the company\'s name, and basic records ' +
                'kept. Commingling funds is the fastest way to lose the protection you ' +
                'paid to set up.',
            ],
          },
        ],
        checklist: [
          'Price general and professional liability coverage.',
          'Open a dedicated business bank account before the first transaction.',
          'Sign contracts in the company name, not your own.',
          'Keep formation documents, licenses and renewals in one place.',
        ],
      },
    ],
  },
  {
    part: 'Part II',
    name: 'Money, pay, and books',
    chapters: [
      {
        title: 'Business banking for an online company',
        intro:
          'What to look for in a bank when there is no branch visit and money moves in ' +
          'and out online all day.',
        sections: [
          {
            h: 'What actually matters',
            p: [
              'For an online S-corp the useful features are clean sub-accounts or ' +
                '"envelopes" for taxes and payroll, real API or export access for ' +
                'bookkeeping, fast ACH and wires, and no surprise minimums. Physical ' +
                'branch coverage usually does not.',
              'We use Mercury for our own companies because its sub-accounts and ' +
                'export story fit this pattern well. That is an editorial preference, ' +
                'not a ranking or a sponsorship, and your needs may point elsewhere. ' +
                'Price at least two options before committing.',
            ],
          },
          {
            h: 'Set up the envelopes on day one',
            p: [
              'The single most useful habit: the day the account opens, create a ' +
                'separate holding account for taxes and move a fixed percentage of ' +
                'every deposit into it immediately. Money you never see in the ' +
                'spending balance is money you do not accidentally spend before the ' +
                'quarterly estimate is due.',
            ],
          },
        ],
        checklist: [
          'Open a dedicated business account (never route business money through a ' +
            'personal account).',
          'Compare at least two banks on sub-accounts, export/API, and fees.',
          'Create a tax-holding sub-account and fund it from every deposit.',
        ],
      },
      {
        title: 'Reasonable compensation and owner pay',
        intro:
          'The number at the center of every S-corp: the salary you pay yourself. Set ' +
          'it too low to dodge payroll tax and you invite trouble; set it with ' +
          'reasoning you can defend and you are fine.',
        sections: [
          {
            h: 'Why the number is scrutinized',
            p: [
              'The S-corp saving comes from taking part of your profit as a ' +
                'distribution instead of salary. Because salary carries payroll tax and ' +
                'distributions do not, there is an incentive to understate salary. The ' +
                'IRS expects "reasonable compensation" for the work you actually do, ' +
                'and this is a well-known area of examination.',
            ],
          },
          {
            h: 'How people arrive at a defensible figure',
            p: [
              'The common approach is to look at what it would cost to hire someone to ' +
                'do your role — your actual duties, hours and market — and document the ' +
                'sources you used. Some owners use a reasonable-compensation report; ' +
                'some use salary survey data for their role and region. The method ' +
                'matters less than writing down the reasoning and keeping it.',
              'Worksheet 2 at the back is where you record your figure and its basis. ' +
                'Revisit it yearly; your duties and the market move.',
            ],
          },
          {
            h: 'The split in practice',
            p: [
              'Once the salary is set, it runs through payroll on a schedule. Profit ' +
                'above salary can be taken as distributions. Keep distributions ' +
                'proportional to ownership and do not let them stand in for a salary ' +
                'you never actually ran.',
            ],
          },
        ],
        checklist: [
          'Decide your reasonable salary using a documented method.',
          'Record the figure and its basis (Worksheet 2); revisit annually.',
          'Run the salary through formal payroll; take profit above it as ' +
            'distributions.',
        ],
      },
      {
        title: 'Running payroll for one',
        intro:
          'A one-person S-corp still has to do real payroll: withholdings, deposits ' +
          'and filings on a schedule. Automate it.',
        sections: [
          {
            h: 'What payroll actually involves',
            p: [
              'Payroll means calculating withholding, paying the employer and employee ' +
                'shares of payroll taxes, making deposits on time, and filing the ' +
                'periodic federal and California payroll returns. Late deposits carry ' +
                'penalties that are easy to avoid and annoying to fix.',
              'A payroll provider handles the arithmetic, the deposits and the filings ' +
                'for a modest monthly fee. For a single-owner S-corp this is almost ' +
                'always worth it over doing it by hand.',
            ],
          },
          {
            h: 'California specifics',
            p: [
              'California has its own payroll tax registration and filings through the ' +
                'EDD, separate from the federal system. Register before the first ' +
                'payroll run, not after.',
            ],
          },
        ],
        checklist: [
          'Choose a payroll provider or a documented manual process.',
          'Register with the EDD before the first run.',
          'Confirm deposit and filing schedules; automate reminders.',
        ],
      },
      {
        title: 'Bookkeeping that survives a question',
        intro:
          'Books exist so that at tax time, and if anyone ever asks, the numbers tie ' +
          'out to reality. Keep them boring and current.',
        sections: [
          {
            h: 'The monthly rhythm',
            p: [
              'Reconcile every account monthly against statements, categorize ' +
                'transactions as you go rather than in a March panic, and keep ' +
                'receipts for anything you deduct. A month that is reconciled is a ' +
                'month you never have to reconstruct.',
            ],
          },
          {
            h: 'Statements and documents',
            p: [
              'Keep bank and processor statements where you can retrieve them. ' +
                'CoinPayPortal\'s finances tools can pull and file statements into a ' +
                'document library so they are in one place at year end; see Chapter 12. ' +
                'However you do it, the goal is the same: nothing to hunt for later.',
            ],
          },
        ],
        checklist: [
          'Reconcile all accounts monthly.',
          'Categorize transactions continuously.',
          'Store statements and receipts in one retrievable place.',
        ],
      },
      {
        title: 'Taxes through the year',
        intro:
          'The S-corp tax calendar is a handful of recurring dates. Missing them costs ' +
          'money; meeting them is just a calendar.',
        sections: [
          {
            h: 'The moving parts',
            p: [
              'A business return (1120-S) with K-1s flows profit to your personal ' +
                'return. You generally make quarterly estimated payments personally. ' +
                'California adds its annual franchise tax and the 1.5% S-corp tax on ' +
                'net income. Dates and amounts change — confirm each year.',
            ],
          },
          {
            h: 'Don\'t let the estimate surprise you',
            p: [
              'This is what the tax-holding sub-account from Chapter 5 is for. If a ' +
                'fixed share of every deposit is already set aside, the quarterly ' +
                'estimate is a transfer, not a scramble. Worksheet 5 helps you pick the ' +
                'percentage.',
            ],
          },
        ],
        checklist: [
          'Calendar federal and California filing and estimate dates for the year.',
          'Fund estimates from the tax-holding account.',
          'Confirm current franchise and 1.5% S-corp tax figures with the FTB.',
        ],
      },
    ],
  },
  {
    part: 'Part III',
    name: 'Selling online, agents, and tools',
    chapters: [
      {
        title: 'Selling online and getting paid',
        intro:
          'How money comes in, what each method costs, and where sales tax quietly ' +
          'attaches.',
        sections: [
          {
            h: 'Payment methods and their real cost',
            p: [
              'Card processors are convenient and charge a percentage plus a fixed fee ' +
                'per transaction. ACH is cheaper for larger or recurring invoices. ' +
                'Accepting stablecoins or crypto through a processor like CoinPayPortal ' +
                'can lower the percentage for the right buyer, with its own tradeoffs. ' +
                'None is universally best; match the method to the sale.',
            ],
          },
          {
            h: 'Sales tax nexus',
            p: [
              'Selling into other states can create tax obligations there once you ' +
                'cross their economic nexus thresholds. Digital goods are taxed ' +
                'differently from state to state. This gets complicated quickly; it is ' +
                'a question for your accountant once you sell across state lines in ' +
                'volume.',
            ],
          },
        ],
        checklist: [
          'Map each product to the cheapest payment method that fits its buyer.',
          'Track where your customers are; watch for out-of-state nexus.',
          'Revisit digital-goods taxability with your accountant as you grow.',
        ],
      },
      {
        title: 'Dated cost comparisons (read the as-of date)',
        intro:
          'A snapshot of what the pieces of an online S-corp tend to cost. Every ' +
          'figure here is an illustrative, as-of estimate — not a quote. Re-check ' +
          'before you rely on it.',
        sections: [
          {
            h: 'Recurring costs, illustrative',
            p: [
              'As an order-of-magnitude picture only: state franchise tax is a fixed ' +
                'annual minimum; a payroll service runs a modest monthly fee; ' +
                'bookkeeping ranges from free-if-you-do-it to a monthly service fee; ' +
                'registered agent and business license renew annually. The point is ' +
                'the shape of the budget, not any one number.',
              'Agents and automated operators: treat each of these as a value to fetch ' +
                'from the provider, timestamped, not a constant. A figure in a PDF is ' +
                'stale the moment it is printed.',
            ],
          },
          {
            h: 'One-time costs, illustrative',
            p: [
              'Formation filing, an operating agreement, and initial licenses are ' +
                'mostly one-time. Doing the mechanical parts yourself (EIN, filings) ' +
                'costs time rather than money; paying a formation service buys ' +
                'convenience, not a better outcome.',
            ],
          },
        ],
        checklist: [
          'Build your own budget from current, confirmed figures.',
          'Mark every figure with the date you confirmed it.',
          'Re-price annually; costs and fees drift.',
        ],
      },
      {
        title: 'CoinPayPortal workflows',
        intro:
          'Where CoinPayPortal fits for an online S-corp: accepting payment, and ' +
          'keeping the financial records that payment generates.',
        sections: [
          {
            h: 'Accepting payment',
            p: [
              'CoinPayPortal lets a business accept stablecoin and crypto payments with ' +
                'invoices and a checkout, settling to the wallet or account you choose. ' +
                'For buyers who prefer to pay that way it can be cheaper than cards. It ' +
                'is one method among several; use it where it fits.',
            ],
          },
          {
            h: 'Finances and statements',
            p: [
              'Beyond payment, CoinPayPortal\'s finances tools can gather account and ' +
                'bank statements into a single document library and produce a financial ' +
                'summary you can hand to an accountant. The aim is to make the ' +
                'bookkeeping rhythm from Chapter 8 a matter of review rather than ' +
                'collection.',
            ],
          },
          {
            h: 'For agents',
            p: [
              'CoinPayPortal exposes a CLI, an API and an MCP server, so an automated ' +
                'operator can create invoices, reconcile payments and pull statements ' +
                'programmatically. Keep irreversible actions behind explicit owner ' +
                'approval.',
            ],
          },
        ],
        checklist: [
          'Decide whether stablecoin/crypto acceptance fits any of your sales.',
          'Use a single document library for statements.',
          'If you automate, gate irreversible steps behind owner approval.',
        ],
      },
      {
        title: 'Investing idle cash, carefully',
        intro:
          'What to consider before a business parks its reserve anywhere other than ' +
          'the operating account. This is the most "not advice" chapter in the book.',
        sections: [
          {
            h: 'Separate the buckets first',
            p: [
              'Before thinking about yield, separate operating cash, the tax reserve, ' +
                'and any true surplus. The tax reserve is not yours to invest; it is ' +
                'the government\'s money you are holding. Only genuine surplus is even ' +
                'a candidate.',
            ],
          },
          {
            h: 'A brokerage as a tool, not a plan',
            p: [
              'Some owners hold surplus in a business brokerage account for ' +
                'cash-equivalent yield. We have used moomoo for its interface and ' +
                'tooling; that is an editorial preference, not a recommendation to ' +
                'invest, a ranking, or a sponsorship. Investing business funds has tax ' +
                'and risk consequences that are specific to you. Talk to a ' +
                'professional before moving a reserve anywhere.',
            ],
          },
        ],
        checklist: [
          'Separate operating, tax-reserve and surplus cash.',
          'Never invest the tax reserve.',
          'Get professional advice before investing business funds.',
        ],
      },
      {
        title: 'Working with agents and automation',
        intro:
          'An online S-corp is an unusually good fit for automation. The guardrails ' +
          'matter more than the ambition.',
        sections: [
          {
            h: 'What to automate, what to gate',
            p: [
              'Reconciling transactions, drafting invoices, gathering statements and ' +
                'assembling a summary are safe to automate. Filing a return, running ' +
                'payroll, making an entity election or moving money out are not: those ' +
                'are owner decisions an agent prepares but does not execute alone.',
            ],
          },
          {
            h: 'Keep an audit trail',
            p: [
              'Whatever an agent does, it should leave a record a human can read ' +
                'afterward: what it did, when, and on what basis. That record is what ' +
                'turns "the bot handles it" from a risk into a convenience.',
            ],
          },
        ],
        checklist: [
          'List which tasks are automated and which require owner approval.',
          'Require explicit approval for anything irreversible.',
          'Keep a human-readable audit trail of automated actions.',
        ],
      },
      {
        title: 'A first-year calendar',
        intro:
          'The whole book, compressed into the order things actually happen in a first ' +
          'year. Use it as a spine; fill in your own confirmed dates.',
        sections: [
          {
            h: 'The arc of the year',
            p: [
              'Form the entity and get the EIN. Register with your city and, if ' +
                'needed, the CDTFA and EDD. Open the business bank account and its tax ' +
                'envelope. Set your salary and start payroll. Establish the monthly ' +
                'bookkeeping rhythm. Make quarterly estimates from the reserve. File ' +
                'the business and personal returns. Renew licenses as they come due.',
              'None of these is hard in isolation. The failure mode is always the ' +
                'missed date, which is why every chapter ends by telling you to put the ' +
                'date on a calendar.',
            ],
          },
        ],
        checklist: [
          'Transcribe every deadline from this book onto one real calendar.',
          'Confirm each figure against its primary source before relying on it.',
          'Schedule a yearly review of salary, costs and tools.',
        ],
      },
    ],
  },
];

// 8 worksheets. Each: title, intro, and fields [{ label, hint }].
export const WORKSHEETS = [
  {
    title: 'Worksheet 1 — Formation checklist',
    intro: 'Track the one-time formation steps and the dates that follow from them.',
    fields: [
      { label: 'Entity name chosen and availability confirmed', hint: 'Secretary of State + domain/handles' },
      { label: 'Registered agent', hint: 'Self or service; address on record' },
      { label: 'Articles of Organization filed', hint: 'Date filed' },
      { label: 'EIN obtained (free, directly from IRS)', hint: 'Date' },
      { label: 'Operating agreement signed', hint: 'Stored where?' },
      { label: 'Statement of Information due', hint: '90 days, then biennial' },
      { label: 'Form 2553 deadline (if electing S-corp)', hint: 'Date' },
    ],
  },
  {
    title: 'Worksheet 2 — Reasonable compensation',
    intro: 'Record your salary figure and, more importantly, the reasoning behind it.',
    fields: [
      { label: 'Your actual duties and hours', hint: 'What would you hire someone to do?' },
      { label: 'Market data source(s) used', hint: 'Survey, report, comparable role' },
      { label: 'Salary figure chosen', hint: 'Annual' },
      { label: 'Basis for the figure', hint: 'One paragraph you could defend' },
      { label: 'Date set / next review date', hint: 'Revisit yearly' },
    ],
  },
  {
    title: 'Worksheet 3 — City & county registration',
    intro: 'Your city is specific. Fill this from your own city\'s finance department.',
    fields: [
      { label: 'City business license required?', hint: 'Confirmed with finance dept' },
      { label: 'License fee and basis', hint: 'Flat, gross receipts, headcount?' },
      { label: 'Renewal cycle and date', hint: '' },
      { label: 'Home occupation permit needed?', hint: '' },
      { label: 'Seller\'s permit (CDTFA) needed?', hint: '' },
    ],
  },
  {
    title: 'Worksheet 4 — Banking setup',
    intro: 'The accounts and the envelope habit that prevents most cash-flow pain.',
    fields: [
      { label: 'Business checking opened', hint: 'Bank, date' },
      { label: 'Second option priced', hint: 'For comparison' },
      { label: 'Tax-holding sub-account created', hint: '' },
      { label: 'Percentage of each deposit swept to taxes', hint: 'See Worksheet 5' },
    ],
  },
  {
    title: 'Worksheet 5 — Tax reserve percentage',
    intro: 'Pick the share of every deposit to set aside so estimates are a transfer, not a scramble.',
    fields: [
      { label: 'Estimated combined effective rate', hint: 'Confirm with your accountant' },
      { label: 'Reserve percentage chosen', hint: 'Round up for safety' },
      { label: 'Where the reserve is held', hint: 'Separate account' },
      { label: 'Quarterly estimate dates', hint: 'Federal + California' },
    ],
  },
  {
    title: 'Worksheet 6 — Monthly bookkeeping rhythm',
    intro: 'The short monthly loop that keeps year-end boring.',
    fields: [
      { label: 'Accounts to reconcile each month', hint: 'List them' },
      { label: 'Day of month you reconcile', hint: 'Make it a habit' },
      { label: 'Where statements are stored', hint: 'One retrievable place' },
      { label: 'Where receipts are stored', hint: '' },
    ],
  },
  {
    title: 'Worksheet 7 — Payment methods',
    intro: 'Map each product to the cheapest method that fits its buyer.',
    fields: [
      { label: 'Product / service', hint: '' },
      { label: 'Typical buyer', hint: 'Consumer, business, agent' },
      { label: 'Chosen payment method', hint: 'Card, ACH, stablecoin' },
      { label: 'Effective cost', hint: 'As-of date' },
    ],
  },
  {
    title: 'Worksheet 8 — Automation & approvals',
    intro: 'Decide up front what an agent may do alone and what needs your sign-off.',
    fields: [
      { label: 'Tasks automated', hint: 'Reconcile, invoice, gather statements' },
      { label: 'Tasks requiring owner approval', hint: 'Filings, payroll, moving money' },
      { label: 'Where the audit trail lives', hint: 'Human-readable' },
      { label: 'Review cadence', hint: 'How often you check the agent' },
    ],
  },
];
