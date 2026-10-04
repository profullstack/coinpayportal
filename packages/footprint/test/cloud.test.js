import { describe, it, expect, vi } from 'vitest';
import { createCidrMatcher, parseCidr, ipv4ToInt } from '../src/cidr.js';
import { fetchCloudRanges, createCloudMatcher, CLOUD_SOURCES, SINGAPORE_REGIONS } from '../src/cloud.js';

describe('ipv4ToInt / parseCidr', () => {
  it('converts dotted quads', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(4294967295);
    expect(ipv4ToInt('1.2.3.4')).toBe(16909060);
  });

  it('rejects anything that is not an IPv4 address', () => {
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'localhost', '::1', null, undefined]) {
      expect(ipv4ToInt(bad)).toBeNull();
    }
  });

  it('parses a prefix into inclusive bounds', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual([ipv4ToInt('10.0.0.0'), ipv4ToInt('10.255.255.255')]);
    expect(parseCidr('192.168.1.0/24')).toEqual([ipv4ToInt('192.168.1.0'), ipv4ToInt('192.168.1.255')]);
  });

  it('treats a bare address as /32', () => {
    expect(parseCidr('8.8.8.8')).toEqual([ipv4ToInt('8.8.8.8'), ipv4ToInt('8.8.8.8')]);
  });

  it('handles the whole-internet and single-host edges', () => {
    expect(parseCidr('0.0.0.0/0')).toEqual([0, 4294967295]);
    expect(parseCidr('1.2.3.4/32')).toEqual([16909060, 16909060]);
  });

  it('rejects an unusable prefix length', () => {
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('10.0.0.0/-1')).toBeNull();
  });
});

describe('createCidrMatcher', () => {
  it('matches inside and misses outside', () => {
    const m = createCidrMatcher(['10.0.0.0/8', '192.168.1.0/24']);
    expect(m('10.1.2.3')).toBe(true);
    expect(m('192.168.1.255')).toBe(true);
    expect(m('192.168.2.0')).toBe(false);
    expect(m('8.8.8.8')).toBe(false);
  });

  it('matches both boundaries of a range', () => {
    const m = createCidrMatcher(['203.0.113.0/24']);
    expect(m('203.0.113.0')).toBe(true);
    expect(m('203.0.113.255')).toBe(true);
    expect(m('203.0.112.255')).toBe(false);
    expect(m('203.0.114.0')).toBe(false);
  });

  it('merges overlapping and adjacent ranges', () => {
    // Cloud files overlap freely: a region prefix inside a larger service one.
    const m = createCidrMatcher(['10.0.0.0/24', '10.0.1.0/24', '10.0.0.128/25']);
    expect(m.size).toBe(1);
    expect(m('10.0.1.5')).toBe(true);
  });

  it('skips malformed entries instead of throwing', () => {
    // These lists are other people's published files; one bad line must not
    // take down the caller.
    const m = createCidrMatcher(['10.0.0.0/8', 'not-a-cidr', '', '999.1.1.1/24', null]);
    expect(m.size).toBe(1);
    expect(m('10.1.1.1')).toBe(true);
  });

  it('answers false for an empty list and for IPv6', () => {
    expect(createCidrMatcher([])('1.2.3.4')).toBe(false);
    expect(createCidrMatcher(['10.0.0.0/8'])('2001:db8::1')).toBe(false);
  });

  it('stays correct across many ranges', () => {
    const cidrs = [];
    for (let i = 0; i < 500; i++) cidrs.push(`${10 + (i % 200)}.${i % 256}.0.0/16`);
    const m = createCidrMatcher(cidrs);
    expect(m('10.0.5.5')).toBe(true);
    expect(m('9.255.255.255')).toBe(false);
  });
});

