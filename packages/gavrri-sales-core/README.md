# GAVRRI Sales Core — local prototype

The SQL migration and strict-checked JavaScript implement local company and candidate records, explicit aliases, contact permission, immutable events and evidence, period limits, contract and amount records, and currency-scoped metrics. The local-only OS Gatekeeper exposes only candidate/history reads, demo metrics, and approved event recording; see `../gatekeeper-gavrri-sales/README.md`. This is not production-ready and must not be migrated to remote D1 or used with actual sales data.

From the repository root:

```sh
pnpm exec tsc -p packages/gavrri-sales-core/tsconfig.json
node --test packages/gavrri-sales-core/test/*.test.mjs plans/gavrri-revenue-slice/gadget/test/*.test.mjs
```

The local D1 test uses a disposable temporary directory and loopback, with synthetic data. The currently installed Miniflare uses compatibility date 2026-08-08, earlier than the OS's 2026-09-04 setting. Capability unit tests use injected test authorities and do not themselves establish OS authorization or Observer behavior. See the prototype README for the current UI limitations.
