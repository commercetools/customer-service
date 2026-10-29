/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the commercetools-labs contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Customer Service — a project-agnostic Merchant Center Custom Application,
 * deployed through commercetools Connect.
 *
 * Nothing about a particular deployment is hardcoded. Connect supplies every
 * value below from the deployment's configuration (see connect.yaml):
 *
 *   CUSTOM_APPLICATION_ID   assigned by the Merchant Center on registration
 *   ENTRY_POINT_URI_PATH    the registration's "Application entry point URI path"
 *   CLOUD_IDENTIFIER        Merchant Center region, gcp-us / gcp-eu / …
 *   APPLICATION_URL         where Connect serves this app — Connect sets it
 *   STOREFRONT_B2C_URL      default storefront for "shop as customer"
 *   STOREFRONT_B2B_URL      storefront for B2B customers (defaults to the B2C URL)
 *   CSR_EXTRA_FRAME_SRC     comma-separated extra origins to allow in an iframe
 *
 * For `npm run start:dev`, the same names come from `.env`.
 *
 * The storefront URLs are only DEFAULTS: they can be overridden at runtime from
 * the in-app Settings screen, which stores them as a Custom Object. The one
 * thing that cannot move to runtime is the CSP below — see `frameSrc`.
 *
 * There is no shared secret. The "shop as customer" handshake is brokered
 * through a single-use Custom Object token; see src/csr-launch.ts and
 * docs/CSR-STOREFRONT-INTEGRATION.md.
 *
 * No imports, deliberately. Connect evaluates this file with Node inside the
 * deployment container, where importing a source module (`./src/constants`
 * is TypeScript) fails before the container writes a line of log, and the
 * deployment reports only "Connector provisioning failed". So the permission
 * keys are computed here, and src/constants.ts keeps the browser's copy.
 */

const APP_TITLE = 'Customer Service';

/**
 * Entry point paths are globally unique across every Merchant Center Custom
 * Application, and the bare `customer-service` is taken — so a registration
 * uses a namespaced one, `<org>-customer-service`, and every permission key is
 * derived from it.
 */
const entryPointUriPath =
  process.env.ENTRY_POINT_URI_PATH || 'customer-service';

/**
 * The Merchant Center's own derivation, from
 * `@commercetools-frontend/application-config`'s
 * `entryPointUriPathToPermissionKeys`: `acme-customer-service` →
 * `ViewAcmeCustomerService`. A key that differs from the one the Merchant
 * Center computes produces an application that loads and then refuses every
 * user, so this follows it exactly, numeric segments included.
 */
const upperFirst = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const resourceAccessKey = entryPointUriPath
  .split('_')
  .map(upperFirst)
  .join('_')
  .split('-')
  .map((word, i) => (i > 0 && /^\d/.test(word) ? `/${word}` : upperFirst(word)))
  .join('');
const PERMISSIONS = {
  View: `View${resourceAccessKey}`,
  Manage: `Manage${resourceAccessKey}`,
};

const storefrontB2cUrl = process.env.STOREFRONT_B2C_URL || '';
const storefrontB2bUrl = process.env.STOREFRONT_B2B_URL || storefrontB2cUrl;

const originOf = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

/**
 * Storefronts are embedded in an iframe by the "Place order for customer" CSR
 * flow, and the default appkit CSP is `frame-src 'self'` — which blocks them.
 * Allow exactly the configured storefront origins, nothing wider.
 *
 * This list is fixed when the deployment starts and cannot be changed by the
 * running app. A storefront configured later from the Settings screen therefore
 * opens in a new tab rather than an iframe unless its origin is listed here —
 * add it with CSR_EXTRA_FRAME_SRC and redeploy. The Settings screen surfaces
 * this list and flags any storefront that is not in it.
 */
const frameSrc = [
  ...new Set(
    [
      storefrontB2cUrl,
      storefrontB2bUrl,
      ...(process.env.CSR_EXTRA_FRAME_SRC || '').split(','),
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .map(originOf)
      .filter(Boolean)
  ),
];

/**
 * @type {import('@commercetools-frontend/application-config').ConfigOptionsForCustomApplication}
 */
const config = {
  name: APP_TITLE,
  description:
    'CSR workspace: customer 360, orders, returns/refunds, assisted ordering, promotions, lists and cases.',
  entryPointUriPath,
  // Read through process.env rather than `${env:…}` placeholders, which
  // throw when the variable is absent anywhere in the file — so a placeholder
  // for a development-only value would stop a deployment from starting.
  cloudIdentifier: process.env.CLOUD_IDENTIFIER || 'gcp-us',
  env: {
    development: {
      initialProjectKey: process.env.INITIAL_PROJECT_KEY || '',
    },
    production: {
      // Assigned by the Merchant Center on registration — see REGISTRATION.md.
      applicationId: process.env.CUSTOM_APPLICATION_ID || '',
      // Connect sets this to the deployment's own URL.
      url: process.env.APPLICATION_URL || '',
    },
  },
  oAuthScopes: {
    view: [
      'view_customers',
      'view_orders',
      'view_products',
      'view_published_products',
      'view_cart_discounts',
      'view_discount_codes',
      'view_shopping_lists',
      'view_stores',
      'view_business_units',
      'view_key_value_documents',
      'view_states',
    ],
    manage: [
      'manage_customers',
      'manage_orders',
      'manage_shopping_lists',
      'manage_key_value_documents',
    ],
  },
  // Exposed to the app at runtime via useApplicationContext(ctx => ctx.environment).
  additionalEnv: {
    storefrontB2bUrl,
    storefrontB2cUrl,
    // The CSP allowlist, so the Settings screen can tell the operator which
    // storefronts are actually embeddable instead of rendering a blank iframe
    // and a console CSP violation.
    frameSrcOrigins: frameSrc,
  },
  // appkit merges these into its computed CSP (and requires connect-src present).
  headers: {
    csp: {
      'connect-src': ["'self'"],
      'frame-src': frameSrc,
    },
  },
  icon: '${path:@commercetools-frontend/assets/application-icons/rocket.svg}',
  mainMenuLink: {
    defaultLabel: APP_TITLE,
    labelAllLocales: [],
    permissions: [PERMISSIONS.View],
  },
  // No submenu links: clicking "Customer Service" lands on the dashboard, which
  // is the single hub — it links out to Customers/Orders/Returns/Assisted
  // Order/Lists/Tickets (all still routed under this entry point).
  submenuLinks: [],
};

export default config;
