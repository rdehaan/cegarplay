import { test } from 'node:test';
import { checkSpaces } from './spaces-library.mjs';

test('S7: library spaces, shard 2 of 3', () => checkSpaces(1, 3));
