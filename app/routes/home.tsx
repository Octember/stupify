import { useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stupify - Is your codebase devolving into AI slop?" },
    {
      name: "description",
      content:
        "A local-only CLI for checking whether AI is turning your codebase into slop.",
    },
  ];
}

const COMMAND = "npx @stupify/cli --commit HEAD";

export default function Home() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <nav className="flex items-center justify-between text-sm">
          <a href="/" className="font-semibold tracking-tight text-white">
            stupify
          </a>
        </nav>

        <div className="flex flex-1 flex-col justify-center py-16">
          <p className="mb-5 text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">
            AI code audit
          </p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-none tracking-tight text-white sm:text-7xl">
            Is your codebase devolving into AI slop?
          </h1>
          <p className="mt-6 max-w-2xl text-2xl leading-9 text-zinc-300">
            Probably - let's find out.
          </p>

          <div className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row">
            <code className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100">
              {COMMAND}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg bg-zinc-100 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="mt-5 max-w-xl text-sm leading-6 text-zinc-600">
            Privacy first. No code ever leaves your machine
          </p>
        </div>
      </section>
    </main>
  );
}
