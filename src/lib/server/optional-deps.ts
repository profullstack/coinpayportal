/**
 * Optional server-only dependencies, resolved at runtime.
 *
 * The indirection exists to stop the bundler statically resolving these — they
 * are genuinely optional and may not be installed. It is deliberately an
 * ALLOWLIST rather than an arbitrary specifier: `new Function` builds an
 * evaluator, and one that takes a free-form module name is a shape worth not
 * having in a payments codebase even when every current caller passes a
 * constant. Adding a module here is a visible, reviewable change.
 */
const OPTIONAL_MODULES = {
  stripe: 'stripe',
  xrpl: 'xrpl',
  cardano: '@emurgo/cardano-serialization-lib-nodejs',
} as const;

type OptionalModuleName = keyof typeof OPTIONAL_MODULES;

function importOptionalModule(name: OptionalModuleName): Promise<any> {
  const specifier = OPTIONAL_MODULES[name];
  if (!specifier) {
    return Promise.reject(new Error(`Unknown optional module: ${String(name)}`));
  }

  if (process.env.VITEST) {
    return import(specifier) as Promise<any>;
  }

  const runtimeImport = new Function('s', 'return import(s);') as (
    moduleName: string
  ) => Promise<any>;

  return runtimeImport(specifier);
}

const stripeClients = new Map<string, Promise<any>>();

function createStripeClient(Stripe: any, secretKey: string) {
  const options = {
    apiVersion: '2026-01-28.clover',
  };

  try {
    return new Stripe(secretKey, options);
  } catch (error) {
    if (error instanceof TypeError && /constructor/i.test(error.message)) {
      return Stripe(secretKey, options);
    }
    throw error;
  }
}

export async function getStripe(secretKey = process.env.STRIPE_SECRET_KEY) {
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  let stripePromise = stripeClients.get(secretKey);
  if (!stripePromise) {
    stripePromise = importOptionalModule('stripe').then((mod) => {
      const Stripe = mod.default ?? mod;
      return createStripeClient(Stripe, secretKey);
    });
    stripeClients.set(secretKey, stripePromise);
  }

  return stripePromise;
}

export async function getXrpl() {
  return importOptionalModule('xrpl');
}

export async function getCardanoSerializationLib() {
  const mod = await importOptionalModule('cardano');
  return mod.default ?? mod;
}
