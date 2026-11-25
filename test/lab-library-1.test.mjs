import { test } from 'node:test';
import { checkLibrary } from './lab-library.mjs';

test('Refinery: soundness and counts agree with the audit on the fast library examples, shard 1 of 3', () => checkLibrary(0, 3));
