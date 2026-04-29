import { useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stupify - Flag suspect AI slop commits" },
    {
      name: "description",
      content:
        "An open source CLI that reads your commit history and flags suspect AI slop commits.",
    },
  ];
}

const COMMAND = "npx @stupify/cli@latest";

const SLOP_EXAMPLES = [
  {
    label: "Duplicated Schema",
    code: `type TimelineDragPayload = {
  dragSource: "timeline";
  type: ItemType["type"] | undefined;
  clip: ItemType | null;
  clipId: ClipId;
  width: number;
  clipIndex: number;
  trackIndex: number;
};`,
    match:
      "Local payload mirrors ItemType instead of reusing the source of truth.",
    why:
      "Duplicated shapes make it easier for AI-assisted changes to drift away from the real model.",
  },
  {
    label: "Pointless Wrapper",
    code: `function clampValue(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}`,
    match:
      "Tiny generic helper recreates a common utility with no domain behavior.",
    why:
      "Generic helper reinvention can be a sign that the change optimized for plausible code over local reuse.",
  },
  {
    label: "Comment Sludge",
    code: `// Check if the user exists
if (user) {
  // Return the user data
  return user;
}`,
    match:
      "Comments narrate obvious control flow instead of explaining a tradeoff.",
    why:
      "Narrative comments can make routine code look deliberate without adding judgment.",
  },
];

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
      <section className="mx-auto flex min-h-[88svh] w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
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

          <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-300">
            stupify is a open source CLI that reads your commit history and
            flags suspect AI slop commits
          </p>

          <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-600">
            Stupify uses Gemma, an open source model on your machine, to analyze
            recent commits. No data ever leaves your machine.
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-900 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-red-400">
            Sludge examples
          </p>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Stuff you recognize before you can explain why it feels bad.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
            Stupify is not trying to review everything. It looks for concrete
            signs that AI-assisted commits got padded with plausible-looking
            junk.
          </p>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {SLOP_EXAMPLES.map((example) => (
              <article
                key={example.label}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50"
              >
                <div className="border-b border-zinc-800 px-4 py-3">
                  <h3 className="text-base font-semibold text-white">
                    {example.label}
                  </h3>
                </div>
                <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-zinc-300">
                  <code>{example.code}</code>
                </pre>
                <div className="border-t border-zinc-800 px-4 py-4">
                  <p className="text-sm font-medium text-red-300">
                    {example.match}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">
                    {example.why}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
