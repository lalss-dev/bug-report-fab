// Public type contract for @lalss/bug-report-fab. Importable as
// `import type { ... } from "@lalss/bug-report-fab";`
//
// The package is storage- and database-agnostic on purpose: each
// consumer keeps writing to its own bucket and RPC shape, but the FAB UI
// (button + modal + snip flow) stays identical across apps.

export type BugReportCategory = "bug" | "feature" | "message";

export type BugReportPriority = "low" | "normal" | "high" | "urgent";

/** Apps that consume this FAB. Used as a tag so the central tickets
 *  registry can identify the source app of each ticket. */
export type BugReportApp = "crm" | "erp" | "pos" | "forum";

/** What the consumer's `onSubmit` receives when the user posts a ticket.
 *  `imageUrls` are already-uploaded public URLs (consumer's
 *  `uploadImage` ran first); the consumer's job is just to insert the
 *  ticket row + push to forum. */
export type BugReportSubmitPayload = {
  category: BugReportCategory;
  subject: string;
  description: string;
  priority: BugReportPriority;
  pageUrl: string | null;
  imageUrls: string[];
  userAgent: string;
  viewport: string;
};

export type BugReportSubmitResult = {
  ticketId: number;
};

/** Optional audit-log hook so consumers that have a logActivity helper
 *  can wire it without the package needing to know how. */
export type BugReportAuditHook = (
  action: "bug-report" | "feature-request" | "contact",
  details: { subject: string; ticketId: number; pageUrl: string | null; priority: BugReportPriority },
) => void;

/** Position presets for the FAB button. Anchors via `position: fixed`
 *  with the standard 16px offset; bottom-right is the most common. */
export type BugReportPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** Brand customization. Only `brandPrimary` is required — everything else
 *  derives from it via opacity blending. */
export type BugReportBrand = {
  brandPrimary: string; // e.g. "#5E1AF1"
  brandSecondary?: string; // optional accent (defaults to brandPrimary)
  /** Text color used on top of brandPrimary surfaces. Defaults to white. */
  brandOnPrimary?: string;
};

/** Modal theme — surface, text, border colors. `auto` reads
 *  `prefers-color-scheme` on mount (falls back to `light` during SSR).
 *  The brand colors above stay constant across themes. */
export type BugReportTheme = "light" | "dark" | "auto";

export type BugReportFabProps = BugReportBrand & {
  /** Source app tag — emitted with every ticket so the central registry
   *  can group by app. */
  app: BugReportApp;

  /** Caller identity — these flow into the ticket as reporter_email /
   *  reporter_nama. Required because the package never reads auth. */
  reporterEmail: string;
  reporterNama: string;

  /** FAB button position. Defaults to bottom-right. */
  position?: BugReportPosition;

  /** Optional starting category for the modal. Defaults to "bug". */
  defaultCategory?: BugReportCategory;

  /** Override the auto-captured page URL. Defaults to
   *  `window.location.pathname + window.location.search`. Pass `null`
   *  to suppress page-url capture entirely. */
  pageUrl?: string | null;

  /** Optional badge count for "replied" tickets the user has unread. The
   *  package renders the badge but doesn't fetch — consumer keeps that
   *  state. Set to 0 or omit to hide. */
  repliedBadgeCount?: number;

  /** Click handler when the FAB is clicked WHILE the badge is showing —
   *  consumer typically opens its bell / inbox. If omitted, badge clicks
   *  open the form modal like a regular FAB click. */
  onBadgeClick?: () => void;

  /** Upload an image and return its public URL. Called once per attached
   *  file before `onSubmit`. The package gives you the file plus a
   *  suggested storage key (timestamp + random suffix); consumers can use
   *  the key as-is or replace it. Throw to fail the upload — package
   *  surfaces the error to the user and keeps the form open. */
  uploadImage: (file: File, suggestedKey: string) => Promise<string>;

  /** Submit a finished ticket. `imageUrls` already contain the URLs from
   *  `uploadImage`. Throw to fail the submit; package surfaces the error
   *  and keeps the form open with attachments preserved. Return the
   *  ticket id so the package can stamp it on the audit log + display. */
  onSubmit: (payload: BugReportSubmitPayload) => Promise<BugReportSubmitResult>;

  /** Optional audit-log integration. Called once per successful submit
   *  with the ticket id and metadata. */
  onAuditLog?: BugReportAuditHook;

  /** Optional Indonesian-string overrides if the consumer wants to
   *  customize copy. Keys default to the original CRM strings. */
  labels?: Partial<BugReportLabels>;

  /** Hide the FAB on certain pathnames (login screens, kiosk views, etc).
   *  Returns true to hide, false to show. Called once per render. */
  hideOnPath?: (pathname: string) => boolean;

  /** Modal theme. Defaults to `"auto"` (follows `prefers-color-scheme`).
   *  Pass `"light"` or `"dark"` explicitly when the consumer app has its
   *  own theme provider. */
  theme?: BugReportTheme;

  /** Optional "open my inbox" affordance rendered inside the modal as a
   *  banner row below the tabs. Useful when the consumer has a dedicated
   *  inbox page (CRM `/developer-console`, ERP `/bug-report`, etc.) so
   *  users with unread replies can jump there from the FAB.
   *
   *  When omitted, no banner row is rendered. The consumer is also
   *  responsible for hiding the link on pages where it would be a
   *  no-op (set `inboxLink` to `null` when `pathname` already equals
   *  `inboxLink.href`).
   */
  inboxLink?: { label: string; href: string } | null;
};

