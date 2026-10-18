// Checks names only: Supabase returns secret digests, never plaintext values.
import { spawnSync } from "node:child_process";

const projectRef = process.argv[2];
if (!["scvojtvgnkmbupvyslmb", "levwrmvqdntngeasrtnb"].includes(projectRef)) {
  throw new Error("Pass the Scott staging or production Supabase project ref.");
}
const result = spawnSync("supabase", ["secrets", "list", "--project-ref", projectRef, "--output", "json"], {
  encoding: "utf8"
});
if (result.error || result.status !== 0) {
  console.error(`Cannot check Scott secret configuration on ${projectRef}. Verify SUPABASE_ACCESS_TOKEN has project access.`);
  process.exit(1);
}
const secrets = JSON.parse(result.stdout);
const names = new Set(secrets.map(secret => secret.name));
const required = ["SCOTT_AUTH_EMAIL", "SCOTT_AUTH_PASSWORD"];
const missing = required.filter(name => !names.has(name));
for (const name of required) {
  console.log(`${projectRef}: ${name} ${names.has(name) ? "present" : "MISSING"}`);
}
if (missing.length) {
  console.error(`Set ${missing.join(" and ")} at https://supabase.com/dashboard/project/${projectRef}/functions/secrets. Frontend deployments do not configure these secrets.`);
  process.exit(1);
}
console.log("Required secret names exist. A signed-in admin request must still verify the values work.");
