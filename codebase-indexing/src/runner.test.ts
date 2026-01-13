// @ts-expect-error TS7016
import { test, describe, expect } from "bun:test";
import { runCommand, runCommandSync } from "./runner.ts";

describe("runCommand (async)", () => {
  test("should execute simple command successfully", async () => {
    const result = await runCommand("echo 'Hello World'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("Hello World");
    expect(result.stderr).toBe("");
  });

  test("should capture stdout", async () => {
    const result = await runCommand("echo 'test output'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test output");
  });

  test("should handle command failure", async () => {
    const result = await runCommand("exit 1");
    expect(result.exitCode).toBe(1);
  });

  test("should handle stderr", async () => {
    const result = await runCommand("echo 'error message' >&2");
    expect(result.stderr).toContain("error message");
  });

  test("should handle non-existent commands", async () => {
    const result = await runCommand("nonexistent_command_xyz");
    expect(result.exitCode).not.toBe(0);
  });

  test("should handle multi-line output", async () => {
    const result = await runCommand("echo 'line1'; echo 'line2'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("line1");
    expect(result.stdout).toContain("line2");
  });

  test("should handle commands with special characters", async () => {
    const result = await runCommand("echo 'test with $VAR and \"quotes\"'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test with");
  });
});

describe("runCommandSync (sync)", () => {
  test("should execute simple command successfully", () => {
    const result = runCommandSync("echo 'Sync Test'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("Sync Test");
  });

  test("should capture stdout synchronously", () => {
    const result = runCommandSync("echo 'sync output'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sync output");
  });

  test("should handle command failure synchronously", () => {
    const result = runCommandSync("exit 1");
    expect(result.exitCode).toBe(1);
  });

  test("should handle stderr synchronously", () => {
    const result = runCommandSync("echo 'sync error' >&2");
    expect(result.stderr).toContain("sync error");
  });

  test("should handle non-existent commands synchronously", () => {
    const result = runCommandSync("nonexistent_sync_command");
    expect(result.exitCode).not.toBe(0);
  });
});

describe("cross-runtime compatibility", () => {
  test("should work with command piping", async () => {
    const result = await runCommand("echo 'test' | tr 'a-z' 'A-Z'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("TEST");
  });

  test("should work with command chaining", async () => {
    const result = await runCommand("echo 'first' && echo 'second'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("first");
    expect(result.stdout).toContain("second");
  });

  test("should handle environment variables in commands", async () => {
    const result = await runCommand("TEST_VAR=hello && echo $TEST_VAR");
    expect(result.exitCode).toBe(0);
  });
});

describe("performance characteristics", () => {
  test("async execution should complete quickly", async () => {
    const start = Date.now();
    await runCommand("echo 'speed test'");
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
  });

  test("sync execution should complete quickly", () => {
    const start = Date.now();
    runCommandSync("echo 'sync speed test'");
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
  });
});
