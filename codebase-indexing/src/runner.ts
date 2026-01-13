declare const Bun: any;
declare const Deno: any;
declare const require: any;

// Async command execution functions
const runCommandBun = async (command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    try {
        const result = await Bun.$`sh -c ${command}`.quiet();
        return {
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
            exitCode: result.exitCode,
        };
    } catch (error: any) {
        return {
            stdout: error.stdout?.toString() || "",
            stderr: error.stderr?.toString() || error.message,
            exitCode: error.exitCode || 1,
        };
    }
};

const runCommandDeno = async (command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const cmd = new Deno.Command("sh", {
        args: ["-c", command],
        stdout: "piped",
        stderr: "piped",
    });
    const { stdout, stderr, code } = await cmd.output();
    return {
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
        exitCode: code,
    };
};

const runCommandNode = async (command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    // @ts-ignore - Node.js modules only available in Node runtime
    const { exec } = await import("child_process");
    // @ts-ignore - Node.js modules only available in Node runtime
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
        const { stdout, stderr } = await execAsync(command);
        return {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
        };
    } catch (error: any) {
        return {
            stdout: error.stdout?.toString() || "",
            stderr: error.stderr?.toString() || error.message,
            exitCode: error.code || 1,
        };
    }
};

// Sync command execution functions
const runCommandSyncBun = (command: string): { stdout: string; stderr: string; exitCode: number } => {
    try {
        const proc = Bun.spawnSync(["sh", "-c", command]);
        return {
            stdout: proc.stdout.toString(),
            stderr: proc.stderr.toString(),
            exitCode: proc.exitCode,
        };
    } catch (error: any) {
        return {
            stdout: "",
            stderr: error.message,
            exitCode: 1,
        };
    }
};

const runCommandSyncDeno = (command: string): { stdout: string; stderr: string; exitCode: number } => {
    const cmd = new Deno.Command("sh", {
        args: ["-c", command],
        stdout: "piped",
        stderr: "piped",
    });
    const { stdout, stderr, code } = cmd.outputSync();
    return {
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
        exitCode: code,
    };
};

const runCommandSyncNode = (command: string): { stdout: string; stderr: string; exitCode: number } => {
    const { execSync } = require("child_process");
    try {
        const stdout = execSync(command, { encoding: "utf-8" });
        return {
            stdout: stdout.toString(),
            stderr: "",
            exitCode: 0,
        };
    } catch (error: any) {
        return {
            stdout: error.stdout?.toString() || "",
            stderr: error.stderr?.toString() || error.message,
            exitCode: error.status || 1,
        };
    }
};

// Cache runtime-specific function (works on Bun, Deno, or Node)
const runCommandAsync = (() => {
    if (typeof Bun !== "undefined") return runCommandBun;
    if (typeof Deno !== "undefined") return runCommandDeno;
    return runCommandNode;
})();

// Cache runtime-specific function (works on Bun, Deno, or Node)
const runCommandSynchronous = (() => {
    if (typeof Bun !== "undefined") return runCommandSyncBun;
    if (typeof Deno !== "undefined") return runCommandSyncDeno;
    return runCommandSyncNode;
})();

// Export cached function references for maximum performance
export const runCommand = runCommandAsync;
export const runCommandSync = runCommandSynchronous;
