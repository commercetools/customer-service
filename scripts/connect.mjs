#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the commercetools-labs contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

/**
 * Register and deploy Customer Service with commercetools Connect.
 *
 *   node scripts/connect.mjs status
 *   node scripts/connect.mjs register --tag v1.1.0
 *   node scripts/connect.mjs deploy
 *   node scripts/connect.mjs redeploy                     # configuration only
 *   node scripts/connect.mjs redeploy --update-connector  # and the newest tag
 *   node scripts/connect.mjs redeploy --dry-run           # show, send nothing
 *   node scripts/connect.mjs logs
 *
 * Every step is idempotent, so a rerun after a failure picks up where it
 * stopped.
 *
 * A redeploy carries the running configuration across. Setting a variable
 * below is how you ask for a change; leaving it unset is how you ask for none.
 * Defaults apply only to a deployment that has no value yet — otherwise a bare
 * `redeploy`, run to pick up a new tag, would reset the storefront URLs.
 *
 * Credentials come from the environment and are never written here — an API
 * Client on the Project the connector is deployed to, with `manage_project`:
 *
 *   CTP_PROJECT_KEY CTP_CLIENT_ID CTP_CLIENT_SECRET CTP_AUTH_URL
 *
 * and the deployment's configuration (see connect.yaml):
 *
 *   CUSTOM_APPLICATION_ID ENTRY_POINT_URI_PATH CLOUD_IDENTIFIER
 *   STOREFRONT_B2C_URL STOREFRONT_B2B_URL CSR_EXTRA_FRAME_SRC
 *
 * and three of this script's own:
 *
 *   CONNECT_CREATOR_NAME / CONNECT_CREATOR_EMAIL   to `register`
 *   CONNECT_REPO_URL     the repository Connect clones — your fork, if any
 *   CONNECT_KEY          the connector key, which is globally unique
 */

const env = process.env;

const KEY = env.CONNECT_KEY?.trim() || 'commercetools-labs-customer-service';
const DEPLOYMENT_KEY = 'customer-service';
const REGION = env.CONNECT_REGION?.trim() || 'us-central1.gcp';

/**
 * The SSH form works for a public repository and a private one alike. The
 * https form works only while the repository is public; for a private one
 * Connect answers `422 GitRepositoryNotReachable`, which reads exactly like a
 * repository that does not exist.
 */
const REPO = env.CONNECT_REPO_URL?.trim() || 'git@github.com:commercetools/customer-service.git';

const projectKey = env.CTP_PROJECT_KEY;
const authUrl = env.CTP_AUTH_URL?.replace(/\/$/, '');

if (!projectKey || !authUrl || !env.CTP_CLIENT_ID || !env.CTP_CLIENT_SECRET) {
  console.error('Set CTP_PROJECT_KEY, CTP_AUTH_URL, CTP_CLIENT_ID and CTP_CLIENT_SECRET.');
  process.exit(2);
}

/**
 * Connect is a separate API from the commercetools HTTP API: different host,
 * same OAuth tokens. Deriving it from the auth host keeps the two in the same
 * region.
 */
const connectUrl = authUrl.replace('://auth.', '://connect.');