export type BugReportLabels = {
  fabBugTitle: string;
  fabModalHeading: string;
  fabSubject: string;
  fabDescription: string;
  fabPriority: string;
  fabAttachments: string;
  fabSubmit: string;
  fabSubmitting: string;
  fabSnap: string;
  fabSnapInstruction: string;
  fabSuccessBug: string;
  fabSuccessFeature: string;
  fabSuccessMessage: string;
  fabFillAll: string;
  fabUploadFailed: string;
  fabUploadFailedNetwork: string;
  fabUploadFailedOffline: string;
  fabSubmitFailedNetwork: string;
  fabFileTooBig: string;
  fabSnapFailed: string;
  priorityLow: string;
  priorityNormal: string;
  priorityHigh: string;
  priorityUrgent: string;
  tabBug: string;
  tabFeature: string;
  tabMessage: string;
};

export const DEFAULT_LABELS: BugReportLabels = {
  fabBugTitle: "Lapor",
  fabModalHeading: "Lapor",
  fabSubject: "Subjek",
  fabDescription: "Deskripsi",
  fabPriority: "Prioritas",
  fabAttachments: "Lampiran",
  fabSubmit: "Kirim",
  fabSubmitting: "Mengirim…",
  fabSnap: "Ambil Cuplikan",
  fabSnapInstruction: "Drag area di layar untuk mengambil cuplikan. ESC untuk batal.",
  fabSuccessBug: "Laporan terkirim, terima kasih!",
  fabSuccessFeature: "Permintaan fitur terkirim, terima kasih!",
  fabSuccessMessage: "Pesan terkirim, terima kasih!",
  fabFillAll: "Lengkapi subjek dan deskripsi.",
  fabUploadFailed: "Gagal upload gambar:",
  fabUploadFailedNetwork: "Koneksi internet bermasalah saat upload gambar. Coba lagi.",
  fabUploadFailedOffline: "Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.",
  fabSubmitFailedNetwork: "Koneksi internet bermasalah saat mengirim laporan. Coba lagi.",
  fabFileTooBig: "File terlalu besar (maks 10MB):",
  fabSnapFailed: "Gagal mengambil cuplikan:",
  priorityLow: "Rendah",
  priorityNormal: "Normal",
  priorityHigh: "Tinggi",
  priorityUrgent: "Urgent",
  tabBug: "Bug",
  tabFeature: "Fitur",
  tabMessage: "Pesan",
};
