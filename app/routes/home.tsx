import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "stupif.ai — AI makes you stupid. lets see how much" },
    {
      name: "description",
      content:
        "Decorative roast generator. No real repo analysis. The diagnosis is fake. The feeling may be real.",
    },
  ];
}

// ----- mock data ---------------------------------------------------------

const DIAGNOSES = [
  "Autocomplete Brain",
  "Boilerplate Creep",
  "README Inflation Disorder",
  "Enterprise Slop Syndrome",
  "Abstraction Goblin Infestation",
  "Copilot Stockholm Syndrome",
  "Fake Seniority Poisoning",
  "Robust-and-Scalable Syndrome",
  "Architectural Fan Fiction",
];

const SEVERITY_LABELS = [
  "Clean-ish",
  "Mildly Stupified",
  "Autocomplete Curious",
  "Boilerplate Positive",
  "Copilot-Pilled",
  "Slop-Adjacent",
  "Enterprise-Grade Concern",
  "Fully Stupified",
];

const SCORE_NAMES = [
  "Autocomplete Brain Index",
  "Boilerplate Creep",
  "README Inflation",
  "Fake Seniority Index",
  "Corporate Commit Energy",
  "Manual Thought Residue",
  "Abstraction Goblin Score",
];

const FINDINGS = [
  "The repo gives off strong 'generated, then manually apologized for' energy.",
  "Several abstractions appear to exist primarily because the code got lonely.",
  "The naming has started dressing for the job it wants.",
  "This project is one helper function away from becoming a lifestyle.",
  "The architecture appears to be preparing for traffic from an alternate universe.",
  "The repo has the calm, glassy stare of something that passed tests once.",
  "The commit history appears to be applying for promotion.",
  "No laws were broken, but several taste preferences were injured.",
];

const TREATMENTS = [
  "Delete one abstraction.",
  "Rename one thing like a normal person.",
  "Replace “robust” with a test.",
  "Replace “scalable” with a benchmark.",
  "Turn off autocomplete for 30 minutes and see who you are.",
  "Remove one file whose only job is to import another file.",
  "Touch grass, then delete the factory.",
];

const LOADING_MESSAGES = [
  "Inspecting commit messages for signs of spiritual decline…",
  "Measuring boilerplate density…",
  "Checking if your README was written by a LinkedIn ghost…",
  "Looking for “robust,” “scalable,” and other warning signs…",
  "Scanning for functions that smell like autocomplete…",
  "Generating fake chart energy…",
  "Consulting the Council of Senior Engineers Who Still Use Vim…",
  "Performing statistically irresponsible analysis…",
  "Scanning imaginary commit history…",
];

// ----- deterministic generation -----------------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN<T>(rng: () => number, arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

type Score = { name: string; value: number };
type Report = {
  username: string;
  diagnosis: string;
  severity: string;
  scores: Score[];
  findings: string[];
  treatments: string[];
};

function generateReport(username: string): Report {
  const seed = hashString(username.toLowerCase());
  const rng = mulberry32(seed);

  const diagnosis = pick(rng, DIAGNOSES);
  const severity = pick(rng, SEVERITY_LABELS);

  const otherScoreNames = SCORE_NAMES.filter(
    (n) => n !== "Manual Thought Residue",
  );
  const otherScores: Score[] = otherScoreNames.map((name) => ({
    name,
    value: 20 + Math.floor(rng() * 76),
  }));
  const avgOther =
    otherScores.reduce((a, b) => a + b.value, 0) / otherScores.length;
  const residue = Math.max(
    20,
    Math.min(95, Math.round(115 - avgOther + (rng() * 10 - 5))),
  );

  const scores: Score[] = [
    ...otherScores,
    { name: "Manual Thought Residue", value: residue },
  ];

  return {
    username,
    diagnosis,
    severity,
    scores,
    findings: pickN(rng, FINDINGS, 3),
    treatments: pickN(rng, TREATMENTS, 3),
  };
}

// ----- input parsing -----------------------------------------------------

