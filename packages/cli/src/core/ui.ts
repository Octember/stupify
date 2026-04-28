import {
  confirm as clackConfirm,
  intro as clackIntro,
  isCancel,
  log,
  note,
  outro as clackOutro,
  progress,
  spinner,
  type SpinnerResult,
} from "@clack/prompts";
import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from "node:fs";
import { platform } from "node:os";
import { stdin, stderr, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import pc from "picocolors";

export type CliUi = ReturnType<typeof createCliUi>;

export type CliUiOptions = Readonly<{
  quiet?: boolean;
}>;

type LogOptions = Readonly<{
  force?: boolean;
}>;

type PromptIo = Readonly<{
  input: Readable;
  output: Writable;
  close: () => void;
}>;

export function createCliUi(options: CliUiOptions = {}) {
  const quiet = options.quiet ?? false;
  const output = stderr;

  function shouldWrite(logOptions?: LogOptions): boolean {
    return logOptions?.force === true || !quiet;
  }

  function withPromptIo<T>(
    run: (io: PromptIo) => Promise<T>,
  ): Promise<T> {
    const io = promptIo();
    return run(io).finally(() => io.close());
  }

  return {
    intro(title: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) clackIntro(title, { output });
    },

    outro(message: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) clackOutro(message, { output });
    },

    note(message: string, title?: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) note(message, title, { output });
    },

    info(message: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) log.info(message, { output });
    },

    step(message: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) log.step(message, { output });
    },

    success(message: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) log.success(message, { output });
    },

    warn(message: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) log.warn(message, { output });
    },

    error(message: string, logOptions?: LogOptions): void {
      if (shouldWrite(logOptions)) log.error(message, { output });
    },

    debug(message: string): void {
      if (!quiet) log.message(message, { output, symbol: pc.dim("trace") });
    },

    clearScreen(): void {
      if (!quiet && output.isTTY) output.write("\x1b[2J\x1b[H");
    },

    async confirm(message: string): Promise<boolean> {
      return withPromptIo(async (io) => {
        const result = await clackConfirm({
          message,
          active: "Yes",
          inactive: "No",
          initialValue: false,
          input: io.input,
          output: io.output,
        });
        if (isCancel(result)) return false;
        return result;
      });
    },

    spinner(message: string, logOptions?: LogOptions): SpinnerResult {
      if (!shouldWrite(logOptions)) return silentSpinner();
      const active = spinner({ output });
      active.start(message);
      return active;
    },

    progress(message: string, max: number, logOptions?: LogOptions) {
      if (!shouldWrite(logOptions)) return silentProgress();
      const active = progress({ output, max });
      active.start(message);
      return active;
    },

    writeStdout(text: string): void {
      stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    },

    writeStderr(text: string): void {
      if (!quiet) output.write(text.endsWith("\n") ? text : `${text}\n`);
    },
  };
}

export const format = {
  heading: (value: string) => pc.bold(value),
  label: (value: string) => pc.cyan(value),
  muted: (value: string) => pc.dim(value),
  success: (value: string) => pc.green(value),
  warn: (value: string) => pc.yellow(value),
  error: (value: string) => pc.red(value),
};

export function diagnostic(message: string): void {
  log.message(message, {
    output: stderr,
    symbol: pc.dim("·"),
    spacing: 0,
    withGuide: false,
  });
}

export function diagnosticError(message: string): void {
  log.error(message, { output: stderr, spacing: 0, withGuide: false });
}

function promptIo(): PromptIo {
  if (stdin.isTTY && stderr.isTTY) {
    return { input: stdin, output: stderr, close: () => undefined };
  }

  if (platform() === "win32") {
    throw new Error(
      "No interactive terminal found. Run `stupify` once in an interactive terminal to set up the model.",
    );
  }

  const input = createReadStream("/dev/tty");
  const output = createWriteStream("/dev/tty");
  return {
    input,
    output,
    close: () => closePromptIo(input, output),
  };
}

function closePromptIo(input: ReadStream, output: WriteStream): void {
  input.destroy();
  output.end();
}

function silentSpinner(): SpinnerResult {
  return {
    start: () => undefined,
    stop: () => undefined,
    cancel: () => undefined,
    error: () => undefined,
    message: () => undefined,
    clear: () => undefined,
    get isCancelled() {
      return false;
    },
  };
}

function silentProgress() {
  return {
    ...silentSpinner(),
    advance: () => undefined,
  };
}
