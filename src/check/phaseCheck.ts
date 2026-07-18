import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parse } from "yaml";
import { loadManifest } from "../manifest/model";
import { checkShard } from "./shardCheck";
import type { Finding } from "../surface/types";

export interface PhaseSpec {
  id: string;
  contractVersion: string;
  shards: string[];
  acceptance?: string;
}

export interface PhaseCheckResult {
  phase: string;
  shardsClean: boolean;
  acceptancePassed: boolean;
  passed: boolean;
  findings: Finding[];
  acceptanceOutput: string;
}

export function loadPhases(root: string): PhaseSpec[] {
  const path = join(root, "contract", "phases.yaml");
  if (!existsSync(path)) return [];
  return (parse(readFileSync(path, "utf8")) as { phases?: PhaseSpec[] }).phases ?? [];
}

function defaultRunner(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" });
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: String(e.stdout ?? "") + String(e.stderr ?? e.message ?? "") };
  }
}

export function checkPhase(
  root: string,
  runAcceptance: (cmd: string, cwd: string) => { ok: boolean; output: string } = defaultRunner,
): PhaseCheckResult {
  const manifest = loadManifest(root);
  const phase = loadPhases(root).find((p) => p.id === manifest.currentPhase);
  if (!phase) throw new Error(`no phase spec for ${manifest.currentPhase}`);

  const findings: Finding[] = [];
  for (const shardName of phase.shards) {
    findings.push(...checkShard(root, shardName).findings);
  }
  const shardsClean = findings.length === 0;

  let acceptancePassed = true;
  let acceptanceOutput = "";
  if (phase.acceptance) {
    const res = runAcceptance(phase.acceptance, root);
    acceptancePassed = res.ok;
    acceptanceOutput = res.output;
  }

  return {
    phase: phase.id,
    shardsClean,
    acceptancePassed,
    passed: shardsClean && acceptancePassed,
    findings,
    acceptanceOutput,
  };
}
