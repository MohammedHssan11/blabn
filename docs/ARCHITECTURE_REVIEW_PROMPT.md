# First-Agent Onboarding Prompt

Copy the block below into Claude or Codex in a session with GitHub access.

```text
Help me get oriented in the Balaban Maarif branch operations project. Open the private GitHub repository and read its project documentation.

Repository: https://github.com/MohammedHssan11/blabn
Branch with the current documentation: main

Use my authorized GitHub account. If you have a terminal and the repository is not downloaded, run:

    git clone --branch main https://github.com/MohammedHssan11/blabn.git
    cd blabn
    git status -sb

If a checkout already exists, fetch `origin main` and read `origin/main` while preserving local work. If the session only has a GitHub connection, read `main` through it and say how you accessed the files. If access fails, report the error and identify which GitHub account or connection needs attention.

Read these Markdown files:
1. README.md
2. docs/PROJECT_CONTEXT.md
3. docs/REQUIREMENTS.md
4. docs/DATA_AND_REPORTS.md
5. docs/SOURCE_MATERIAL.md
6. docs/DECISIONS.md
7. docs/ARCHITECTURE.md
8. docs/HANDOFF.md and docs/IMPLEMENTATION_PLAN.md
9. docs/phase4/ABDO_DECISIONS.md for the confirmed rules to use when working on daily close

Use the documents to understand why the branch wants to enter each business day once, what the future application should cover, what is planned for later, and what is already present in the repository. Use the source inventory only to understand what reference material is available.

Reply in the chat with the branch you read, whether you could clone it, and a brief summary of the project goal, daily workflow, and current development stage. End the task at this onboarding summary. Leave Excel formulas, reconciliation, architecture review, and implementation for their own tasks. Treat the checkout as read-only after cloning or fetching.
```
