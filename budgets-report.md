<!-- budgets -->
## Performance budgets

**1 over budget.** Budgets live in `budgets.json`; raise one only with a reason in the PR.

| | Area | Measure | Now | Budget | |
| --- | --- | --- | ---: | ---: | --- |
| ✓ | Bundle | Shell (first paint) | 358.7 | 359.0 | KB gz |
| ✓ | Bundle | Pages | 4.9 | 120.0 | KB gz |
| ✓ | Bundle | Kernel client | 0.9 | 30.0 | KB gz |
| ✗ | Bundle | All JavaScript | 644.2 | 644.0 | KB gz |
| ✓ | WASM | OpenCascade (target 12 MB) | 21.9 | 24.0 | MB |
| ✓ | WASM | OpenCascade, Brotli (target 3.5 MB) | 5.4 | 6.0 | MB |
| ✓ | WASM | planegcs | 0.5 | 1.0 | MB |
