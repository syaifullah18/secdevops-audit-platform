# GitLab CI/CD Template: SDAP Audit Gate

Integration template for GitLab CI/CD.

## Configuration

1. In your GitLab project, navigate to **Settings > CI/CD > Variables**.
2. Add the following variables:
   - `SDAP_TOKEN`: Set type to **Variable**, check **Mask variable** and **Protect variable**.
   - `SDAP_API_URL`: Base URL of the SDAP service.
   - `SDAP_PROJECT`: Target project UUID in SDAP.

## Template File

Copy `deploy/ci/.gitlab-ci.yml` to the root of your repository or include it in your `.gitlab-ci.yml`:

```yaml
stages:
  - test
  - security

sdap-audit-gate:
  stage: security
  image: node:24
  before_script:
    - npm install -g @sdap/cli
  script:
    - sdap run --mode focused --wait --fail-on confirmed:high
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

## Behavior

- Triggers on Merge Requests and commits to the default branch.
- Reads `SDAP_TOKEN` securely from GitLab masked/protected variables without printing secret tokens in job logs.
- Fails the pipeline job (exit code `1`) if confirmed high or critical vulnerabilities are detected.