const flag = (name) => process.argv.includes(`--${name}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  const next = i === -1 ? undefined : process.argv[i + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

/**
 * Connect records who registered a connector, and that is whoever runs this —
 * not whoever wrote it — so there is no default.
 */
function creator() {
  const name = env.CONNECT_CREATOR_NAME?.trim();
  const email = env.CONNECT_CREATOR_EMAIL?.trim();
  if (!name || !email) {
    console.error('register: set CONNECT_CREATOR_NAME and CONNECT_CREATOR_EMAIL.');
    process.exit(1);
  }
  return { name, email };
}

let cachedToken = null;
async function token() {
  if (cachedToken && cachedToken.expires > Date.now() + 30_000) return cachedToken.value;
  const res = await fetch(`${authUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${env.CTP_CLIENT_ID}:${env.CTP_CLIENT_SECRET}`).toString(
        'base64'
      )}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status}`);
  const body = await res.json();
  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function connect(method, path, body) {
  const res = await fetch(`${connectUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = new Error(`Connect ${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

/** Drafts are organization-level: no project key in the path. Deployments are not. */
const draft = () =>
  connect('GET', `/connectors/drafts/key=${KEY}`).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
const deployment = () =>
  connect('GET', `/${projectKey}/deployments?limit=500`).then(
    (r) => r.results.find((d) => d.key === DEPLOYMENT_KEY) ?? null
  );

/** Every value the deployment carries. `fallback` applies only where nothing is stored. */
const CONFIG = [
  { app: 'mc-app', key: 'CUSTOM_APPLICATION_ID', required: true },
  { app: 'mc-app', key: 'ENTRY_POINT_URI_PATH', required: true },
  { app: 'mc-app', key: 'CLOUD_IDENTIFIER', fallback: 'gcp-us' },
  { app: 'mc-app', key: 'STOREFRONT_B2C_URL' },
  { app: 'mc-app', key: 'STOREFRONT_B2B_URL' },
  { app: 'mc-app', key: 'CSR_EXTRA_FRAME_SRC' },
];
const APPLICATIONS = [...new Set(CONFIG.map((c) => c.app))];

function storedConfiguration(dep) {
  const stored = {};
  for (const a of dep?.applications ?? []) {
    stored[a.applicationName] = new Map(
      (a.standardConfiguration ?? []).map((c) => [c.key, c.value])
    );
  }
  return stored;
}

/** What you asked for, else what is already running, else the declared fallback. */
function resolve(entry, stored) {
  const fromEnv = env[entry.key]?.trim();
  if (fromEnv) return { value: fromEnv, source: 'environment' };
  const kept = stored[entry.app]?.get(entry.key);
  if (kept !== undefined && kept !== '') return { value: kept, source: 'deployment' };
  if (entry.fallback !== undefined) return { value: entry.fallback, source: 'default' };
  return null;
}

function configurations(stored = {}) {
  const byApp = Object.fromEntries(
    APPLICATIONS.map((app) => [app, { standardConfiguration: [], securedConfiguration: [] }])
  );
  for (const entry of CONFIG) {
    const resolved = resolve(entry, stored);
    if (!resolved) {
      // A required key sent as '' satisfies Connect's own check and deploys
      // a Custom Application that can never load. Refuse by name instead.
      if (entry.required) {
        throw new Error(
          `${entry.key} is required and has no value. Register the Custom Application in the ` +
            `Merchant Center and export ${entry.key} — see REGISTRATION.md.`
        );
      }
      continue;
    }
    byApp[entry.app].standardConfiguration.push({ key: entry.key, value: resolved.value });
    console.log(
      `  ${entry.app.padEnd(8)} ${entry.key.padEnd(24)} ${resolved.value.slice(0, 60).padEnd(62)} ${
        resolved.source
      }`
    );
  }
  // DeploymentConfigurationApplication requires both arrays, even empty.
  return APPLICATIONS.map((app) => ({ applicationName: app, ...byApp[app] }));
}

const applicationUrls = (dep) =>
  Object.fromEntries((dep?.applications ?? []).map((a) => [a.applicationName, a.url]));

async function cmdStatus() {
  const d = await draft();
  console.log(`Connect    ${connectUrl}`);
  console.log(`Project    ${projectKey}`);
  console.log(
    d
      ? `draft      ${KEY} v${d.version}, ${d.repository.url} @ ${d.repository.tag}, previewable=${d.isPreviewable}`
      : `draft      ${KEY} absent`
  );
  for (const e of d?.previewableReport?.entries ?? []) {
    console.log(`  ${e.type === 'Error' ? '✗' : '·'} ${e.title}${e.message ? ` — ${e.message}` : ''}`);
  }
  const dep = await deployment();
  console.log(
    dep
      ? `deployment ${DEPLOYMENT_KEY} ${dep.status}, connector v${dep.connector?.version}`
      : `deployment ${DEPLOYMENT_KEY} absent`
  );
  for (const [name, url] of Object.entries(applicationUrls(dep))) {
    console.log(`  ${name.padEnd(8)} ${url ?? '(no URL yet)'}`);
  }
  for (const e of dep?.details?.report?.entries ?? []) {
    console.log(`  ${e.type === 'Error' ? '✗' : '·'} ${e.title}${e.message ? ` — ${e.message}` : ''}`);
  }
}

async function cmdRegister() {
  const tag = arg('tag');
  if (!tag) {
    console.error('Pass --tag <git tag>.');
    process.exit(2);
  }
  let d = await draft();
  if (!d) {
    d = await connect('POST', '/connectors/drafts', {
      key: KEY,
      name: 'Customer Service',
      description:
        'A customer-service workspace in the Merchant Center: customer 360, orders, returns and refunds, assisted ordering, lists and cases.',
      creator: creator(),
      repository: { url: REPO, tag },
      supportedRegions: [REGION],
    });
    console.log(`created draft ${d.id}`);
  } else if (d.repository.tag !== tag || d.repository.url !== REPO) {
    d = await connect('POST', `/connectors/drafts/key=${KEY}`, {
      version: d.version,
      actions: [{ action: 'setRepository', url: REPO, tag }],
    });
    console.log(`draft repointed at ${REPO} @ ${tag}`);
  }
  // `isPreviewable` is a STRING enum ('none' | 'pending' | 'true' | 'false').
  // A truthiness check passes on 'none' and skips the validation build.
  if (d.isPreviewable !== 'true' || flag('revalidate')) {
    d = await connect('POST', `/connectors/drafts/key=${KEY}`, {
      version: d.version,
      actions: [{ action: 'updatePreviewable' }],
    });
    console.log(
      `previewable=${d.isPreviewable} — validation is asynchronous and takes several minutes. ` +
        'Poll with `status`.'
    );
  }
}

async function cmdDeploy() {
  const d = await draft();
  if (!d) {
    console.error('No draft. Run `register --tag <tag>` first.');
    process.exit(1);
  }
  if (d.isPreviewable !== 'true') {
    console.error(`Draft is not previewable yet (isPreviewable=${d.isPreviewable}).`);
    process.exit(1);
  }
  if (await deployment()) {
    console.log('Deployment already exists. Use `redeploy`.');
    return;
  }
  console.log('configuration:');
  const dep = await connect('POST', `/${projectKey}/deployments`, {
    key: DEPLOYMENT_KEY,
    connector: { key: KEY, version: d.version, staged: true },
    region: REGION,
    configurations: configurations(),
  });
  console.log(`deployment ${dep.id} ${dep.status} — this takes up to 15 minutes.`);
}

async function cmdRedeploy() {
  const dep = await deployment();
  if (!dep) {
    console.error('No deployment yet. Run `deploy`.');
    process.exit(1);
  }
  // A redeploy stays on the connector version it was deployed from. A new tag
  // reaches the Project only with `updateConnector`; without it the redeploy
  // succeeds, reports the new configuration, and runs the old code.
  const updateConnector = flag('update-connector');
  console.log('configuration:');
  const configurationValues = configurations(storedConfiguration(dep));
  if (flag('dry-run')) {
    console.log('\nDry run — nothing sent.');
    return;
  }
  const updated = await connect('POST', `/${projectKey}/deployments/key=${DEPLOYMENT_KEY}`, {
    version: dep.version,
    actions: [
      {
        action: 'redeploy',
        // `configurationValues`, not `configurations`: the draft uses one name
        // and the redeploy action the other, and the wrong one is accepted
        // and ignored.
        configurationValues,
        ...(updateConnector ? { updateConnector: true } : {}),
      },
    ],
  });
  console.log(`status ${updated.status}`);
}

async function cmdLogs() {
  const dep = await deployment();
  if (!dep) {
    console.error('No deployment yet.');
    process.exit(1);
  }
  const logs = await connect('GET', `/${projectKey}/deployments/key=${DEPLOYMENT_KEY}/logs?limit=100`);
  console.log(JSON.stringify(logs, null, 1).slice(0, 12000));
}

const commands = {
  status: cmdStatus,
  register: cmdRegister,
  deploy: cmdDeploy,
  redeploy: cmdRedeploy,
  logs: cmdLogs,
};

const run = commands[process.argv[2]];
if (!run) {
  console.error(`Usage: node scripts/connect.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
run().catch((e) => {
  if (e.body !== undefined) console.error(`HTTP ${e.status}`, JSON.stringify(e.body).slice(0, 1500));
  else console.error(e.message);
  process.exitCode = 1;
});
