import * as fs from "fs";
import * as path from "path";

const ENV_FILENAME = ".env";
const envPath = path.resolve(process.cwd(), ENV_FILENAME);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Upserts a KEY="address" line into the .env file in the current working directory.
 */
export default function envAddress(key: string, address: string): void {
  let content: string = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  const safeKey = escapeRegExp(key);
  const line = `${key}="${address}"`;

  const keyRegex = new RegExp(`^${safeKey}=`, "m");
  if (keyRegex.test(content)) {
    content = content.replace(new RegExp(`^${safeKey}=.*$`, "m"), line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += line + "\n";
  }

  fs.writeFileSync(envPath, content, "utf8");
}
