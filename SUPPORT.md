# Support

Thanks for taking a look at this project. It is commercetools-labs reference code: shared in the
hope that it is useful, and **unsupported**.

In practice that means:

- It is freely available under the MIT license ([LICENSE](LICENSE)) and is provided as-is, without
  warranty.
- It isn't covered by commercetools Support, your account team or any service-level agreement, so
  we can't promise replies, fixes or new releases.
- Issues and pull requests are welcome, and we'll take a look when we can. That includes security
  findings: please report what you find, and plan on fixing it in your own copy rather than
  waiting for a release.

## If you are going to production with this

A few things are worth doing before customer-service agents rely on it:

- **Review the security posture.** Start with
  [`docs/CSR-STOREFRONT-INTEGRATION.md`](docs/CSR-STOREFRONT-INTEGRATION.md). The CSR launch
  creates authenticated customer sessions, and the storefront half of that handshake is yours to
  implement, so it deserves a careful read.
- **Scope your API clients.** Give each deployed app a least-privilege client rather than a
  `manage_project` one.
- **Decide what an impersonating agent may do.** The app leaves that policy to you, so set the
  limits that fit your business.
- **Add observability, rate limiting and audit logging.** The app ships without them, so wire in
  the ones your operation needs.
- **Pin and audit dependencies.** Keep your copy's dependencies on versions you have reviewed, and
  update them on your own schedule.

## If you need help

- **Questions and bugs:** open a GitHub issue. Another reader or a maintainer may well have an
  answer, though we can't commit to one. The code is commented with the reasoning as well as the
  mechanics, so it is often the quickest place to look first.
- **Using it in production:** feel free to fork it and adapt it to your needs. Once it's in
  production it's yours, so review the code, test it against your project and keep your copy up
  to date.
- **commercetools products:** for questions about Composable Commerce or the Merchant Center
  themselves, the [commercetools documentation](https://docs.commercetools.com), the community and
  commercetools Support are the right place, as usual.
