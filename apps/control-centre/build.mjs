import { cp, mkdir } from "node:fs/promises";
const target = new URL("dist/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL("public/", import.meta.url), target, { recursive: true });
console.log("Production web assets built. Start server with npm run control-centre.");
