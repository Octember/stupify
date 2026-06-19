## Code like Simon Willison (@simonw) · one concept per file

Every file has exactly one job and says so in its name. Plugins are pure functions registered via hookimpl — no classes, no inheritance, no shared state. Typed dataclasses carry events; sentinel objects replace magic booleans; type-inference logic is expressed as explicit set arithmetic rather than nested conditionals. The result is code you can read top-to-bottom in 30 seconds and test in isolation.

### `default_magic_parameters.py` — one file, one concept: SQL magic parameters as plain functions
[source](https://github.com/simonw/datasette/blob/dfd5b95ec8adc425b683df22148cb1c14bb01128/datasette/default_magic_parameters.py)
```python
from datasette import hookimpl
import datetime
import os
import time


def header(key, request):
    key = key.replace("_", "-").encode("utf-8")
    headers_dict = dict(request.scope["headers"])
    return headers_dict.get(key, b"").decode("utf-8")


def actor(key, request):
    if request.actor is None:
        raise KeyError
    return request.actor[key]


def cookie(key, request):
    return request.cookies[key]


def now(key, request):
    if key == "epoch":
        return int(time.time())
    elif key == "date_utc":
        return datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    elif key == "datetime_utc":
        return (
            datetime.datetime.now(datetime.timezone.utc).strftime(r"%Y-%m-%dT%H:%M:%S")
            + "Z"
        )
    else:
        raise KeyError


def random(key, request):
    if key.startswith("chars_") and key.split("chars_")[-1].isdigit():
        num_chars = int(key.split("chars_")[-1])
        if num_chars % 2 == 1:
            urandom_len = (num_chars + 1) / 2
        else:
            urandom_len = num_chars / 2
        return os.urandom(int(urandom_len)).hex()[:num_chars]
    else:
        raise KeyError


@hookimpl
def register_magic_parameters():
    return [
        ("header", header),
        ("actor", actor),
        ("cookie", cookie),
        ("now", now),
        ("random", random),
    ]
```
The entire file is a single bounded concept: five pure functions, each named after the SQL magic parameter it handles, collected at the bottom by one hookimpl. There is no class, no shared state, no indirection — adding a new parameter means adding one function and one tuple entry.

### `utils.py` — type inference as explicit set arithmetic, not nested ifs
[source](https://github.com/simonw/sqlite-utils/blob/8f0c06e1889513ed0f01cb57783ddf07c442d4be/sqlite_utils/utils.py)
```python
def types_for_column_types(
    all_column_types: Dict[str, Set[type]],
) -> Dict[str, type]:
    column_types: Dict[str, type] = {}
    for key, types in all_column_types.items():
        # Ignore null values if at least one other type present:
        if len(types) > 1:
            types.discard(None.__class__)
        t: type
        if {None.__class__} == types:
            t = str
        elif len(types) == 1:
            t = list(types)[0]
            # But if it's a subclass of list / tuple / dict, use str
            # instead as we will be storing it as JSON in the table
            for superclass in (list, tuple, dict):
                if issubclass(t, superclass):
                    t = str
        elif {int, bool}.issuperset(types):
            t = int
        elif {int, float, bool}.issuperset(types):
            t = float
        elif {bytes, str}.issuperset(types):
            t = bytes
        else:
            t = str
        column_types[key] = t
    return column_types


def column_affinity(column_type: str) -> type:
    # Implementation of SQLite affinity rules from
    # https://www.sqlite.org/datatype3.html#determination_of_column_affinity
    assert isinstance(column_type, str)
    column_type = column_type.upper().strip()
    if column_type == "":
        return str  # We differ from spec, which says it should be BLOB
    if "INT" in column_type:
        return int
    if "CHAR" in column_type or "CLOB" in column_type or "TEXT" in column_type:
        return str
    if "BLOB" in column_type:
        return bytes
    if "REAL" in column_type or "FLOA" in column_type or "DOUB" in column_type:
        return float
    # Default is 'NUMERIC', which we currently also treat as float
    return float
```
`types_for_column_types` encodes the full type-coercion lattice (null → str, bool ⊂ int ⊂ float, containers → JSON str) as set operations on Python's own type objects — no string tags, no enums, no switch tables. `column_affinity` mirrors the SQLite spec line-by-line with a note when it deliberately diverges. Two functions, two concepts, both testable with a dict literal.

### `events.py` — before/after snapshot via generator, typed event emission
[source](https://github.com/simonw/datasette/blob/dfd5b95ec8adc425b683df22148cb1c14bb01128/datasette/events.py)
```python
@hookimpl
def write_wrapper(datasette, database, request, transaction):
    def wrapper(conn, track_event):
        # Snapshot rootpage -> name before the write
        before = {
            row[1]: row[0]
            for row in conn.execute(
                "select name, rootpage from sqlite_master"
                " where type='table' and rootpage != 0"
            ).fetchall()
        }
        yield
        # Snapshot rootpage -> name after the write
        after = {
            row[1]: row[0]
            for row in conn.execute(
                "select name, rootpage from sqlite_master"
                " where type='table' and rootpage != 0"
            ).fetchall()
        }
        # Detect renames: same rootpage, different name
        for rootpage, old_name in before.items():
            new_name = after.get(rootpage)
            if new_name and new_name != old_name:
                track_event(
                    RenameTableEvent(
                        actor=request.actor if request else None,
                        database=database,
                        old_table=old_name,
                        new_table=new_name,
                    )
                )

    return wrapper
```
The rename-detection logic lives entirely in this generator: snapshot rootpage→name before `yield`, diff after, emit a typed `RenameTableEvent` dataclass for each change. No booleans, no string event names, no catch-all dicts — the event type is the contract, and the `track_event` callback is the only coupling point.
