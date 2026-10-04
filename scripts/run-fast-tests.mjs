#!/usr/bin/env node
/* Compatibility entry point for the canonical fast gate. The generic manifest runner also owns test/http.list,
   so list parsing, filtering, process isolation, failure reporting, and exit propagation cannot drift. */
import { runList } from './run-test-list.mjs';

process.exit(runList({ label: 'run-fast-tests', listFile: 'test/fast.list', filters: process.argv.slice(2) }));
