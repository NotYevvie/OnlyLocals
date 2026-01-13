// @ts-expect-error TS7016
import { test, describe, expect } from "bun:test";

declare const Bun: any;
declare const process: any;

declare global {
  interface ImportMeta {
    dir: string;
  }
}

async function runCommand(command: string[], env?: Record<string, string>) {
  const parentDir = import.meta.dir.replace(/\/src$/, "");
  
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: parentDir,
    env: env ? { ...process.env, ...env } : process.env,
  });
  
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  
  return { exitCode, stdout, stderr };
}

describe("setup.ts direct runtime execution (E2E)", () => {
  test("should run with bun", async () => {
    const result = await runCommand(["bun", "run", "setup.ts"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checking installations...");
  });

  test("should run with deno", async () => {
    const result = await runCommand(["deno", "run", "--allow-all", "setup.ts"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checking installations...");
  });

  test("should run with node (tsx)", async () => {
    const result = await runCommand(["npx", "--yes", "tsx", "setup.ts"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checking installations...");
  });
});

describe("setup.sh with RUNTIME environment variable (E2E)", () => {
  test("should use RUNTIME=bun", async () => {
    const result = await runCommand(["./setup.sh"], { RUNTIME: "bun" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Executing: bun run");
  });

  test("should use RUNTIME=deno", async () => {
    const result = await runCommand(["./setup.sh"], { RUNTIME: "deno" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Executing: deno run --allow-all");
  });

  test("should use RUNTIME=node", async () => {
    const result = await runCommand(["./setup.sh"], { RUNTIME: "node" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Executing: npx --yes tsx");
  });
});

describe("setup.sh auto-detection (E2E)", () => {
  test("should auto-detect runtime when RUNTIME not specified", async () => {
    const result = await runCommand(["./setup.sh"]);
    expect(result.exitCode).toBe(0);
    const hasRuntime =
      result.stdout.includes("Executing: bun run") ||
      result.stdout.includes("Executing: deno run") ||
      result.stdout.includes("Executing: npx");
    expect(hasRuntime).toBe(true);
  });
});
