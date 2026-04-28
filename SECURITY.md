# Security Policy

Stupify is local-only diagnostic tooling. Security issues are taken seriously
because the tool touches source code, diffs, commit metadata, and local model
runtime configuration.

## Supported Versions

Only the latest published `@stupify/cli` version is supported for security
fixes.

## Reporting a Vulnerability

Report vulnerabilities through GitHub private vulnerability reporting for this
repository. If private reporting is unavailable, contact the maintainer through
GitHub before sharing details publicly.

Do not include private source code, diffs, commit messages, filenames, repo
URLs, author names, private package names, model prompts, or local logs unless
they are necessary to understand the issue and you have permission to share
them.

Good reports include:

- affected Stupify version
- operating system and runtime versions
- a minimal reproduction using synthetic code or a public fixture
- expected and actual behavior
- whether private data could leave the machine or be exposed locally

## Scope

In scope:

- unintended upload or disclosure of local source, diffs, filenames, repo URLs,
  commit messages, author names, or private package names
- command injection, path traversal, unsafe hook installation, or unsafe local
  process management
- npm package integrity, release provenance, or dependency supply-chain issues
- local model server behavior that exposes private data beyond localhost

Out of scope:

- model quality issues without a security or privacy impact
- reports that require access to private third-party repositories without
  authorization
- denial-of-service reports based only on intentionally huge local inputs, unless
  they cross a trust boundary

## Disclosure

Please give the maintainer time to investigate and publish a fix before public
disclosure. Security releases should use the normal release process in
[docs/releasing.md](docs/releasing.md) unless a different response is needed for
the incident.
