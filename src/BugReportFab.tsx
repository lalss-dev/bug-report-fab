// Placeholder component for @lalss/bug-report-fab v0.1.0. The full body
// extraction (FAB button + modal + html2canvas-pro snip + form fields)
// from mierakigai-crm-ops is queued for v0.2.0. This stub exists so
// consumers can pin the package + wire the props contract today; calling
// the placeholder logs a console warning instead of rendering anything.
//
// Migration plan lives in the lalss-dev/claude-memory repo at
// general/project_bug_report_fab_extraction.md.

import { useEffect } from "react";
import type { BugReportFabProps } from "./types.js";

export function BugReportFab(props: BugReportFabProps) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.warn(
        "[@lalss/bug-report-fab] v0.1.0 is the package skeleton — the full FAB body is being extracted from CRM. " +
          "Component does not render yet. Keep your in-repo FAB until v0.2.0 ships. " +
          "Mounted with props:",
        {
          app: props.app,
          reporterEmail: props.reporterEmail,
          position: props.position ?? "bottom-right",
          brandPrimary: props.brandPrimary,
        },
      );
    }
    void props;
  }, [props]);
  return null;
}
