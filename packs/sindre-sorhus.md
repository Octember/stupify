## Code like Sindre Sorhus (@sindresorhus) · one file, one job

Radical minimalism: each module does exactly one thing and is small enough to read in five minutes. State lives in closures, never in classes; the public surface is a single callable decorated with `Object.defineProperties` so introspection properties stay non-enumerable and non-leaking. Options are validated and normalized in one upfront pass so every downstream function receives a fully-resolved struct. Error paths enumerate every failure reason via priority-ordered early returns — one `if`, one `return`, no inheritance hierarchy. Comments explain the non-obvious *why* (the async resolve-with-promise trick, the `__proto__: null` pollution guard), not the what.

### `index.js` — module shape: closure state, single callable, `Object.defineProperties` for the public surface
[source](https://github.com/sindresorhus/p-limit/blob/42599ebbbb1228a5bdab381fcf8f4ac20eb8d551/index.js)
```js
export default function pLimit(concurrency) {
	let rejectOnClear = false;

	if (typeof concurrency === 'object') {
		({concurrency, rejectOnClear = false} = concurrency);
	}

	validateConcurrency(concurrency);

	if (typeof rejectOnClear !== 'boolean') {
		throw new TypeError('Expected `rejectOnClear` to be a boolean');
	}

	const queue = new Queue();
	let activeCount = 0;
```

Input is unpacked and fully validated before any internal state is allocated. The options object shorthand (`typeof concurrency === 'object'`) lets a single function accept both the legacy scalar form and the new named-options form with no overloaded signatures.

### `index.js` — the public API surface: `Object.defineProperties` over a plain callable, no class
[source](https://github.com/sindresorhus/p-limit/blob/42599ebbbb1228a5bdab381fcf8f4ac20eb8d551/index.js)
```js
	Object.defineProperties(generator, {
		activeCount: {
			get: () => activeCount,
		},
		pendingCount: {
			get: () => queue.size,
		},
		clearQueue: {
			value() {
				if (!rejectOnClear) {
					queue.clear();
					return;
				}

				const abortError = AbortSignal.abort().reason;

				while (queue.size > 0) {
					queue.dequeue().reject(abortError);
				}
			},
		},
		concurrency: {
			get: () => concurrency,

			set(newConcurrency) {
				validateConcurrency(newConcurrency);
				concurrency = newConcurrency;

				queueMicrotask(() => {
					// eslint-disable-next-line no-unmodified-loop-condition
					while (activeCount < concurrency && queue.size > 0) {
						resumeNext();
					}
				});
			},
		},
		map: {
			async value(iterable, function_) {
				const promises = Array.from(iterable, (value, index) => this(function_, value, index));
				return Promise.all(promises);
			},
		},
	});

	return generator;
}
```

`generator` is a plain function — callers invoke it like `limit(fn)` — but `Object.defineProperties` bolts on read-only getters and methods. Internals (`queue`, `activeCount`) stay in the closure and never appear on the returned object. The `concurrency` setter re-drains via `queueMicrotask` so dynamic resizing is non-blocking.

### `test.js` — test shape: real timing with `timeSpan` + `inRange`, no mocks
[source](https://github.com/sindresorhus/p-limit/blob/42599ebbbb1228a5bdab381fcf8f4ac20eb8d551/test.js)
```js
test('concurrency: 1', async t => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100],
	];

	const end = timeSpan();
	const limit = pLimit(1);

	const mapper = ([value, ms]) => limit(async () => {
		await delay(ms);
		return value;
	});

	t.deepEqual(await Promise.all(input.map(x => mapper(x))), [10, 20, 30]);
	t.true(inRange(end(), {start: 590, end: 650}));
});

test('concurrency: 4', async t => {
	const concurrency = 5;
	let running = 0;

	const limit = pLimit(concurrency);

	const input = Array.from({length: 100}, () => limit(async () => {
		running++;
		t.true(running <= concurrency);
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});
```

Tests verify observable behavior at the boundary — wall-clock ordering and live concurrency counts — not internal state. `timeSpan` + `inRange` assert timing without brittle exact matches. There are no mocks: the library runs against real async operations.

### `lib/arguments/options.js` — normalize-before-use: one upfront sequential pass, then a clean struct downstream
[source](https://github.com/sindresorhus/execa/blob/f3a2e8481a1e9138de3895827895c834078b9456/lib/arguments/options.js)
```js
// Normalize the options object, and sometimes also the file paths and arguments.
// Applies default values, validate allowed options, normalize them.
export const normalizeOptions = (filePath, rawArguments, rawOptions) => {
	// Prevent prototype pollution by copying only own properties to a null-prototype object
	const sanitizedOptions = {__proto__: null, ...rawOptions};
	sanitizedOptions.cwd = normalizeCwd(sanitizedOptions.cwd);
	const [processedFile, processedArguments, processedOptions] = handleNodeOption(filePath, rawArguments, sanitizedOptions);

	const {command: file, args: commandArguments, options: initialOptions} = crossSpawn._parse(processedFile, processedArguments, processedOptions);

	const fdOptions = normalizeFdSpecificOptions(initialOptions);
	const options = addDefaultOptions(fdOptions);
	validateTimeout(options);
	validateEncoding(options);
	validateIpcInputOption(options);
	validateCancelSignal(options);
	validateGracefulCancel(options);
	options.shell = normalizeFileUrl(options.shell);
	options.env = getEnv(options);
	options.killSignal = normalizeKillSignal(options.killSignal);
	options.forceKillAfterDelay = normalizeForceKillAfterDelay(options.forceKillAfterDelay);
	options.lines = options.lines.map((lines, fdNumber) => lines && !BINARY_ENCODINGS.has(options.encoding) && options.buffer[fdNumber]);

	if (process.platform === 'win32' && path.basename(file, '.exe') === 'cmd') {
		// #116
		commandArguments.unshift('/q');
	}

	return {file, commandArguments, options};
};
```

Every validate/normalize call runs in a fixed sequence before the subprocess is ever spawned. Callers downstream receive a fully-resolved struct and never check option validity themselves. The `{__proto__: null, ...rawOptions}` spread kills prototype pollution in one line rather than a guard library.

### `lib/return/message.js` — error reason enumeration: priority-ordered early returns, no subclasses
[source](https://github.com/sindresorhus/execa/blob/f3a2e8481a1e9138de3895827895c834078b9456/lib/return/message.js)
```js
const getErrorPrefix = ({
	originalError,
	timedOut,
	timeout,
	isMaxBuffer,
	maxBuffer,
	errorCode,
	signal,
	signalDescription,
	exitCode,
	isCanceled,
	isGracefullyCanceled,
	isForcefullyTerminated,
	forceKillAfterDelay,
	killSignal,
}) => {
	const forcefulSuffix = getForcefulSuffix(isForcefullyTerminated, forceKillAfterDelay);

	if (timedOut) {
		return `Command timed out after ${timeout} milliseconds${forcefulSuffix}`;
	}

	if (isGracefullyCanceled) {
		if (signal === undefined) {
			return `Command was gracefully canceled with exit code ${exitCode}`;
		}

		return isForcefullyTerminated
			? `Command was gracefully canceled${forcefulSuffix}`
			: `Command was gracefully canceled with ${signal} (${signalDescription})`;
	}

	if (isCanceled) {
		return `Command was canceled${forcefulSuffix}`;
	}

	if (isMaxBuffer) {
		return `${getMaxBufferMessage(originalError, maxBuffer)}${forcefulSuffix}`;
	}

	if (errorCode !== undefined) {
		return `Command failed with ${errorCode}${forcefulSuffix}`;
	}

	if (isForcefullyTerminated) {
		return `Command was killed with ${killSignal} (${getSignalDescription(killSignal)})${forcefulSuffix}`;
	}

	if (signal !== undefined) {
		return `Command was killed with ${signal} (${signalDescription})`;
	}

	if (exitCode !== undefined) {
		return `Command failed with exit code ${exitCode}`;
	}

	return 'Command failed';
};
```

Every possible termination reason maps to exactly one human-readable string via priority-ordered early returns — no switch, no error subclasses, no inheritance hierarchy. The function is a pure input→string transform; adding a new reason means adding one `if` block with one `return`.

### `lib/return/final-error.js` — error class wiring: `Object.defineProperty` for non-enumerable name, cross-realm identity via Symbol
[source](https://github.com/sindresorhus/execa/blob/f3a2e8481a1e9138de3895827895c834078b9456/lib/return/final-error.js)
```js
// When the subprocess fails, this is the error instance being returned.
// If another error instance is being thrown, it is kept as `error.cause`.
export const getFinalError = (originalError, message, isSync) => {
	const ErrorClass = isSync ? ExecaSyncError : ExecaError;
	const options = originalError instanceof DiscardedError ? {} : {cause: originalError};
	return new ErrorClass(message, options);
};

// Indicates that the error is used only to interrupt control flow, but not in the return value
export class DiscardedError extends Error {}

// Proper way to set `error.name`: it should be inherited and non-enumerable
const setErrorName = (ErrorClass, value) => {
	Object.defineProperty(ErrorClass.prototype, 'name', {
		value,
		writable: true,
		enumerable: false,
		configurable: true,
	});
	Object.defineProperty(ErrorClass.prototype, execaErrorSymbol, {
		value: true,
		writable: false,
		enumerable: false,
		configurable: false,
	});
};

// Unlike `instanceof`, this works across realms
export const isExecaError = error => isErrorInstance(error) && execaErrorSymbol in error;

const execaErrorSymbol = Symbol('isExecaError');

export const isErrorInstance = value => Object.prototype.toString.call(value) === '[object Error]';

// We use two different Error classes for async/sync methods since they have slightly different shape and types
export class ExecaError extends Error {}
setErrorName(ExecaError, ExecaError.name);

export class ExecaSyncError extends Error {}
setErrorName(ExecaSyncError, ExecaSyncError.name);
```

`error.name` is set via `Object.defineProperty` (non-enumerable, inherited from the prototype) rather than a class field — the comment explains why. Cross-realm identity uses a Symbol-keyed property instead of `instanceof` since `instanceof` breaks across VM contexts. A `DiscardedError` sentinel class separates control-flow errors from user-facing ones so they never bleed into return values.

### `lib/verbose/default.js` — data-table dispatch: two object literals replace a switch across message types
[source](https://github.com/sindresorhus/execa/blob/f3a2e8481a1e9138de3895827895c834078b9456/lib/verbose/default.js)
```js
// Default when `verbose` is not a function
export const defaultVerboseFunction = ({
	type,
	message,
	timestamp,
	piped,
	commandId,
	result: {failed = false} = {},
	options: {reject = true},
}) => {
	const timestampString = serializeTimestamp(timestamp);
	const icon = ICONS[type]({failed, reject, piped});
	const color = COLORS[type]({reject});
	return `${gray(`[${timestampString}]`)} ${gray(`[${commandId}]`)} ${color(icon)} ${color(message)}`;
};

// Prepending the timestamp allows debugging the slow paths of a subprocess
const serializeTimestamp = timestamp => `${padField(timestamp.getHours(), 2)}:${padField(timestamp.getMinutes(), 2)}:${padField(timestamp.getSeconds(), 2)}.${padField(timestamp.getMilliseconds(), 3)}`;

const padField = (field, padding) => String(field).padStart(padding, '0');

const getFinalIcon = ({failed, reject}) => {
	if (!failed) {
		return figures.tick;
	}

	return reject ? figures.cross : figures.warning;
};

const ICONS = {
	command: ({piped}) => piped ? '|' : '$',
	output: () => ' ',
	ipc: () => '*',
	error: getFinalIcon,
	duration: getFinalIcon,
};

const identity = string => string;

const COLORS = {
	command: () => bold,
	output: () => identity,
	ipc: () => identity,
	error: ({reject}) => reject ? redBright : yellowBright,
	duration: () => gray,
};
```

`ICONS` and `COLORS` are plain object literals keyed by message type — functions that receive only what they need. There is no switch, no if-chain per type. Adding a new message type means adding one key to each table; the dispatch in `defaultVerboseFunction` never changes. Destructuring with defaults (`result: {failed = false} = {}`) handles the absent-result case inline.
