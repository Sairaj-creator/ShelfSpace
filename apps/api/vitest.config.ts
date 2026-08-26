import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    // Prevent tests from deleting each other's database rows in beforeAll
    // singleFork ensures sequential execution in one process for shared DB state
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
