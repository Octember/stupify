## Code like Sindre Sorhus (@sindresorhus) · one file, one job

Radical minimalism: each module does exactly one thing and is small enough to read in five minutes. Core logic is expressed as plain functions — never classes where a closure will do. Inputs are validated and normalized eagerly at the top so failures are loud and early, never smuggled through as silent defaults. The public surface is a single callable; `Object.defineProperties` adds introspection properties without leaking internals. Comments explain the *why*, not the what.

### `index.js` — a whole concurrency limiter in one file: queue, counter, and scheduler

[source](https://github.com/sindresorhus/p-limit/blob/42599ebbbb1228a5bdab381fcf8f4ac20eb8d551/index.js)
```js
	const resumeNext = () => {
		// Process the next queued function if we're under the concurrency limit
		if (activeCount < concurrency && queue.size > 0) {
			activeCount++;
			queue.dequeue().run();
		}
	};

	const next = () => {
		activeCount--;
		resumeNext();
	};

	const run = async (function_, resolve, arguments_) => {
		// Execute the function and capture the result promise
		const result = (async () => function_(...arguments_))();

		// Resolve immediately with the promise (don't wait for completion)
		resolve(result);

		// Wait for the function to complete (success or failure)
		// We catch errors here to prevent unhandled rejections,
		// but the original promise rejection is preserved for the caller
		try {
			await result;
		} catch {}

		// Decrement active count and process next queued function
		next();
	};

	const enqueue = (function_, resolve, reject, arguments_) => {
		const queueItem = {reject};

		// Queue the internal resolve function instead of the run function
		// to preserve the asynchronous execution context.
		new Promise(internalResolve => { // eslint-disable-line promise/param-names
			queueItem.run = internalResolve;
			queue.enqueue(queueItem);
		}).then(run.bind(undefined, function_, resolve, arguments_)); // eslint-disable-line promise/prefer-await-to-then

		// Start processing immediately if we haven't reached the concurrency limit
		if (activeCount < concurrency) {
			resumeNext();
		}
	};

	const generator = (function_, ...arguments_) => new Promise((resolve, reject) => {
		enqueue(function_, resolve, reject, arguments_);
	});
```

Three named inner functions — `resumeNext`, `run`, `enqueue` — cover the entire scheduler. No class, no inheritance, no event emitter: the counter and queue are plain closure variables, and `generator` is the only thing exported. The comments explain the non-obvious async trick (resolve-with-promise-not-value) so a reader never has to guess.

### `options.js` — normalize and validate every option before anything runs

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

Every validate/normalize call runs upfront in a fixed sequence before the subprocess is ever spawned. Callers downstream receive a fully-resolved struct and never check option validity themselves. The null-prototype spread (`{__proto__: null, ...rawOptions}`) kills prototype pollution in one line rather than a guard library.

### `message.js` — one pure function, exhaustive error-reason enumeration, no inheritance

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

Every possible termination reason maps to exactly one human-readable string via priority-ordered early returns — no switch, no error subclasses, no inheritance hierarchy. The function is a pure input→string transform: the caller never has to know which reason won, and adding a new reason means adding one `if` block with one `return`.
