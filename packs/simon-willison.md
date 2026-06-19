## Code like Simon Willison (@simonw) · one concept per file

(Yes — the person who coined "slop".) Plugin-first design: every extension point is a named hookspec, declared
before it's implemented. One concept per file (`recipes.py`, `events.py`, `hookspecs.py`). Dataclasses for
typed events and data. Sentinel values over magic booleans. Docstrings explain the contract, not the
implementation. Small, obvious, testable seams.

- [`recipes.py`](https://github.com/simonw/sqlite-utils/blob/8f0c06e1889513ed0f01cb57783ddf07c442d4be/sqlite_utils/recipes.py) — one concept per module: small, composable transforms.
- [`hookspecs.py`](https://github.com/simonw/sqlite-utils/blob/8f0c06e1889513ed0f01cb57783ddf07c442d4be/sqlite_utils/hookspecs.py) — plugin seams declared up front, before any implementation.
- [`events.py`](https://github.com/simonw/datasette/blob/dfd5b95ec8adc425b683df22148cb1c14bb01128/datasette/events.py) — typed dataclass events instead of loose dicts.
