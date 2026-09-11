# Access cleanup and backend verification

Parent executed against the local runtime follow-up after reproducing and correcting malformed HTTP batch error parity.

Changes:
- No eight-hour lease timer is allocated per HTTP request.
- WebSocket lease timer and abort/close/error listeners are removed by idempotent cleanup.
- HTTP RPC session main stub is disposed in a finally block, after response serialization on success.
- Only the deadline guard establishes expiry; unrelated protocol failures are not reclassified as 403 expiry.

Actual checks:
- Focused lifetime + actual WebSocketPair/Request cleanup: 2 files, 37 passed.
- Backend `pnpm exec tsc --noEmit`: exit 0.
- Backend `pnpm run build:worker`: exit 0.
- Backend `pnpm run test:run`: exit 0. Main suite 51 files / 860 passed; integration config 1 file / 3 passed and 4 skipped. The skipped cases are not verified by this run; no tests were skipped to repair a failure.
- `git diff --check`: exit 0 for these follow-up source changes.

Local evidence: `/tmp/pr1-cleanup-verify.log`, `/tmp/pr1-cleanup-tsc-final.log`, `/tmp/pr1-cleanup-build.log`, `/tmp/pr1-backend-full.log`.

No production or staging deployment has occurred. Live Access/MFA/allowlist validation, isolated deployment, migration compatibility and the complete GAVRRI binding path remain separate gates. This evidence supersedes earlier local cleanup-blocker notes only, not deployment-readiness restrictions.
