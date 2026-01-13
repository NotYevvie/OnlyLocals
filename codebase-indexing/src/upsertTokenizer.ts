import { runCommand } from "./runner.ts";
import { getModelSnapshot } from "./hfCache.ts";

declare const process: any;

declare global {
    interface ImportMeta {
        main?: boolean;
    }
}

const MODEL_NAME = "model/jinaai/jina-code-embeddings-0.5b";
const TOKENIZER_FILES = ["tokenizer.json", "added_tokens.json", "special_tokens_map.json", "tokenizer_config.json"];

async function getMissingFiles(snapshotDir: string): Promise<string[]> {
    const checks = await Promise.all(
        TOKENIZER_FILES.map(async (filename) => {
            const filePath = `${snapshotDir}/${filename}`;
            const result = await runCommand(`[ -f "${filePath}" ] && echo "exists"`);
            const exists = result.exitCode === 0 && result.stdout.includes('exists');
            return { filename, exists };
        })
    );
    
    return checks
        .filter(check => !check.exists)
        .map(check => check.filename);
}

async function copyTokenizerFiles(snapshotDir: string, assetsPath: string, files: string[]): Promise<void> {
    if (process.env.TEST_MODE) {
        console.log(`  Test mode: Skipping copy of ${files.length} file(s)`);
        return;
    }
    
    for (const filename of files) {
        const sourcePath = `${assetsPath}/${filename}`;
        const destPath = `${snapshotDir}/${filename}`;

        const sourceCheck = await runCommand(`[ -f "${sourcePath}" ] && echo "exists"`);
        if (sourceCheck.exitCode !== 0 || !sourceCheck.stdout.includes('exists')) {
            console.log(`  Source file not found: ${filename} (skipping)`);
            continue;
        }

        const copyResult = await runCommand(`cp "${sourcePath}" "${destPath}"`);
        if (copyResult.exitCode !== 0) {
            console.error(`  Failed to copy ${filename}: ${copyResult.stderr}`);
            continue;
        }

        console.log(`  Copied ${filename}`);
    }
}

export async function upsertTokenizer(assetsPath: string = "./assets"): Promise<void> {
    try {
        console.log(`Checking tokenizer files for ${MODEL_NAME}...`);

        const snapshotDir = await getModelSnapshot(MODEL_NAME);
        console.log(`  Model snapshot: ${snapshotDir}`);

        const missingFiles = await getMissingFiles(snapshotDir);

        if (missingFiles.length === 0) {
            console.log(`  All tokenizer files already present`);
            return;
        }

        console.log(`  Missing ${missingFiles.length} file(s): ${missingFiles.join(", ")}`);
        console.log(`  Copying from assets...`);
        await copyTokenizerFiles(snapshotDir, assetsPath, missingFiles);

        console.log(`Tokenizer upsert complete`);
    } catch (error: any) {
        console.error(`Failed to upsert tokenizer: ${error.message}`);
        throw error;
    }
}
