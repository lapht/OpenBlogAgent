#!/usr/bin/env node
import { runCli } from "./run";

void runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
