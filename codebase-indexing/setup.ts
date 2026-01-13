import { checkHostEnvironment } from "./src/checkHostEnvironment.ts";
import { upsertTokenizer } from "./src/upsertTokenizer.ts";
import { upsertDockerEnvironment } from "./src/upsertDockerEnvironment.ts";

function getScriptDir(): string {
  const fileUrl = import.meta.url;
  let filePath = fileUrl.replace('file://', '');
  const lastSlash = filePath.lastIndexOf('/');
  return filePath.substring(0, lastSlash);
}

(async () => {
  await checkHostEnvironment();
  await upsertTokenizer(`${getScriptDir()}/assets`);
  await upsertDockerEnvironment(`${getScriptDir()}/.env`);
})();
