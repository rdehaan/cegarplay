import { test } from 'node:test';
import { checkSpaces } from './spaces-library.mjs';

test('S7: library spaces, shard 1 of 3', () => checkSpaces(0, 3));
