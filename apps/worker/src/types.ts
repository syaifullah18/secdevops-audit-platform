import type { Finding, Run, Usage } from "@sdap/core";

export type IsCancelledFn = () => Promise<boolean> | boolean;

export interface CancellationToken {
  isCancelled: IsCancelledFn;
}

export type ImportFindingsFn = (
  run: Run,
  artefactDir: string,
) => Promise<Array<{ finding: Finding; isNew: boolean }>>;

export interface PipelineExecutionOptions {
  resume?: boolean;
  isCancelled?: IsCancelledFn;
  targetDir?: string;
  outputDir?: string;
}

export interface PhaseExecutionResult {
  status: "succeeded" | "failed" | "skipped";
  usage: Usage;
  error?: string;
}
