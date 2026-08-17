// Test entrypoint: registers all suites, then runs them.
import './rules.test.mjs';
import './replay.test.mjs';
import './fuzz.test.mjs';
import './golden.test.mjs';
import './content.test.mjs';
import { main } from './harness.mjs';
main();
