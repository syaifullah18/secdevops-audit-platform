# Bitbucket Pipelines Template: SDAP Audit Gate

Integration template for Atlassian Bitbucket Pipelines.

## Configuration

1. In your Bitbucket repository, go to **Repository settings > Repository variables**.
2. Add the following variables:
   - `SDAP_TOKEN`: Secured variable containing your API token (click the lock icon to encrypt).
   - `SDAP_API_URL`: Your self-hosted SDAP API URL (e.g. `https://sdap.internal.example.com`).
   - `SDAP_PROJECT`: Target project UUID in SDAP.

## Template File

Copy `deploy/ci/bitbucket-pipelines.yml` to the root of your repository (or merge the step into your existing pipeline configuration):

```yaml
image: node:24

pipelines:
  pull-requests:
    "**":
      - step:
          name: SDAP Security Audit Gate
          caches:
            - node
          script:
            - npm install -g @sdap/cli
            - export SDAP_API_URL="${SDAP_API_URL:-https://sdap.internal.example.com}"
            - export SDAP_PROJECT="${SDAP_PROJECT}"
            - export SDAP_TOKEN="${SDAP_TOKEN}"
            - sdap run --mode focused --wait --fail-on confirmed:high
```

## Behavior

- On pull request creation or update, triggers a `focused` audit of changed files.
- Streams phase updates directly to the Bitbucket Pipelines console.
- If confirmed high or critical vulnerabilities are proven, the step exits with code `1`, failing the pipeline and blocking merge checks.
