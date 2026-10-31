Feature: Merge to main deploys once, after green CI
  Amplify builds only deploy. GitHub Actions runs the checks, and a green push to main starts the one Amplify job.

  Scenario: Merge to main deploys once, after green CI
    Given Amplify auto-build is off on the main branch of app d12wnrx15qbcc2
    When a commit is pushed to main and the CI job passes
    Then the deploy job assumes the threat-intelligence-github-deploy role through GitHub OIDC
    And it starts exactly one Amplify release job for that commit
    And a failing CI job starts no Amplify job
