#!/usr/bin/env node
// Stands in for `claude -p ... --output-format json`: echoes its argv and reports usage.
const args = process.argv.slice(2);
if (args.includes("FAIL")) {
  process.stdout.write(JSON.stringify({ is_error: true, result: "Credit balance is too low" }));
  process.exit(0);
}
process.stdout.write(
  JSON.stringify({
    type: "result",
    is_error: false,
    result: JSON.stringify({
      args,
      key: process.env.ANTHROPIC_API_KEY ?? null,
      home: process.env.HOME,
    }),
    total_cost_usd: 0.5,
    usage: { input_tokens: 100, cache_read_input_tokens: 23, output_tokens: 45 },
  }),
);
