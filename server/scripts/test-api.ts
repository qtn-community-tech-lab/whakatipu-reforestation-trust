const serverDirectory = new URL("../", import.meta.url);

async function supabase(...args: string[]) {
  const result = await new Deno.Command("supabase", {
    args,
    cwd: serverDirectory,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    // Startup stdout can contain local credentials. Keep it out of test logs.
    throw new Error(
      `supabase ${args[0]} failed:\n${new TextDecoder().decode(result.stderr)}${
        args[0] === "start" ? "" : new TextDecoder().decode(result.stdout)
      }`,
    );
  }
}

console.log("Starting local Supabase and applying migrations (no reset).");
await supabase("start");
await supabase("migration", "up", "--local");

console.log("Serving the local api Edge Function.");
const edge = new Deno.Command("supabase", {
  args: ["functions", "serve", "api"],
  cwd: serverDirectory,
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Drain logs without printing thousands of request lines or retaining them.
// Wait for the CLI's startup message rather than accidentally using an old worker.
let ready = false;
async function drain(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let recent = "";
  for await (const chunk of stream) {
    recent = (recent + decoder.decode(chunk, { stream: true })).slice(-4096);
    if (/Serving functions on|Serving.*http:\/\//i.test(recent)) ready = true;
  }
}
const logs = Promise.all([drain(edge.stdout), drain(edge.stderr)]);
let exited = false;
const edgeStatus = edge.status.then((status) => {
  exited = true;
  return status;
});
let exitCode = 1;
try {
  const deadline = Date.now() + 60_000;
  while (!ready) {
    if (exited) {
      throw new Error("Local Edge Runtime exited before it was ready.");
    }
    if (Date.now() > deadline) {
      throw new Error("Local Edge Runtime startup timed out.");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const result = await new Deno.Command("deno", {
    args: [
      "test",
      "--config",
      "supabase/functions/api/deno.json",
      "--allow-net=127.0.0.1:54321",
      ...(Deno.args.length ? Deno.args : ["tests/"]),
    ],
    cwd: serverDirectory,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  exitCode = result.code;
} finally {
  if (!exited) edge.kill("SIGTERM");
  await edgeStatus;
  await logs;
}
Deno.exit(exitCode);
