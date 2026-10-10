import test from "node:test";
import assert from "node:assert/strict";

import { toCsv } from "./csv";

test("toCsv escapes commas, quotes and line breaks", () => {
  const rows = [
    ["Metric", "Value"],
    ["Notes", 'She said "hello", then left\nwith the file'],
  ];

  assert.equal(
    toCsv(rows),
    'Metric,Value\nNotes,"She said ""hello"", then left\nwith the file"',
  );
});
