function importOptionalModule(specifier: string): Promise<any> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<any>;
  }

  const runtimeImport = new Function('s', 'return import(s);') as (
    moduleName: string
  ) => Promise<any>;

  return runtimeImport(specifier);
}

const stripeClients = new Map<string, Promise<any>>();

export async function getStripe(secretKey = process.env.STRIPE_SECRET_KEY) {
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  let stripePromise = stripeClients.get(secretKey);
  if (!stripePromise) {
    stripePromise = importOptionalModule('stripe').then((mod) => {
      const Stripe = mod.default ?? mod;
      return new Stripe(secretKey, {
        apiVersion: '2026-01-28.clover',
      });
    });
    stripeClients.set(secretKey, stripePromise);
  }

  return stripePromise;
}

export async function getXrpl() {
  return importOptionalModule('xrpl');
}

export async function getCardanoSerializationLib() {
  const mod = await importOptionalModule('@emurgo/cardano-serialization-lib-nodejs');
  return mod.default ?? mod;
}
