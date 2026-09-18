import { spawn } from "node:child_process";

const child = spawn("npx", ["tsx", "src/index.ts"], {
  env: { ...process.env, PORT: "10125" },
  shell: true,
});

child.stdout.on("data", (data) => console.log(data.toString()));
child.stderr.on("data", (data) => console.error("STDERR:", data.toString()));

setTimeout(async () => {
  try {
    const res = await fetch("http://localhost:10125/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    console.log("LOCAL STATUS:", res.status);
    console.log("LOCAL BODY:", await res.text());
  } catch (e) {
    console.error("FETCH ERROR:", e);
  } finally {
    child.kill();
    process.exit(0);
  }
}, 3000);