function parseUsername(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .split("/")[0];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// ----- formatting -------------------------------------------------------

function reportToText(r: Report): string {
  const lines = [
    `stupif.ai roast — @${r.username}`,
    ``,
    `Diagnosis: ${r.diagnosis}`,
    `Severity: ${r.severity}`,
    ``,
    `Scores:`,
    ...r.scores.map((s) => `  - ${s.name}: ${s.value}%`),
    ``,
    `Findings:`,
    ...r.findings.map((f) => `  - ${f}`),
    ``,
    `Treatments:`,
    ...r.treatments.map((t) => `  - ${t}`),
    ``,
    `Generated from vibes, not GitHub data.`,
  ];
  return lines.join("\n");
}

// ----- component --------------------------------------------------------

type Phase = "idle" | "loading" | "done";

export default function Home() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== "loading") return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[i]);
    }, 700);
    return () => clearInterval(id);
  }, [phase]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseUsername(input);
    if (!parsed) {
      setError("That doesn't look like a GitHub username.");
      return;
    }
    setError(null);
    setReport(null);
    setLoadingMsg(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    setPhase("loading");

    const delay = 1500 + Math.random() * 1500;
    setTimeout(() => {
      setReport(generateReport(parsed));
      setPhase("done");
    }, delay);
  }

  function handleReset() {
    setReport(null);
    setInput("");
    setError(null);
    setPhase("idle");
    setCopied(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleCopy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(reportToText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4">
      <header className="w-full max-w-3xl pt-16 pb-10 text-center">
        <p className="text-xs font-semibold tracking-widest text-zinc-400 uppercase mb-3">
          stupif.ai
        </p>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white mb-4">
          AI makes you stupid.
          <br />
          <span className="text-zinc-400">lets see how much</span>
        </h1>
      </header>

      {phase !== "done" && (
        <form className="w-full max-w-xl" onSubmit={handleSubmit}>
          <div className="relative">
            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 text-2xl font-light select-none">
              @
            </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError(null);
              }}
              placeholder="github-username"
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={phase === "loading"}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl pl-12 pr-5 py-5 text-2xl font-medium text-white placeholder-zinc-600 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/30 transition-all disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || phase === "loading"}
            className="mt-4 w-full bg-zinc-100 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed text-black font-semibold text-lg py-4 rounded-2xl transition-colors"
          >
            {phase === "loading" ? "Diagnosing vibes…" : "Roast me"}
          </button>

          {error && (
            <p className="mt-3 text-center text-sm text-red-400">{error}</p>
          )}

          <p className="mt-4 text-center text-xs text-zinc-500">
            Decorative roast generator. No real repo analysis.
          </p>
        </form>
      )}

      {phase === "loading" && (
        <div className="w-full max-w-xl mt-8 text-center text-zinc-400 text-sm animate-pulse">
          {loadingMsg}
        </div>
      )}

      {phase === "done" && report && (
        <div className="w-full max-w-2xl mt-2">
          <ReportCard report={report} />

          <p className="mt-4 text-center text-xs text-zinc-500">
            Generated from vibes, not GitHub data.
          </p>

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleCopy}
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              {copied ? "Copied ✓" : "Copy roast"}
            </button>
            <button
              onClick={handleReset}
              className="flex-1 bg-zinc-100 hover:bg-white text-black font-semibold py-3 rounded-2xl transition-colors"
            >
              Roast someone else
            </button>
          </div>
        </div>
      )}

      <footer className="mt-auto py-10 text-center text-zinc-600 text-xs max-w-md">
        This is not a real benchmark. No GitHub data was harmed. The diagnosis
        is fake. The feeling may be real.
      </footer>
    </main>
  );
}

function ReportCard({ report }: { report: Report }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8">
      <div className="flex items-baseline gap-2 mb-6">
        <span className="text-zinc-500">user:</span>
        <a
          href={`https://github.com/${report.username}`}
          target="_blank"
          rel="noreferrer"
          className="text-white font-mono hover:text-white"
        >
          @{report.username}
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
            Diagnosis
          </div>
          <div className="text-lg font-semibold text-white">
            {report.diagnosis}
          </div>
        </div>
        <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
            Severity
          </div>
          <div className="text-lg font-semibold text-white">
            {report.severity}
          </div>
        </div>
      </div>

      <Section title="Scores">
        <div className="space-y-3">
          {report.scores.map((s) => (
            <ScoreBar key={s.name} name={s.name} value={s.value} />
          ))}
        </div>
      </Section>

      <Section title="Findings">
        <ul className="space-y-2 text-zinc-300 text-sm">
          {report.findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-zinc-400 select-none">▸</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Treatments">
        <ul className="space-y-2 text-zinc-300 text-sm">
          {report.treatments.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-zinc-400 select-none">℞</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

function ScoreBar({ name, value }: { name: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-zinc-300">{name}</span>
        <span className="text-zinc-400 font-mono">{value}%</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-zinc-200 rounded-full"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
