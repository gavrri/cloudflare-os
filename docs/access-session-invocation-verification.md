# Access session invocation-deadline verification

This draft implements the hard session deadline at receive time and immediately before Cap'n Web local method invocation after asynchronous target/argument resolution. It uses a pnpm patch of capnweb 0.12.0's Workers entrypoint; the patch is part of the lockfile, not an untracked node_modules modification. Non-Access HTTP requests retain the original adapter.

Parent verification:
- `pnpm install --frozen-lockfile`: exit 0.
- Backend `pnpm exec vitest run __tests__/access-session-lifetime.test.ts`: 30 passed. Includes the four previously failing actual-method-execution regressions (delayed HTTP body, delayed nested HTTP body, asynchronous HTTP pipeline, asynchronous duplex pipeline).
- Backend focused lifetime/access/connect-handoff suites: 3 files / 48 passed.
- Backend `pnpm exec tsc --noEmit`: exit 0.
- `git diff --check`: exit 0.

Remaining gates before deployment: timer and transport cleanup on normal HTTP/WebSocket completion, broader backend/integration build and tests, patch coverage review for all supported invocation/entrypoint forms, isolated staging, production-compatible state migration review, and live Access/MFA/allowlist/session validation. The active official release is not asserted equivalent to this fork baseline. No production changes have occurred. Keep the PR draft; focused tests are not deployment readiness.