describe('fetchCloudRanges', () => {
  const awsBody = {
    prefixes: [
      { ip_prefix: '3.0.0.0/15', region: 'ap-southeast-1' },
      { ip_prefix: '52.0.0.0/15', region: 'us-east-1' },
    ],
  };
  const gcpBody = {
    prefixes: [
      { ipv4Prefix: '34.1.128.0/20', scope: 'asia-southeast1' },
      { ipv6Prefix: '2600::/32', scope: 'asia-southeast1' },
      { ipv4Prefix: '35.0.0.0/20', scope: 'us-central1' },
    ],
  };

  const fetchFor = (map) =>
    vi.fn(async (url) => {
      const key = Object.keys(map).find((k) => url.includes(k));
      if (!key) return { ok: false, status: 404 };
      const body = map[key];
      return { ok: true, status: 200, json: async () => body, text: async () => body };
    });

  it('filters to a region when asked', async () => {
    const fetchImpl = fetchFor({ amazonaws: awsBody, gstatic: gcpBody });
    const { cidrs, failed } = await fetchCloudRanges({
      providers: ['aws', 'gcp'],
      regions: SINGAPORE_REGIONS,
      fetch: fetchImpl,
    });
    expect(failed).toEqual([]);
    expect(cidrs).toContain('3.0.0.0/15');
    expect(cidrs).toContain('34.1.128.0/20');
    expect(cidrs).not.toContain('52.0.0.0/15');
    expect(cidrs).not.toContain('35.0.0.0/20');
  });

  it('takes the whole space when no region is given', async () => {
    const fetchImpl = fetchFor({ amazonaws: awsBody });
    const { cidrs } = await fetchCloudRanges({ providers: ['aws'], fetch: fetchImpl });
    expect(cidrs).toHaveLength(2);
  });

  it('ignores IPv6 prefixes, which the matcher cannot use', async () => {
    const fetchImpl = fetchFor({ gstatic: gcpBody });
    const { cidrs } = await fetchCloudRanges({ providers: ['gcp'], fetch: fetchImpl });
    expect(cidrs.every((c) => !c.includes(':'))).toBe(true);
  });

  it('reports a failing provider without losing the others', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('amazonaws')) throw new Error('ENOTFOUND');
      return { ok: true, status: 200, json: async () => gcpBody };
    });
    const { cidrs, failed } = await fetchCloudRanges({ providers: ['aws', 'gcp'], fetch: fetchImpl });
    expect(failed.join()).toMatch(/aws/);
    expect(cidrs.length).toBeGreaterThan(0);
  });

  it('names an unknown provider rather than silently skipping it', async () => {
    const { failed } = await fetchCloudRanges({ providers: ['nope'], fetch: vi.fn() });
    expect(failed.join()).toMatch(/unknown provider/);
  });

  it('parses DigitalOcean CSV', async () => {
    const csv = '1.2.3.0/24,SG,Singapore,Singapore,\n5.6.7.0/24,US,California,San Francisco,\n';
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => csv }));
    const { cidrs } = await fetchCloudRanges({
      providers: ['digitalocean'],
      regions: { digitalocean: 'SG' },
      fetch: fetchImpl,
    });
    expect(cidrs).toEqual(['1.2.3.0/24']);
  });
});

