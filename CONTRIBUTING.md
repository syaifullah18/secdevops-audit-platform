# Contributing to SecDevOps Audit Platform

Thank you for your interest in contributing to the SecDevOps Audit Platform!

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for all contributors. Please be respectful and constructive in all interactions.

## Prerequisites

- **Node.js**: Node 24 LTS (`.nvmrc` is provided).
- **Package Manager**: `pnpm` (v10+).
- **Container Runtime**: Docker or Podman (for running sandboxed audit tests).

## Setup & Workflow

1. **Clone the repository and submodules**:

   ```sh
   git clone --recurse-submodules https://github.com/secdevops/secdevops-audit-platform.git
   cd secdevops-audit-platform
   ```

2. **Install dependencies**:

   ```sh
   pnpm install
   ```

3. **Run verification gates**:
   Before submitting changes, ensure all checks pass:
   ```sh
   pnpm -r build
   pnpm -r typecheck
   pnpm -r lint
   pnpm -r test
   pnpm format:check
   ```

## Development Guidelines

- **TypeScript Strictness**: Code must compile under strict TypeScript mode without unused variables or unhandled edge cases. Avoid `any` without explicit justification comments.
- **Contract Integrity**: Contracts in `packages/core` are source-of-truth Zod schemas. Changes to core contracts require versioned coordination across all consuming packages.
- **Security-First**: Never commit secrets, credentials, or client tokens. Use `.env.example` templates.
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat(api): ...`, `fix(sandbox): ...`, `docs: ...`).

## Pull Requests

1. Create a feature branch from `main`.
2. Ensure automated tests cover any new features or bug fixes.
3. Verify formatting with `pnpm format`.
4. Open a pull request against `main` describing the changes and referencing any related issues.
