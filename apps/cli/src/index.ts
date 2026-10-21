import { runCli } from "./run";

void runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
