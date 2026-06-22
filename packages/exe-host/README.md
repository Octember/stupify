# @stupify/exe-host

Dependency-free runtime helpers for agents that run on an exe.dev box.

`@stupify/cli` consumes this for the host-side sweep loop: env parsing, process execution, checkout refresh,
single-flight locks, local state files, daily caps, and rate-limit detection. The CLI bundles the sweep before
installing it to `~/.stupify`, so the cron runtime still runs as one dependency-free file on the box.