describe('createCloudMatcher', () => {
  it('matches nothing until a refresh lands', async () => {
    // Empty must mean "charge nobody", never "charge everybody": a slow or
    // failed download has to degrade to the behaviour we had before.
    const m = createCloudMatcher({ providers: ['aws'], fetch: vi.fn() });
    expect(m.matches('3.0.0.1')).toBe(false);
    expect(m.size).toBe(0);
  });

  it('matches after refreshing', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ prefixes: [{ ip_prefix: '3.0.0.0/15', region: 'ap-southeast-1' }] }),
    }));
    const m = createCloudMatcher({ providers: ['aws'], fetch: fetchImpl });
    await m.refresh();
    expect(m.matches('3.0.0.1')).toBe(true);
    expect(m.matches('8.8.8.8')).toBe(false);
  });

  it('keeps the last good list when a later refresh fails', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('upstream down');
      return {
        ok: true,
        status: 200,
        json: async () => ({ prefixes: [{ ip_prefix: '3.0.0.0/15', region: 'x' }] }),
      };
    });
    const m = createCloudMatcher({ providers: ['aws'], fetch: fetchImpl });
    await m.refresh();
    fail = true;
    await m.refresh();
    expect(m.matches('3.0.0.1')).toBe(true);
    expect(m.lastError).toMatch(/aws/);
  });

  it('publishes the real provider URLs', () => {
    expect(CLOUD_SOURCES.aws.url).toContain('ip-ranges.amazonaws.com');
    expect(CLOUD_SOURCES.gcp.url).toContain('gstatic.com/ipranges');
    expect(CLOUD_SOURCES.oracle.url).toContain('oracle.com');
  });

  it('finds Azure this-week file on the download page, then fetches it', async () => {
    // Azure has no stable file URL: the page names the current dated file.
    const page = '<a href="https://download.microsoft.com/download/7/1/d/71d86715/ServiceTags_Public_20260921.json">dl</a>';
    const tags = {
      values: [
        { properties: { region: 'southeastasia', addressPrefixes: ['104.215.128.0/17', '2603::/32'] } },
        { properties: { region: 'westus', addressPrefixes: ['13.64.0.0/16'] } },
      ],
    };
    // startsWith on the full origin, not `includes` on the host: any URL can
    // carry "download.microsoft.com" somewhere in it.
    const fetchImpl = vi.fn(async (url) =>
      url.startsWith('https://download.microsoft.com/')
        ? { ok: true, status: 200, json: async () => tags }
        : { ok: true, status: 200, text: async () => page },
    );

    const { cidrs, failed } = await fetchCloudRanges({
      providers: ['azure'],
      regions: { azure: 'southeastasia' },
      fetch: fetchImpl,
    });

    expect(failed).toEqual([]);
    expect(cidrs).toEqual(['104.215.128.0/17']); // IPv6 dropped, other region dropped
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports Azure rather than going stale when the page changes shape', async () => {
    // A silently stale Azure list is worse than a missing one.
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>redesigned</html>' }));
    const { cidrs, failed } = await fetchCloudRanges({ providers: ['azure'], fetch: fetchImpl });
    expect(cidrs).toEqual([]);
    expect(failed.join()).toMatch(/no file link/);
  });

  it('refuses a file link that points somewhere other than Microsoft', async () => {
    // The link comes out of a document someone else serves, so it is input.
    // A changed, redirected or hostile page must not choose what this server
    // fetches — that is SSRF with extra steps.
    const page = '<a href="https://evil.example.com/download/ServiceTags_Public_20260921.json">dl</a>';
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => page }));
    const { cidrs, failed } = await fetchCloudRanges({ providers: ['azure'], fetch: fetchImpl });
    expect(cidrs).toEqual([]);
    expect(failed.join()).toMatch(/no file link/);
    // Only the index page was fetched; the attacker's URL never was.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('is not hurt by a page built to make the parser backtrack', async () => {
    // A greedy `[^"']*` across the document backtracks polynomially. This is
    // the shape that would have hung it; splitting on delimiters is linear.
    const hostile =
      'https://download.microsoft.com/download/'.repeat(20000) + ' no-match-here';
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => hostile }));
    const started = Date.now();
    const { failed } = await fetchCloudRanges({ providers: ['azure'], fetch: fetchImpl });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(failed.join()).toMatch(/no file link/);
  });

  it('derives Alibaba from what its ASNs announce', async () => {
    // Alibaba publishes nothing, so this is the routing table rather than the
    // provider's own claim.
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          prefixes: url.includes('AS45102')
            ? [{ prefix: '47.240.0.0/17' }, { prefix: '2400:a480::/32' }]
            : [{ prefix: '8.210.0.0/16' }],
        },
      }),
    }));

    const { cidrs, failed } = await fetchCloudRanges({ providers: ['alibaba'], fetch: fetchImpl });

    expect(failed).toEqual([]);
    expect(cidrs).toContain('47.240.0.0/17');
    expect(cidrs.every((c) => !c.includes(':'))).toBe(true);
  });

  it('keeps the other Alibaba ASNs when one lookup fails', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('AS45102')) throw new Error('upstream down');
      return { ok: true, status: 200, json: async () => ({ data: { prefixes: [{ prefix: '8.210.0.0/16' }] } }) };
    });
    const { cidrs, failed } = await fetchCloudRanges({ providers: ['alibaba'], fetch: fetchImpl });
    expect(cidrs).toContain('8.210.0.0/16');
    expect(failed.join()).toMatch(/AS45102/);
  });

  it('parses Oracle regions', async () => {
    const body = {
      regions: [
        { region: 'ap-singapore-1', cidrs: [{ cidr: '140.238.0.0/16' }] },
        { region: 'us-ashburn-1', cidrs: [{ cidr: '129.213.0.0/16' }] },
      ],
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    const { cidrs } = await fetchCloudRanges({
      providers: ['oracle'],
      regions: { oracle: 'ap-singapore' },
      fetch: fetchImpl,
    });
    expect(cidrs).toEqual(['140.238.0.0/16']);
  });
});
