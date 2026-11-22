// "A project that uses none of the new keys assembles to the same program text" (PLAN2.md).
// The runtime text is a fixed stub, so changes to lua/runtime.lua do not count; what is
// checked is everything assemble writes around it. UPDATE_GOLDEN=1 rewrites the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { read, path } from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';
import { assemble } from '../js/driver.js';

const IDS = ['gc-shape1', 'gc-shape2', 'gc-shape3', 'gc-shape4', 'lang-second-solver', 'reasons-by-shrinking', 'qbf-three-blocks'];
const STUB = 'local rt = {}\n-- runtime stub\nreturn rt\n';

export function golden(id) {
  const p = load(read(`examples/${id}.json`));
  const raw = p.loop.language === 'lua';
  const compiled = raw ? null : compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  return assemble(p, compiled, STUB).program;
}

for (const id of IDS) {
  test(`assemble is unchanged: ${id}`, () => {
    const f = path(`test/fixtures/assemble/${id}.lua`);
    const text = golden(id);
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(f, text);
    assert.equal(text, fs.readFileSync(f, 'utf8'));
  });
}
