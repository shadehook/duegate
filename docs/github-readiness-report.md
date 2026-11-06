# GitHub readiness report

This checklist records the initial publication review on October 28, 2026. Counts and repository settings below refer to that review. See the [README](../README.md) for the current demo and verification results.

1. **Repository readiness: PASS.** Sanitized publication tree and reproducible offline demo prepared for shadehook/duegate.
2. **Secret scan: PASS.** Configured credential values were found only in excluded .env during the first-party inventory scan. Exact staged-content checks found no configured private values, recognizable provider keys, JWTs or private keys. Checks do not constitute a formal security certification.
3. **Sensitive data audit: PASS.** Staged content contains no full provider UUIDs, IBANs, personal email addresses or private absolute user paths. Synthetic credential/bank strings in negative tests are intentional. Public proof is a selected summary with display aliases. All 30 preserved historical proof hashes match. Dependency/build directories were inventoried as excluded generated content; they were not treated as authored proof. No pre-existing local Git history existed; the remote was empty.
4. **.gitignore: PASS.** Credentials, runtime state, raw proof, screenshots, private reports, logs, dependencies, build output and local tooling artifacts are excluded. Explicit publication lists retain required build/runtime source.
5. **.env.example: PASS.** Variable names and empty values only. Includes sandbox beneficiary configuration; no credential needed for presentation.
6. **README: PASS.** Purpose, controls, approval binding, AI boundary, setup, actual stack, historical proof and limitations documented.
7. **Architecture doc: PASS.** docs/architecture.md describes deterministic controls, adapter, orchestration, persistence and trust boundaries.
8. **Demo doc: PASS.** docs/demo.md provides the no-write judge sequence, invalidation, evidence and restart flow.
9. **Proof doc: PASS.** docs/proof.md distinguishes the EUR 10,000 unexecuted narrative from the final historical EUR 1.00 sandbox proof; no delivery claim.
10. **Git remote: configured.** https://github.com/shadehook/duegate.git; verified against the existing repository. Initial commit/push follows this successful pre-push verification.
11. **Repository visibility: private.** Visibility is not changed by this task.
12. **Intentionally excluded:** .env; .spike-state; .execution-state; .demo-state; .demo-final-proof; .presentation-state; private docs and raw API/audit exports; screenshot/research archives; historical spike/execution scripts; node_modules; dist/build/coverage; logs, temporary files and IDE state. Source, tests, schemas, build runner and sanitized recorded fixture are included. Excluded local originals are preserved.
13. **Tests: 218 total / 218 passed / 0 failed.** Passed both in the working project and an isolated export of the Git index with no credentials/private artifacts. Locked dependencies installed successfully; npm reported zero vulnerabilities at verification time.
14. **Strict TypeScript typecheck: PASS.** npm run typecheck in both environments.
15. **Frontend build: PASS.** npm run build in both environments.
16. **Financial writes: conversions 0, transfers 0.** No Airwallex calls during this preparation.
17. **Safe to make public: YES**, based on the audited staged content. The repository remains private; changing visibility requires the owner's separate decision. Future files and commits need the same review.
18. **Remaining issues before public release:** No technical publication blocker identified. No license was selected; none was added. Owner must decide visibility/judge access and any license grant. At initial preparation Claude was not implemented. It is now complete for the scoped interpretation flow, with successful live verification; see docs/claude-integration.md. Sandbox transfer delivery remains unproven. Local demo identity, filesystem persistence and operational recovery are prototype limitations, not production guarantees.

## Scope of code changes

The presentation now loads a sanitized checked-in fixture instead of private proof exports. Tests use this fixture rather than local audit files. The previously hardcoded beneficiary is supplied through local sandbox configuration; mock/presentation instances use a synthetic reference. Historical tool entries were removed from package scripts and the public typecheck scope because those private runners are excluded. Financial rules, adapter execution semantics, approval fingerprints, duplicate/restart guards and original historical evidence were not changed.
