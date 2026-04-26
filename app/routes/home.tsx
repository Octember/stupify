import { useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stupify - Is AI making you dumber?" },
    {
      name: "description",
      content:
        "A local-only CLI that packs diffs with a check registry and asks a local model for findings.",
    },
  ];
}

const COMMAND = "npx @stupify/cli --commit HEAD";

const V0_STEPS = [
  ["1", "Load commit diffs or stdin diff."],
  ["2", "Pack small diffs together and split oversized diffs."],
  ["3", "Inject the enabled check registry."],
  ["4", "Ask the local model for findings."],
  ["5", "Merge findings and print them."],
] as const;

const NEVER_UPLOAD = [
  "Source code",
  "Diffs",
  "Commit messages",
  "File contents",
  "Raw filenames",
  "Repo URLs",
  "Author names",
  "Private package names",
] as const;

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
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8">
        <nav className="flex items-center justify-between text-sm">
          <a href="/" className="font-semibold tracking-tight text-white">
            stupify
          </a>
          <span className="text-zinc-500">local diff judgment CLI</span>
        </nav>

        <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
          <header>
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.24em] text-zinc-500">
              Local diff check
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-none tracking-tight text-white sm:text-7xl">
              Is AI making you dumber?
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
              Stupify packs commit diffs with a tiny check registry, sends them
              to a local model, and asks whether AI replaced engineering
              judgment instead of helping it.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-500">
              No hosted APIs. No sharing. No repo crawling. The current
              milestone is only diffs plus checks to packed local model calls
              to findings.
            </p>

            <div className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
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

            <p className="mt-4 text-sm text-zinc-600">
              No search pipeline, no baseline, no scanner. Just checks, diffs,
              packs, and findings.
            </p>
          </header>

          <JudgmentPreview />
        </div>

        <section className="grid gap-4 pb-12 md:grid-cols-3">
          <InfoPanel title="Local first">
            The model is downloaded into an OS cache directory and runs on your
            machine.
          </InfoPanel>
          <InfoPanel title="Diff only">
            The unit of analysis is exactly the diff input you pass to the
            command.
          </InfoPanel>
          <InfoPanel title="Nothing else">
            No sharing, dashboards, server calls, hosted models, or repo-wide
            scanning, categories, or baselines.
          </InfoPanel>
        </section>

        <section className="grid gap-8 border-t border-zinc-900 py-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Current shape
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
              The command surface stays small while the local model roundtrip
              proves itself.
            </p>
          </div>
          <div className="divide-y divide-zinc-900 rounded-lg border border-zinc-900 bg-zinc-950">
            {V0_STEPS.map(([step, description]) => (
              <div
                key={step}
                className="grid gap-2 px-4 py-4 sm:grid-cols-[40px_1fr]"
              >
                <code className="font-mono text-sm text-zinc-100">
                  {step}
                </code>
                <span className="text-sm text-zinc-500">{description}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-8 border-t border-zinc-900 py-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Privacy boundary
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
              The command does not upload data. Later share features must pass
              through an explicit upload boundary.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {NEVER_UPLOAD.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-zinc-900 bg-zinc-950 px-4 py-3 text-sm text-zinc-400"
              >
                Not uploaded: {item}
              </li>
            ))}
          </ul>
        </section>

        <footer className="border-t border-zinc-900 py-8 text-sm text-zinc-600">
          Stupify is currently a local diffs-to-findings proof.
        </footer>
      </section>
    </main>
  );
}

function JudgmentPreview() {
  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/30">
      <div className="mb-5 flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Findings
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Stupify Output
          </h2>
        </div>
        <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500">
          Preview
        </span>
      </div>

      <dl className="space-y-4">
        <PreviewRow label="Question" value="Is AI making you dumber?" />
        <PreviewRow label="Status" value="Registry check roundtrip." />
        <PreviewRow label="Input" value="One commit diff" />
        <PreviewRow label="Local model contacted" value="Yes" />
        <PreviewRow label="Uploaded" value="Nothing" />
      </dl>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <p className="text-sm font-medium text-zinc-200">
          Stdout shape
        </p>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          sourceId, checkId, why, proof. Nothing else is pretending to exist.
        </p>
      </div>
    </aside>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr]">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-sm font-medium text-zinc-200">{value}</dd>
    </div>
  );
}

function InfoPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-lg border border-zinc-900 bg-zinc-950 p-5">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-500">{children}</p>
    </article>
  );
}
