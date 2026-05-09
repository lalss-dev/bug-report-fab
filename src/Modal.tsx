// Minimal modal — package-internal so we don't depend on each consumer's
// Modal component. ESC + click-outside close. Body-scroll lock while open.
// Portal'd to document.body so transformed/blurred ancestors don't capture
// `position: fixed` (same containing-block trap that bit anima-pos).

import { useEffect } from "react";
import { createPortal } from "react-dom";

export function BrfModal({
  open,
  onClose,
  children,
  zIndex = 80,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  zIndex?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const overlay = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%" }}>
        {children}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
