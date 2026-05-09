// Public entry point for @lalss/bug-report-fab.
//
// v0.1.0 (initial release): exports the type contract + a placeholder
// component. The full FAB body extraction from mierakigai-crm-ops is
// queued for v0.2.0 — see project memo `general/project_bug_report_fab_extraction.md`
// in the lalss-dev/claude-memory repo for the migration plan.
//
// Consumers can already pin the package and import the types so call
// sites can be wired without waiting for the body extraction.

export type {
  BugReportApp,
  BugReportAuditHook,
  BugReportBrand,
  BugReportCategory,
  BugReportFabProps,
  BugReportLabels,
  BugReportPosition,
  BugReportPriority,
  BugReportSubmitPayload,
  BugReportSubmitResult,
  BugReportTheme,
} from "./types.js";
export { DEFAULT_LABELS } from "./types.js";

export { BugReportFab } from "./BugReportFab.js";
