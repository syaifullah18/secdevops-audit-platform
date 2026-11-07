# Jenkins Template: SDAP Audit Gate

Pipeline template for Jenkins Declarative Pipelines.

## Configuration

1. In Jenkins, go to **Manage Jenkins > Credentials > System > Global credentials**.
2. Add a new credential:
   - Kind: **Secret text**
   - Secret: Your SDAP API Token
   - ID: `sdap-token`
3. Configure `SDAP_API_URL` and `SDAP_PROJECT` in the pipeline environment block.

## Template File

Use the template in `deploy/ci/Jenkinsfile`:

```groovy
pipeline {
    agent {
        docker {
            image 'node:24'
        }
    }

    environment {
        SDAP_API_URL = 'https://sdap.internal.example.com'
        SDAP_PROJECT = '00000000-0000-4000-8000-000000000001'
        SDAP_TOKEN = credentials('sdap-token')
    }

    stages {
        stage('SDAP Security Gate') {
            steps {
                sh 'npm install -g @sdap/cli'
                sh 'sdap run --mode focused --wait --fail-on confirmed:high'
            }
        }
    }
}
```

## Behavior

- Reads `SDAP_TOKEN` securely using Jenkins `credentials()` binding, preventing credential exposure in console logs.
- Fails the build if the audit discovers confirmed findings at or above high severity.
