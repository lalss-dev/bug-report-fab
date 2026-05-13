// @lalss/bug-report-fab v0.2.0 — full FAB body extracted from
// mierakigai-crm-ops 2026-05-09. Storage- and database-agnostic via
// injected uploadImage + onSubmit props (consumer keeps its own bucket
// + RPC; package owns the UI).
//
// Visual design uses inline styles + brand-prop CSS variables so the
// package doesn't depend on the consumer's Tailwind config. A small
// styles.css covers animations + cursor states; consumers `import
// "@lalss/bug-report-fab/styles.css"` once at the host root.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BugReportCategory,
  BugReportFabProps,
  BugReportLabels,
  BugReportPriority,
  BugReportTheme,
} from "./types.js";
import { DEFAULT_LABELS } from "./types.js";
import { BrfModal } from "./Modal.js";
import { captureRectAsFile, type Rect } from "./snip.js";

type SnipState =
  | { phase: "idle" }
  | { phase: "armed" }
  | { phase: "selecting"; origin: { x: number; y: number }; current: { x: number; y: number } }
  | { phase: "capturing" };

// Inline CSS — kept in the component so consumers don't have to wire up a
// separate `import "@lalss/bug-report-fab/styles.css"`. Webpack-mode
// Next.js trips over package.json `exports` for CSS subpaths even when
// the file is shipped, so dropping the external file removes that whole
// failure surface. Rules are tiny (animations + tab underline pseudo-
// element); inlining them costs ~700 bytes per FAB mount once gzipped.
const BRF_CSS = `
@keyframes brf-fade-in { from { opacity: 0 } to { opacity: 1 } }
.brf-snip-overlay { cursor: crosshair; touch-action: none; }
.brf-fade-in { animation: brf-fade-in 120ms ease-out; }
.brf-fab-button { transition: transform 150ms ease-out, box-shadow 150ms ease-out, opacity 150ms ease-out; }
.brf-fab-button:hover { transform: translateY(-1px); box-shadow: 0 12px 24px rgba(0,0,0,0.18); }
.brf-fab-button:disabled { opacity: 0.6; cursor: not-allowed; }
.brf-tab { transition: color 120ms ease-out; position: relative; }
.brf-tab[data-active="true"]::after {
  content: ""; position: absolute; inset: auto 0 0 0; height: 3px;
  border-radius: 3px 3px 0 0; background: var(--brf-secondary, var(--brf-primary));
}
`;

// Modal palette per theme. Brand colors stay constant; surface / text /
// border colors flip. Light defaults match the original v0.4.0 hex codes
// so existing consumers don't see visual drift.
type Palette = {
  surface: string;
  surface2: string;
  text: string;
  textDim: string;
  muted: string;
  border: string;
  divider: string;
  inputBg: string;
  chipInactiveBg: string;
  chipInactiveText: string;
  inboxRowBg: string;
  inboxRowBgHover: string;
  successBg: string;
  successFg: string;
  errorBg: string;
  errorFg: string;
  cancelBg: string;
  cancelText: string;
  cancelBorder: string;
};

const LIGHT_PALETTE: Palette = {
  surface: "#ffffff",
  surface2: "#f9fafb",
  text: "#111827",
  textDim: "#374151",
  muted: "#6b7280",
  border: "#d1d5db",
  divider: "#e5e7eb",
  inputBg: "#ffffff",
  chipInactiveBg: "rgba(0,0,0,0.04)",
  chipInactiveText: "#6b7280",
  inboxRowBg: "rgba(0,0,0,0.04)",
  inboxRowBgHover: "rgba(0,0,0,0.07)",
  successBg: "rgba(34,197,94,0.15)",
  successFg: "#16a34a",
  errorBg: "rgba(239,68,68,0.10)",
  errorFg: "#dc2626",
  cancelBg: "#ffffff",
  cancelText: "#374151",
  cancelBorder: "#d1d5db",
};

