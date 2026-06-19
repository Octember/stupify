## Code like Simon Willison (@simonw) · one concept per file

Every file has exactly one job and says so in its name. Pure functions registered via `@hookimpl` replace classes wherever possible; where a class is necessary, it is small and data-shaped (a dataclass or a namedtuple). Type logic is expressed as explicit set arithmetic on Python's own type objects rather than string tags or nested conditionals, and error handling routes by exception type first, then by response format — never by catching `Exception` broadly. The result is code you can read top-to-bottom without a map.

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
The entire file is one bounded concept: five pure functions, each named after the SQL magic parameter it handles, collected at the bottom by one `@hookimpl`. There is no class, no shared state — adding a new parameter means adding one function and one tuple entry.

### `handle_exception.py` — error handling: classify by exception type, route by content-type
[source](https://github.com/simonw/datasette/blob/dfd5b95ec8adc425b683df22148cb1c14bb01128/datasette/handle_exception.py)
```python
@hookimpl(trylast=True)
def handle_exception(datasette, request, exception):
    async def inner():
        if datasette.pdb:
            pdb.post_mortem(exception.__traceback__)

        if rich is not None:
            rich.get_console().print_exception(show_locals=True)

        title = None
        if isinstance(exception, Base400):
            status = exception.status
            info = {}
            message = exception.args[0]
        elif isinstance(exception, DatasetteError):
            status = exception.status
            info = exception.error_dict
            message = exception.message
            if exception.message_is_html:
                message = Markup(message)
            title = exception.title
        else:
            status = 500
            info = {}
            message = str(exception)
            traceback.print_exc()
        templates = [f"{status}.html", "error.html"]
        info.update(
            {
                "ok": False,
                "error": message,
                "status": status,
                "title": title,
            }
        )
        headers = {}
        if datasette.cors:
            add_cors_headers(headers)
        if request.path.split("?")[0].endswith(".json"):
            return Response.json(info, status=status, headers=headers)
        else:
            environment = datasette.get_jinja_environment(request)
            template = environment.select_template(templates)
            return Response.html(
                await template.render_async(
                    dict(
                        info,
                        urls=datasette.urls,
                        app_css_hash=datasette.app_css_hash(),
                        menu_links=lambda: [],
                    )
                ),
                status=status,
                headers=headers,
            )

    return inner
```
Error handling is one `isinstance` chain that maps each exception class to a status code, then a single content-type branch at the bottom routes JSON vs. HTML — no try/except swallowing, no generic catch-all message. The whole handler is a `@hookimpl(trylast=True)` so other plugins can intercept first.

### `events.py` — typed dataclass events: abstract base, concrete subclasses, no string tags
[source](https://github.com/simonw/datasette/blob/dfd5b95ec8adc425b683df22148cb1c14bb01128/datasette/events.py)
```python
@dataclass
class Event(ABC):
    @abstractproperty
    def name(self):
        pass

    created: datetime = field(
        init=False, default_factory=lambda: datetime.now(timezone.utc)
    )
    actor: dict | None

    def properties(self):
        properties = asdict(self)
        properties.pop("actor", None)
        properties.pop("created", None)
        return properties


@dataclass
class LoginEvent(Event):
    """
    Event name: ``login``

    A user (represented by ``event.actor``) has logged in.
    """

    name = "login"
```
Events are plain dataclasses that inherit a shared `created` timestamp and a `properties()` serialiser; each subclass is just a class-level `name` constant plus typed fields. No string event buses, no dicts — the type itself is the contract.

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
```
The full type-coercion lattice (null → str, bool ⊂ int ⊂ float, containers → JSON str) is expressed as set operations on Python's own type objects — no string tags, no enums, no switch tables. Each branch is one readable predicate: `{int, bool}.issuperset(types)`.

### `filters.py` — parameterised SQL as data: the TemplatedFilter class hierarchy
[source](https://github.com/simonw/datasette/blob/dfd5b95ec8adc425b683df22148cb1c14bb01128/datasette/filters.py)
```python
class TemplatedFilter(Filter):
    def __init__(
        self,
        key,
        display,
        sql_template,
        human_template,
        format="{}",
        numeric=False,
        no_argument=False,
    ):
        self.key = key
        self.display = display
        self.sql_template = sql_template
        self.human_template = human_template
        self.format = format
        self.numeric = numeric
        self.no_argument = no_argument

    def where_clause(self, table, column, value, param_counter):
        converted = self.format.format(value)
        if self.numeric and converted.isdigit():
            converted = int(converted)
        if self.no_argument:
            kwargs = {"c": column}
            converted = None
        else:
            kwargs = {"c": column, "p": f"p{param_counter}", "t": table}
        return self.sql_template.format(**kwargs), converted

    def human_clause(self, column, value):
        if callable(self.human_template):
            template = self.human_template(column, value)
        else:
            template = self.human_template
        if self.no_argument:
            return template.format(c=column)
        else:
            return template.format(c=column, v=value)


class InFilter(Filter):
    key = "in"
    display = "in"

    def split_value(self, value):
        if value.startswith("["):
            return json.loads(value)
        else:
            return [v.strip() for v in value.split(",")]

    def where_clause(self, table, column, value, param_counter):
        values = self.split_value(value)
        params = [f":p{param_counter + i}" for i in range(len(values))]
        sql = f"{escape_sqlite(column)} in ({', '.join(params)})"
        return sql, values

    def human_clause(self, column, value):
        return f"{column} in {json.dumps(self.split_value(value))}"
```
Each filter type is a small class that carries its SQL template and its human-readable label together; `TemplatedFilter` lets you instantiate a filter from data (key, display string, SQL string, human string) rather than writing a subclass. Every `where_clause` returns `(sql, converted_value)` — the same shape, no side effects.

### `db.py` — the dual-mode decorator: `register_function` with and without arguments
[source](https://github.com/simonw/sqlite-utils/blob/8f0c06e1889513ed0f01cb57783ddf07c442d4be/sqlite_utils/db.py)
```python
    def register_function(
        self,
        fn: Optional[Callable] = None,
        deterministic: bool = False,
        replace: bool = False,
        name: Optional[str] = None,
    ) -> Optional[Callable[[Callable], Callable]]:
        """
        ``fn`` will be made available as a function within SQL, with the same name and number
        of arguments. Can be used as a decorator::

            @db.register_function
            def upper(value):
                return str(value).upper()

        The decorator can take arguments::

            @db.register_function(deterministic=True, replace=True)
            def upper(value):
                return str(value).upper()

        See :ref:`python_api_register_function`.

        :param fn: Function to register
        :param deterministic: set ``True`` for functions that always returns the same output for a given input
        :param replace: set ``True`` to replace an existing function with the same name - otherwise throw an error
        :param name: name of the SQLite function - if not specified, the Python function name will be used
        """

        def register(fn: Callable) -> Callable:
            fn_name = name or fn.__name__  # type: ignore
            arity = len(inspect.signature(fn).parameters)
            if not replace and (fn_name, arity) in self._registered_functions:
                return fn
            kwargs: Dict[str, bool] = {}
            registered = False
            if deterministic:
                # Try this, but fall back if sqlite3.NotSupportedError
                try:
                    self.conn.create_function(
                        fn_name, arity, fn, **dict(kwargs, deterministic=True)
                    )
                    registered = True
                except sqlite3.NotSupportedError:
                    pass
            if not registered:
                self.conn.create_function(fn_name, arity, fn, **kwargs)
            self._registered_functions.add((fn_name, arity))
            return fn

        if fn is None:
            return register
        else:
            register(fn)
            return None
```
The classic optional-argument decorator idiom: if `fn is None` the caller passed keyword args, so return the inner `register` closure; otherwise call it immediately. Arity is detected via `inspect.signature` so users never declare it; `deterministic=True` is tried first and silently degrades on old SQLite — one specific `except`, never bare `except Exception`.

### `test_fts.py` — test shape: real fixture data, real queries, assert on exact output
[source](https://github.com/simonw/sqlite-utils/blob/8f0c06e1889513ed0f01cb57783ddf07c442d4be/tests/test_fts.py)
```python
search_records = [
    {
        "text": "tanuki are running tricksters",
        "country": "Japan",
        "not_searchable": "foo",
    },
    {
        "text": "racoons are biting trash pandas",
        "country": "USA",
        "not_searchable": "bar",
    },
]


def test_enable_fts(fresh_db):
    table = fresh_db["searchable"]
    table.insert_all(search_records)
    assert ["searchable"] == fresh_db.table_names()
    table.enable_fts(["text", "country"], fts_version="FTS4")
    assert [
        "searchable",
        "searchable_fts",
        "searchable_fts_segments",
        "searchable_fts_segdir",
        "searchable_fts_docsize",
        "searchable_fts_stat",
    ] == fresh_db.table_names()
    assert [
        {
            "rowid": 1,
            "text": "tanuki are running tricksters",
            "country": "Japan",
            "not_searchable": "foo",
        }
    ] == list(table.search("tanuki"))
    assert [
        {
            "rowid": 2,
            "text": "racoons are biting trash pandas",
            "country": "USA",
            "not_searchable": "bar",
        }
    ] == list(table.search("usa"))
    assert [] == list(table.search("bar"))
```
Tests use a module-level fixture of real-shaped dicts, insert them into a real in-memory SQLite database via `fresh_db`, then assert on the complete returned dict — no mocks, no `assert result is not None`, no counting. Each assertion verifies the full output including fields that should not be searched (`not_searchable`), so the test doubles as a spec.
