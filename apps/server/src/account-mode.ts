import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { z } from "zod";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (fs.existsSync(envFile)) loadEnvFile(envFile);

export const MultiAccountSettingSchema = z.enum(["true", "false"]).default("false")
  .transform(value => value === "true");
export const multiAccountEnabled = MultiAccountSettingSchema.parse(process.env["MULTI_ACCOUNT"]);