const DARK_PALETTE: Palette = {
  surface: "#1a1a22",
  surface2: "#22222b",
  text: "#e5e7eb",
  textDim: "#d1d5db",
  muted: "#9ca3af",
  border: "#3a3a45",
  divider: "#2a2a35",
  inputBg: "#15151c",
  chipInactiveBg: "rgba(255,255,255,0.06)",
  chipInactiveText: "#9ca3af",
  inboxRowBg: "rgba(255,255,255,0.04)",
  inboxRowBgHover: "rgba(255,255,255,0.08)",
  successBg: "rgba(34,197,94,0.18)",
  successFg: "#4ade80",
  errorBg: "rgba(239,68,68,0.18)",
  errorFg: "#f87171",
  cancelBg: "transparent",
  cancelText: "#e5e7eb",
  cancelBorder: "#3a3a45",
};

type Attachment = { file: File; preview: string };

const PRIORITIES: BugReportPriority[] = ["low", "normal", "high", "urgent"];

function corners(pos: BugReportFabProps["position"]) {
  switch (pos) {
    case "bottom-left":  return { bottom: 24, left: 24 } as const;
    case "top-right":    return { top: 24, right: 24 } as const;
    case "top-left":     return { top: 24, left: 24 } as const;
    case "bottom-right":
    default:             return { bottom: 24, right: 24 } as const;
  }
}

function suggestKey(file: File): string {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}

