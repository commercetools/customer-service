# Contributing

This is a commercetools-labs project, provided as-is and unsupported (see
[SUPPORT.md](SUPPORT.md)). Contributions are welcome and reviewed on a best-effort basis.

## What you can contribute

Only contribute code you have the right to license under MIT. If a file or directory is
substantially someone else's work, keep their license file alongside it and leave their
headers intact.

Never commit credentials or personal data; use obviously synthetic fixtures such as
`jane@example.com`.

## Before you open a PR

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (includes prettier)
npm test             # jest
npm run build        # mc-scripts build — the real pre-deploy gate
```

All four should pass. `npm run format` fixes most lint failures.

## What good looks like here

This repository optimizes for **being read**. People land in it to understand how a pattern
works before writing their own version, so:

- **Comment the *why*, not the *what*.** `// increment the counter` is noise. "commercetools
  rejects a stale version with a 409, so two CSRs creating tickets at once never collide" is
  the reason the code is shaped the way it is, and it cannot be recovered from reading it.
- **Match the surrounding code.** Its naming, its comment density, its idioms. A PR that
  introduces a second style makes the codebase harder to read even if the new style is
  better in isolation.
- **Keep it project-agnostic.** Nothing about a particular deployment belongs in `src/`.
  Build-time wiring goes through `custom-application-config.mjs`; anything an operator
  should be able to change belongs on the Settings screen.
- **No credentials in the app.** This app reaches commercetools exclusively through the
  Merchant Center API gateway, authenticating as the signed-in MC user, so a commercetools
  client secret has no place in this codebase.
- **Test the security-relevant paths.** If you touch the CSR launch, cover replay, expiry,
  and forgery. See section 6 of
  [`docs/CSR-STOREFRONT-INTEGRATION.md`](docs/CSR-STOREFRONT-INTEGRATION.md).

## Reporting a security issue

Open a GitHub issue. This repository has no private disclosure channel or embargo process, so
if the issue is genuinely sensitive, please weigh that before filing.

Report vulnerabilities in the commercetools *platform* itself to
[commercetools' official security contact](https://commercetools.com/privacy-and-security).

By contributing you agree your contribution is licensed under the [MIT License](LICENSE).
