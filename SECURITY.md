# Security Policy

## Supported Versions

Only the latest release and the current release candidate line receive security patches.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

We take the security of the SecDevOps Audit Platform seriously. If you discover a vulnerability in this project:

1. **Do not** disclose it publicly via GitHub Issues, Discussions, or social media.
2. Email your report to the security team at `security@secdevops-platform.invalid` (or use GitHub Private Vulnerability Reporting).
3. Include detailed steps to reproduce the issue:
   - Target component (e.g., `packages/sandbox`, `apps/api`, `packages/normalizer`)
   - Proof-of-concept payload, request, or test case
   - Impact assessment
   - Any proposed mitigations or patches

### Response Timeline

- **Initial Acknowledgment:** Within 48 hours.
- **Triage & Assessment:** Within 5 business days.
- **Remediation & Advisory:** Coordinated release with CVE assignment where appropriate.

## Security Architecture Principles

- **Fail-Closed Execution:** All policy evaluation, tenant access checks, and sandbox constraints fail closed.
- **Least Privilege:** Sandbox runners drop all Linux capabilities (`CAP_DROP=ALL`), enforce non-root user execution (`uid 65534`), and prevent privilege escalation (`no-new-privileges`).
- **Network Isolation:** Sandbox containers have no direct internet access (`--network none` or internal network via egress allowlist proxy sidecar).
- **Tenant Isolation:** Multi-tenant policy enforcement scopes queries by client ID.
- **No Telemetry by Default:** Zero tracking or external phone-home telemetry.
