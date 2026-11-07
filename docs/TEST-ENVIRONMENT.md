# Test environment

`run-suite.sh` executes every `tests/test-*.mjs` file and reports deterministic failures separately from environment skips.

Current known environment-sensitive case:

- `tests/test-web-fetch.mjs` requires a network/mock fixture that returns a successful text response. On Termux it currently fails because the fixture response is unavailable, and the test then dereferences `ok.text` after `ok:false`. This is a test-fixture failure, not a core runtime claim.
- `tests/test-autoroute-wiring.mjs` may be classified as a skip when its environment-specific runtime assertion is unavailable.

Do not count a skipped test as a passing behavior. Do not turn a fixture/network failure into a production-code fix without first reproducing the fixture contract.
