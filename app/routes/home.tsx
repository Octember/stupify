import { useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stupify - Is AI making you dumber?" },
    {
      name: "description",
      content:
        "A local-only CLI that checks recent code changes for signs of judgment offload, autocomplete dependence, and AI-flavored slop acceptance.",
    },
  ];
}

const COMMAND = "npx @stupify/cli";

const PLANNED_OPTIONS = [
  ["stupify", "Run the local diagnostic check."],
  ["stupify --llm", "Use a local LLM for deeper judgment checks."],
  ['stupify --since "1 week ago"', "Check recent changes only."],
  ["stupify --share", "Upload sanitized report metadata."],
  ["stupify --json", "Print machine-readable output."],
  ["stupify --privacy", "Show what can and cannot leave your machine."],
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
          <span className="text-zinc-500">local-only diagnostic CLI</span>
        </nav>

        <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
          <header>
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.24em] text-zinc-500">
              Developer self-check
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-none tracking-tight text-white sm:text-7xl">
              Is AI making you dumber?
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
              Stupify checks recent code changes for signs of judgment offload,
              autocomplete dependence, and AI-flavored slop acceptance.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-500">
              Your machine reads the code. Your local LLM does the judging. Our
              server only receives sanitized metadata if you choose to share.
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
              Structure-only foundation: the diagnostic engine is not
              implemented yet.
            </p>
          </header>

          <ReportPreview />
        </div>

        <section className="grid gap-4 pb-12 md:grid-cols-3">
          <InfoPanel title="Local first">
            The CLI is designed so source code, diffs, and file contents stay on
            your machine.
          </InfoPanel>
          <InfoPanel title="Judgment check">
            The product asks whether AI is replacing developer judgment instead
            of augmenting it.
          </InfoPanel>
          <InfoPanel title="Share carefully">
            Shared reports will be sanitized cards, not repo analysis dumps.
          </InfoPanel>
        </section>

        <section className="grid gap-8 border-t border-zinc-900 py-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              CLI shape
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
              The command surface is intentionally small. No fake scanner is
              wired into this foundation pass.
            </p>
          </div>
          <div className="divide-y divide-zinc-900 rounded-lg border border-zinc-900 bg-zinc-950">
            {PLANNED_OPTIONS.map(([command, description]) => (
              <div
                key={command}
                className="grid gap-2 px-4 py-4 sm:grid-cols-[220px_1fr]"
              >
                <code className="font-mono text-sm text-zinc-100">
                  {command}
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
              The server should only ever receive an allowlisted, sanitized
              report card after explicit sharing.
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
          Stupify is being rebuilt as a local-only cognitive offloading check.
        </footer>
      </section>
    </main>
  );
}

function ReportPreview() {
  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/30">
      <div className="mb-5 flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Report surface
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Stupify Report
          </h2>
        </div>
        <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500">
          Preview
        </span>
      </div>

      <dl className="space-y-4">
        <PreviewRow label="Question" value="Is AI making you dumber?" />
        <PreviewRow label="Status" value="Diagnostic engine not implemented yet." />
        <PreviewRow label="Files scanned" value="None" />
        <PreviewRow label="Local model contacted" value="No" />
        <PreviewRow label="Uploaded" value="Nothing" />
      </dl>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <p className="text-sm font-medium text-zinc-200">
          Future shared report copy
        </p>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Stupify checked whether AI is making me dumber. No code was uploaded.
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
