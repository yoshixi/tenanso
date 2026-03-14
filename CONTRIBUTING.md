# Contributing to tenanso

Thanks for your interest in contributing!

## Development Setup

This project uses [Nix](https://nixos.org/) for reproducible development environments.

```bash
# Enter the dev shell (provides Node.js and pnpm)
nix develop

# Install dependencies
pnpm install

# Run tests
pnpm test

# Run e2e tests (requires Turso credentials)
pnpm test:e2e

# Type check
pnpm typecheck

# Dev docs
pnpm docs:dev
```

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Add tests for any new functionality.
3. Ensure `pnpm test` and `pnpm typecheck` pass.
4. Open a pull request with a clear description.

## Reporting Bugs

Use the [bug report template](https://github.com/yoshixi/tenanso/issues/new?template=bug_report.yml) with a minimal reproduction.
