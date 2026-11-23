import { test } from 'node:test';
import { checkSpaces } from './spaces-library.mjs';

test('S7: library spaces, shard 3 of 3', () => checkSpaces(2, 3));
