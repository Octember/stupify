import type { DiffPack, DiffUnit, StupifyCheck } from "./types.js";

const PACK_CHAR_BUDGET = 60_000;

export function packDiffs(
  units: readonly DiffUnit[],
  checks: readonly StupifyCheck[],
): readonly DiffPack[] {
  const budget = Math.max(10_000, PACK_CHAR_BUDGET - registryChars(checks));
  const packs: DiffPack[] = [];
  let current: DiffUnit[] = [];
  let currentChars = 0;

  for (const unit of units) {
    const size = unitChars(unit);
    if (size > budget) {
      flush();
      for (const part of splitOversizedUnit(unit, budget)) {
        packs.push(makePack(packs.length + 1, [part]));
      }
    } else if (currentChars + size > budget) {
      flush();
      current = [unit];
      currentChars = size;
    } else {
      current.push(unit);
      currentChars += size;
    }
  }

  flush();
  return packs;

  function flush(): void {
    if (current.length === 0) return;
    packs.push(makePack(packs.length + 1, current));
    current = [];
    currentChars = 0;
  }
}

function splitOversizedUnit(unit: DiffUnit, budget: number): readonly DiffUnit[] {
  const sections = splitByFile(unit.text);
  const parts: DiffUnit[] = [];
  let current = "";

  for (const section of sections) {
    if (section.length > budget) {
      if (current) {
        parts.push(partUnit(unit, parts.length + 1, current));
        current = "";
      }
      for (const chunk of charChunks(section, budget)) {
        parts.push(partUnit(unit, parts.length + 1, chunk));
      }
    } else if (current.length + section.length > budget) {
      parts.push(partUnit(unit, parts.length + 1, current));
      current = section;
    } else {
      current += section;
    }
  }

  if (current) parts.push(partUnit(unit, parts.length + 1, current));
  return parts;
}

function splitByFile(text: string): readonly string[] {
  const sections = text.split(/\n(?=diff --git )/);
  return sections.length > 0 ? sections : [text];
}

function charChunks(text: string, budget: number): readonly string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += budget) {
    chunks.push(text.slice(index, index + budget));
  }
  return chunks;
}

function partUnit(unit: DiffUnit, partNumber: number, text: string): DiffUnit {
  return {
    id: `${unit.id}:part-${partNumber}`,
    label: `${unit.label} part ${partNumber}`,
    text,
  };
}

function makePack(index: number, units: readonly DiffUnit[]): DiffPack {
  return {
    id: `pack-${String(index).padStart(3, "0")}`,
    units,
    estimatedChars: units.reduce((total, unit) => total + unitChars(unit), 0),
  };
}

function unitChars(unit: DiffUnit): number {
  return unit.id.length + unit.label.length + unit.text.length + 64;
}

function registryChars(checks: readonly StupifyCheck[]): number {
  return JSON.stringify(checks).length + 2_000;
}
