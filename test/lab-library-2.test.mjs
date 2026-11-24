import { test } from 'node:test';
import { checkLibrary } from './lab-library.mjs';

test('Refinement lab: soundness and counts agree with the audit on the fast library examples, shard 2 of 3', () => checkLibrary(1, 3));
