import { runCommand } from "./runner.ts";

const run_string = `echo "Hello World"`;

(async () => {
    const gitExists = await runCommand("which git");
    console.log(`Git command exists: ${gitExists.exitCode === 0}`);

    const result = await runCommand(run_string);
    console.log("Output:", result.stdout.trim());
    console.log("Exit code:", result.exitCode);
})();
