# @lalss/bug-report-fab

Federated bug-report FAB component for the lalss product family. Originally extracted from `mierakigai-crm-ops` 2026-05-09 to kill parallel-copy drift across CRM, ERP, PoS, and forum.

Sister package to [`@lalss/sections-kit`](https://github.com/lalss-dev/sections-kit) — same install pattern.

## Install

```jsonc
"@lalss/bug-report-fab": "github:lalss-dev/bug-report-fab#<sha>"
```

Float on `#main` for development; pin to a SHA before production deploys (Vercel runs `npm install` at build, so a moving target = surprise builds).

## Usage

```tsx
import { BugReportFab } from "@lalss/bug-report-fab";
import "@lalss/bug-report-fab/styles.css";

<BugReportFab
  brandPrimary="#5E1AF1"
  brandSecondary="#F4561E"
  app="crm"
  reporterEmail={user.email}
  reporterNama={user.nama}
  position="bottom-right"
  uploadImage={async (file, key) => {
    // Consumer's storage logic. Return public URL.
    const { error } = await supabase.storage
      .from("bug-reports").upload(key, file);
    if (error) throw error;
    return supabase.storage.from("bug-reports").getPublicUrl(key).data.publicUrl;
  }}
  onSubmit={async (payload) => {
    const { data, error } = await supabase.rpc("create_bug_report", {
      p_category: payload.category,
      p_subject: payload.subject,
      p_description: payload.description,
      p_priority: payload.priority,
      p_page_url: payload.pageUrl,
      p_image_urls: payload.imageUrls,
    });
    if (error) throw error;
    return { ticketId: data?.id ?? 0 };
  }}
/>
```

The package owns:

- FAB button (brand-colored)
- Form modal (subject, description, priority for bug/feature; subject + body for message)
- File attach (drag-drop + click), max 5 files / 10MB each, image preview thumbs + non-image generic chips
- Snip flow — html2canvas-pro renders the full viewport, drag-on-page rect crops it, no browser permission prompt
- Auto-capture: page_url (current pathname or full URL via `pageUrl` prop), viewport size, user-agent

The consumer owns:

- Identity (`reporterEmail`, `reporterNama`)
- Upload destination (`uploadImage` callback returns public URL)
- Submit destination (`onSubmit` callback receives the form payload)
- Optional `onAuditLog` for app-side audit trail

This split means the package stays storage- and database-agnostic; each consumer keeps writing to its own bucket and RPC, but the UI is identical.

## Roll a new version

1. Edit `src/`, then `npm run build` locally to verify.
2. `git commit && git push`.
3. `git rev-parse HEAD` for the new SHA.
4. Update each consumer's `package.json` `@lalss/bug-report-fab` to the new SHA.
5. `npm install` in each consumer.