// Browser fetch throws TypeError: "Failed to fetch" (Chromium) / "Load failed"
// (WebKit) / "NetworkError when attempting to fetch resource" (Firefox) when
// the request can't complete — preflight blocked, offline, DNS, TLS, etc.
// supabase-js (and most SDKs) bubble the original error.message up as-is, so
// "Failed to fetch" lands in front of end-users. Translate it to a clearer
// Indonesian message; return null for anything we don't recognize so the
// caller falls back to the raw err.message.
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to fetch|NetworkError|Network request failed|Load failed|net::ERR|ERR_NETWORK|ERR_INTERNET_DISCONNECTED/i.test(msg);
}
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function BugReportFab(props: BugReportFabProps) {
  const labels: BugReportLabels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(props.labels ?? {}) }),
    [props.labels],
  );
  const brandPrimary = props.brandPrimary;
  const brandSecondary = props.brandSecondary ?? props.brandPrimary;
  const brandOnPrimary = props.brandOnPrimary ?? "#ffffff";

  // Resolve theme. "auto" reads prefers-color-scheme on mount; we keep
  // the resolved value in state so SSR renders light (matching v0.4.0
  // behavior) and the client hydrates to dark if appropriate. Listening
  // for changes too so toggling the OS-level setting updates the modal
  // without a remount — small win, cheap to implement.
  const themeProp: BugReportTheme = props.theme ?? "auto";
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
    themeProp === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    if (themeProp !== "auto") {
      setResolvedTheme(themeProp);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolvedTheme(mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, [themeProp]);
  const palette = resolvedTheme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BugReportCategory>(props.defaultCategory ?? "bug");
  const isTechnical = tab === "bug" || tab === "feature";

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<BugReportPriority>("normal");
  const [images, setImages] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [snip, setSnip] = useState<SnipState>({ phase: "idle" });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setSubject("");
    setDescription("");
    setPriority("normal");
    setImages((prev) => {
      prev.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); });
      return [];
    });
    setError(null);
    setSuccess(false);
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const MAX_BYTES = 10 * 1024 * 1024;
    const arr = Array.from(files);
    const tooBig = arr.filter((f) => f.size > MAX_BYTES);
    setImages((prev) => {
      const accepted = arr
        .filter((f) => f.size <= MAX_BYTES)
        .slice(0, 5 - prev.length)
        .map<Attachment>((f) => ({
          file: f,
          preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
        }));
      return [...prev, ...accepted].slice(0, 5);
    });
    if (tooBig.length > 0) {
      setError(`${labels.fabFileTooBig} ${tooBig.map((f) => f.name).join(", ")}`);
    } else {
      setError(null);
    }
  }, [labels.fabFileTooBig]);

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => {
      if (prev[idx]?.preview) URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const cancelSnip = useCallback(() => {
    setSnip({ phase: "idle" });
    setOpen(true);
  }, []);

  const startSnip = useCallback(() => {
    if (images.length >= 5) return;
    setError(null);
    setOpen(false);
    setTimeout(() => setSnip({ phase: "armed" }), 50);
  }, [images.length]);

  // Cleanup object URLs whenever modal closes without submitting.
  useEffect(() => {
    if (open) return;
    setImages((prev) => {
      prev.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); });
      return [];
    });
  }, [open]);

  // ESC cancels snipping (modal handles its own ESC separately).
  useEffect(() => {
    if (snip.phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelSnip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snip.phase, cancelSnip]);

  // Hide-on-path lookup. Defaults to false (always show).
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  if (props.hideOnPath?.(pathname)) return null;

  const resolvedPageUrl =
    props.pageUrl !== undefined
      ? props.pageUrl
      : typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null;

  async function uploadAll(): Promise<{ urls: string[]; failed: string[]; networkFailure: boolean }> {
    if (images.length === 0) return { urls: [], failed: [], networkFailure: false };
    setUploading(true);
    const urls: string[] = [];
    const failed: string[] = [];
    let networkFailure = false;
    for (const a of images) {
      try {
        const url = await props.uploadImage(a.file, suggestKey(a.file));
        urls.push(url);
      } catch (err) {
        if (isNetworkError(err)) networkFailure = true;
        failed.push(`${a.file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setUploading(false);
    return { urls, failed, networkFailure };
  }

  async function submit(category: BugReportCategory) {
    const isMessage = category === "message";
    const subj = isMessage ? subject : subject;
    const body = isMessage ? description : description;
    if (!subj.trim() || !body.trim()) {
      setError(labels.fabFillAll);
      return;
    }
    setSaving(true);
    setError(null);
    const { urls, failed, networkFailure } = isMessage
      ? { urls: [], failed: [] as string[], networkFailure: false }
      : await uploadAll();
    if (failed.length > 0) {
      setSaving(false);
      // Collapse to a single clear message when EVERY failure was a browser
      // network error — the per-file "Failed to fetch" suffix tells the user
      // nothing actionable. Otherwise keep the per-file detail (mixed RLS /
      // file-too-big / etc) so they can see which file the server rejected.
      if (networkFailure && isOffline()) {
        setError(labels.fabUploadFailedOffline);
      } else if (networkFailure && failed.every((f) => /Failed to fetch|NetworkError|Network request failed|Load failed/i.test(f))) {
        setError(labels.fabUploadFailedNetwork);
      } else {
        setError(`${labels.fabUploadFailed} ${failed.join("; ")}`);
      }
      return;
    }
    try {
      const result = await props.onSubmit({
        category,
        subject: subj.trim(),
        description: body.trim(),
        priority: isMessage ? "normal" : priority,
        pageUrl: isMessage ? null : resolvedPageUrl,
        imageUrls: urls,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
      });
      setSaving(false);
      props.onAuditLog?.(
        category === "feature" ? "feature-request" : category === "message" ? "contact" : "bug-report",
        {
          subject: subj.trim(),
          ticketId: result.ticketId,
          pageUrl: isMessage ? null : resolvedPageUrl,
          priority: isMessage ? "normal" : priority,
        },
      );
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1500);
    } catch (err) {
      setSaving(false);
      if (isOffline()) {
        setError(labels.fabUploadFailedOffline);
      } else if (isNetworkError(err)) {
        setError(labels.fabSubmitFailedNetwork);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const selRect: Rect | null = (() => {
    if (snip.phase === "selecting") {
      const { origin, current } = snip;
      return {
        x: Math.min(origin.x, current.x),
        y: Math.min(origin.y, current.y),
        w: Math.abs(current.x - origin.x),
        h: Math.abs(current.y - origin.y),
      };
    }
    return null;
  })();

  const cornerStyle = corners(props.position);
  const showBadge = (props.repliedBadgeCount ?? 0) > 0;

  // Brand vars exposed via wrapper style; descendant styles can read via
  // `var(--brf-primary)` etc. Particularly useful for the .brf-tab::after
  // active-underline rule.
  const brandStyle = {
    "--brf-primary": brandPrimary,
    "--brf-secondary": brandSecondary,
    "--brf-on-primary": brandOnPrimary,
  } as React.CSSProperties;

  return (
    <div style={brandStyle}>
      <style>{BRF_CSS}</style>
      {/* FAB BUTTON */}
      <button
        data-brf-skip="1"
        type="button"
        onClick={() => {
          if (showBadge && props.onBadgeClick) {
            props.onBadgeClick();
            return;
          }
          reset();
          setTab(props.defaultCategory ?? "bug");
          setOpen(true);
        }}
        className="brf-fab-button"
        style={{
          ...cornerStyle,
          position: "fixed",
          zIndex: 70,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderRadius: 9999,
          background: brandPrimary,
          color: brandOnPrimary,
          border: "none",
          cursor: "pointer",
          boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
          fontSize: 14,
          fontWeight: 600,
        }}
        title={labels.fabBugTitle}
      >
        <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
        <span>{labels.fabBugTitle} 🪲</span>
        {showBadge && (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 20,
              height: 20,
              padding: "0 6px",
              borderRadius: 9999,
              background: brandSecondary,
              color: brandOnPrimary,
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 2px #fff",
            }}
          >
            {(props.repliedBadgeCount ?? 0) > 99 ? "99+" : props.repliedBadgeCount}
          </span>
        )}
      </button>

      {/* SNIP OVERLAY */}
      {snip.phase !== "idle" && (
        <div
          data-brf-skip="1"
          className="brf-snip-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: `${brandPrimary}59`, // ~35% alpha
          }}
          onPointerDown={(e) => {
            if (snip.phase === "capturing") return;
            e.preventDefault();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setSnip({
              phase: "selecting",
              origin: { x: e.clientX, y: e.clientY },
              current: { x: e.clientX, y: e.clientY },
            });
          }}
          onPointerMove={(e) => {
            if (snip.phase !== "selecting") return;
            setSnip({ ...snip, current: { x: e.clientX, y: e.clientY } });
          }}
          onPointerUp={async (e) => {
            if (snip.phase !== "selecting") return;
            const rect: Rect = {
              x: Math.min(snip.origin.x, e.clientX),
              y: Math.min(snip.origin.y, e.clientY),
              w: Math.abs(e.clientX - snip.origin.x),
              h: Math.abs(e.clientY - snip.origin.y),
            };
            if (rect.w < 8 || rect.h < 8) {
              cancelSnip();
              return;
            }
            setSnip({ phase: "capturing" });
            try {
              const file = await captureRectAsFile(rect);
              addFiles([file]);
            } catch (err) {
              setError(`${labels.fabSnapFailed} ${err instanceof Error ? err.message : String(err)}`);
            }
            setSnip({ phase: "idle" });
            setOpen(true);
          }}
          onPointerCancel={() => { if (snip.phase === "selecting") cancelSnip(); }}
        >
          <div
            data-brf-skip="1"
            style={{
              pointerEvents: "none",
              position: "absolute",
              left: "50%",
              top: 24,
              transform: "translateX(-50%)",
              padding: "8px 16px",
              borderRadius: 9999,
              background: brandPrimary,
              color: brandOnPrimary,
              fontSize: 12,
              fontWeight: 500,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
          >
            {snip.phase === "capturing" ? "…" : labels.fabSnapInstruction}
          </div>
          {selRect && selRect.w > 0 && selRect.h > 0 && (
            <div
              data-brf-skip="1"
              style={{
                pointerEvents: "none",
                position: "absolute",
                left: selRect.x,
                top: selRect.y,
                width: selRect.w,
                height: selRect.h,
                border: "2px dashed #fff",
                background: "rgba(255,255,255,0.05)",
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.15)",
              }}
            />
          )}
        </div>
      )}

      {/* MODAL */}
      <BrfModal open={open} onClose={() => setOpen(false)} zIndex={80}>
        <div
          data-brf-skip="1"
          style={{
            width: "min(92vw, 520px)",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            borderRadius: 12,
            overflow: "hidden",
            background: palette.surface,
            color: palette.text,
            boxShadow: "0 24px 48px rgba(0,0,0,0.25)",
            border: `1px solid ${palette.border}`,
          }}
        >
          <div
            style={{
              padding: "12px 20px",
              background: brandPrimary,
              color: brandOnPrimary,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{labels.fabModalHeading}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: brandOnPrimary,
                cursor: "pointer",
                padding: 4,
                opacity: 0.85,
              }}
            >
              <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* TABS */}
          <div style={{ display: "flex", borderBottom: `1px solid ${palette.divider}` }}>
            {(["bug", "feature", "message"] as const).map((k) => {
              const label = k === "bug" ? labels.tabBug : k === "feature" ? labels.tabFeature : labels.tabMessage;
              const active = tab === k;
              return (
                <button
                  key={k}
                  type="button"
                  className="brf-tab"
                  data-active={active ? "true" : "false"}
                  onClick={() => {
                    setError(null);
                    setSuccess(false);
                    setTab(k);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: active ? palette.text : palette.muted,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* INBOX LINK (optional) — banner row that lets users jump to
              their dedicated inbox page from the FAB. Hidden when the
              consumer doesn't pass `inboxLink` or sets it to null. */}
          {props.inboxLink && (
            <a
              href={props.inboxLink.href}
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 20px",
                borderBottom: `1px solid ${palette.divider}`,
                background: palette.inboxRowBg,
                textDecoration: "none",
                color: palette.text,
                fontSize: 12,
                fontWeight: 600,
                transition: "background 120ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = palette.inboxRowBgHover; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = palette.inboxRowBg; }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {props.inboxLink.label}
                {showBadge && (
                  <span
                    style={{
                      minWidth: 16,
                      height: 16,
                      padding: "0 4px",
                      borderRadius: 9999,
                      background: brandSecondary,
                      color: brandOnPrimary,
                      fontSize: 9,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {(props.repliedBadgeCount ?? 0) > 99 ? "99+" : props.repliedBadgeCount}
                  </span>
                )}
              </span>
              <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: palette.muted }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </a>
          )}

          {/* BODY */}
          {success ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  margin: "0 auto 16px",
                  borderRadius: 9999,
                  background: palette.successBg,
                  color: palette.successFg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width={28} height={28} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
                {tab === "bug"
                  ? labels.fabSuccessBug
                  : tab === "feature"
                    ? labels.fabSuccessFeature
                    : labels.fabSuccessMessage}
              </p>
            </div>
          ) : isTechnical ? (
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
              <div style={{ overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <Field label={labels.fabSubject} required palette={palette}>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    style={makeInputStyle(palette)}
                  />
                </Field>
                <Field label={labels.fabDescription} required palette={palette}>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    style={{ ...makeInputStyle(palette), resize: "none" }}
                  />
                </Field>

                <Field label={`${labels.fabAttachments} (max 5, max 10MB)`} palette={palette}>
                  {images.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                      {images.map((a, idx) => (
                        <Thumb key={idx} att={a} onRemove={() => removeImage(idx)} palette={palette} />
                      ))}
                    </div>
                  )}
                  {images.length < 5 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragActive(false);
                          if (images.length >= 5) return;
                          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                        }}
                        style={{
                          ...dropZoneStyle,
                          borderColor: dragActive ? brandPrimary : palette.border,
                          color: dragActive ? brandPrimary : palette.muted,
                          background: dragActive ? `${brandPrimary}0d` : "transparent",
                        }}
                      >
                        <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z"
                          />
                        </svg>
                        <span style={{ marginTop: 4, fontSize: 12, fontWeight: 500 }}>Upload / Drop</span>
                      </button>
                      <button
                        type="button"
                        onClick={startSnip}
                        style={{
                          ...dropZoneStyle,
                          borderColor: palette.border,
                          color: palette.muted,
                        }}
                      >
                        <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H5a2 2 0 00-2 2v3m0 4v3a2 2 0 002 2h3m4-14h3a2 2 0 012 2v3m0 4v3a2 2 0 01-2 2h-3" />
                        </svg>
                        <span style={{ marginTop: 4, fontSize: 12, fontWeight: 500 }}>{labels.fabSnap}</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => {
                          if (!e.target.files) return;
                          const arr = Array.from(e.target.files);
                          e.target.value = "";
                          addFiles(arr);
                        }}
                      />
                    </div>
                  )}
                </Field>

                <Field label={labels.fabPriority} palette={palette}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {PRIORITIES.map((p) => {
                      const active = priority === p;
                      const lbl = p === "low" ? labels.priorityLow
                        : p === "normal" ? labels.priorityNormal
                        : p === "high" ? labels.priorityHigh
                        : labels.priorityUrgent;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          style={{
                            padding: "4px 14px",
                            borderRadius: 9999,
                            background: active ? `${brandSecondary}26` : palette.chipInactiveBg,
                            color: active ? brandSecondary : palette.chipInactiveText,
                            border: active ? `2px solid ${brandSecondary}` : "2px solid transparent",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {error && <ErrorBanner message={error} palette={palette} />}
              </div>
              <Footer
                onCancel={() => setOpen(false)}
                onSubmit={() => submit(tab === "feature" ? "feature" : "bug")}
                submitting={saving || uploading}
                disabled={!subject.trim() || !description.trim()}
                primaryColor={brandSecondary}
                primaryText={brandOnPrimary}
                submitLabel={saving ? labels.fabSubmitting : labels.fabSubmit}
                palette={palette}
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
              <div style={{ overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <Field label={labels.fabSubject} required palette={palette}>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    style={makeInputStyle(palette)}
                  />
                </Field>
                <Field label={labels.fabDescription} required palette={palette}>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    style={{ ...makeInputStyle(palette), resize: "none" }}
                  />
                </Field>
                {error && <ErrorBanner message={error} palette={palette} />}
              </div>
              <Footer
                onCancel={() => setOpen(false)}
                onSubmit={() => submit("message")}
                submitting={saving}
                disabled={!subject.trim() || !description.trim()}
                primaryColor={brandSecondary}
                primaryText={brandOnPrimary}
                submitLabel={saving ? labels.fabSubmitting : labels.fabSubmit}
                palette={palette}
              />
            </div>
          )}
        </div>
      </BrfModal>
    </div>
  );
}

// ── Internal helpers ────────────────────────────────────────────────────

// Themed input + dropzone — colors injected per-render from the parent's
// resolved palette so dark mode flows through. The constants below are
// shape-only (sizes, padding, transitions); colors come from props.

function makeInputStyle(palette: Palette): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    fontSize: 14,
    fontFamily: "inherit",
    color: palette.text,
    background: palette.inputBg,
    outline: "none",
  };
}

const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  borderRadius: 8,
  border: "2px dashed #d1d5db",
  background: "transparent",
  color: "#6b7280",
  cursor: "pointer",
  transition: "border-color 120ms, color 120ms, background 120ms",
};

function Field({ label, required, palette, children }: { label: string; required?: boolean; palette: Palette; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: palette.muted, marginBottom: 4 }}>
        {label}{required && <span style={{ color: "#f4561e", marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Thumb({ att, onRemove, palette }: { att: Attachment; onRemove: () => void; palette: Palette }) {
  const isImage = !!att.preview;
  return (
    <div
      style={{
        position: "relative",
        height: 64,
        ...(isImage
          ? { width: 64 }
          : { padding: "0 12px", display: "flex", alignItems: "center", gap: 8, background: palette.surface2 }),
        border: `1px solid ${palette.divider}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={att.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <>
          <svg width={24} height={24} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: palette.muted, flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 12, minWidth: 0, color: palette.text }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "10rem", fontWeight: 500 }}>{att.file.name}</span>
            <span style={{ fontSize: 10, color: palette.muted }}>{(att.file.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        style={{
          position: "absolute",
          inset: isImage ? 0 : "0 0 0 auto",
          width: isImage ? "auto" : 32,
          background: "rgba(0,0,0,0.5)",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          opacity: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "opacity 120ms",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0"; }}
      >
        <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ErrorBanner({ message, palette }: { message: string; palette: Palette }) {
  return (
    <p style={{ margin: 0, padding: "12px 16px", borderRadius: 8, background: palette.errorBg, color: palette.errorFg, fontSize: 14 }}>
      {message}
    </p>
  );
}

function Footer({
  onCancel, onSubmit, submitting, disabled, submitLabel, primaryColor, primaryText, palette,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  submitLabel: string;
  primaryColor: string;
  primaryText: string;
  palette: Palette;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: `1px solid ${palette.divider}` }}>
      <button
        type="button"
        onClick={onCancel}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: `1px solid ${palette.cancelBorder}`,
          background: palette.cancelBg,
          color: palette.cancelText,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Batal
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || disabled}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: primaryColor,
          color: primaryText,
          cursor: submitting || disabled ? "not-allowed" : "pointer",
          fontSize: 14,
          fontWeight: 600,
          opacity: submitting || disabled ? 0.5 : 1,
        }}
      >
        {submitLabel}
      </button>
    </div>
  );
}
