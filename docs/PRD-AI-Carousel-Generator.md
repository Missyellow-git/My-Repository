# Product Requirements Document — AI Carousel Generator

**Working product name:** SlideForge (placeholder — final naming pending trademark clearance)
**Category:** AI-assisted social content creation (SaaS, B2C prosumer → B2B SMB/agency)
**Document version:** 1.0 (Draft for review)
**Date:** 2026-08-02
**Owner:** Product (PM)
**Contributors:** Founder/CEO, UX Research, Engineering (Architecture), Growth
**Status:** Draft — pending validation of the assumptions listed in §17

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [Problem Statement](#3-problem-statement)
4. [Market & Opportunity](#4-market--opportunity)
5. [User Personas](#5-user-personas)
6. [User Journeys](#6-user-journeys)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [MVP Scope](#9-mvp-scope)
10. [Future Roadmap](#10-future-roadmap)
11. [Monetization Strategy](#11-monetization-strategy)
12. [Subscription Plans](#12-subscription-plans)
13. [Success Metrics](#13-success-metrics)
14. [Competitive Analysis](#14-competitive-analysis)
15. [Risks & Mitigations](#15-risks--mitigations)
16. [Technical Requirements](#16-technical-requirements)
17. [Assumptions & Open Questions](#17-assumptions--open-questions)
18. [Appendices](#18-appendices)

---

## 1. Executive Summary

Carousels (multi-slide image posts on Instagram/Facebook/X, multi-page document posts on LinkedIn) are among the highest-engagement organic formats available to creators and brands. They are also among the most expensive to produce: a single 8-slide carousel typically costs a creator 45–90 minutes of writing, design, and export work, or $30–$150 when outsourced to a freelance designer.

**SlideForge turns a topic, a URL, or a rough draft into a publish-ready, on-brand carousel in under two minutes**, formatted correctly for Instagram, LinkedIn, Facebook, and X, and exportable as PNG/JPG/PDF or (later) published directly through platform APIs.

The wedge is not "AI writes text." Generic AI copy is a commodity. The wedge is **the full pipeline** — narrative structure → per-slide copy → automatic layout that never overflows → brand kit application → per-platform export at correct dimensions — delivered as one action, with a real editor for the last 10% of control.

**MVP target:** ship in 12 weeks, export-first (no publishing APIs), Instagram + LinkedIn first, freemium with watermark, Stripe-billed credit-backed subscriptions.

**Primary business objective for year 1:** reach $40K MRR with gross margin ≥ 78% and LTV/CAC ≥ 3.0.

---

## 2. Product Vision

### 2.1 Vision statement

> **Every professional should be able to publish a designer-quality carousel as easily as they send a message.**

Within three years, SlideForge intends to be the default surface where short-form visual narrative content is created — the "Loom for carousels": a category-defining tool people name as a verb, embedded in the daily workflow of creators, marketers, and small teams.

### 2.2 Product principles

| # | Principle | Implication for design decisions |
|---|---|---|
| P1 | **First result must be good, not editable-into-good** | We optimize the zero-edit output. Editor is a safety valve, not the workflow. |
| P2 | **Brand-consistent by default** | Brand kit is applied automatically; users should rarely touch colors/fonts. |
| P3 | **Design constraints beat design freedom** | Curated, structurally sound templates > infinite canvas. We are not Canva. |
| P4 | **Platform-native, not lowest-common-denominator** | Copy length, slide count, aspect ratio, and CTA style adapt per platform. |
| P5 | **Speed is a feature** | Sub-60s first draft, sub-10s re-render. Latency budgets are requirements, not aspirations. |
| P6 | **Own the output, not the lock-in** | Full-resolution export without watermark on paid tiers; no hostage-taking of user assets. |

### 2.3 Positioning statement

*For* creators, marketers, and small teams who publish on social media,
*who* need consistent, high-quality carousel content but lack design time or skill,
*SlideForge* is an AI carousel studio
*that* generates complete, on-brand, platform-ready carousels from a single prompt.
*Unlike* general design tools (Canva, Adobe Express) which start from a blank canvas, or general AI writers which stop at text,
*our product* delivers the finished, correctly-sized visual asset end-to-end.

### 2.4 Three-year north star trajectory

- **Year 1 — Creation:** best-in-class generation + editing + export. Own the "make it" job.
- **Year 2 — Distribution:** scheduling, direct publishing, performance analytics. Own the "ship it" job.
- **Year 3 — Learning loop:** performance-informed generation ("carousels like the ones that worked for you"), team workflows, API/white-label. Own the "make it work better" job.

---

## 3. Problem Statement

### 3.1 The core problem

Producing a carousel requires four distinct competencies in sequence — **strategy, copywriting, visual design, and per-platform production**. Most people have one or two. The result is a systematic gap: people know carousels perform well, but they publish them rarely and inconsistently.

### 3.2 Evidence and observed pain (from discovery interviews — n=27, see §18.C)

| Pain point | Frequency in interviews | Representative quote |
|---|---|---|
| Time cost per carousel (45–90 min) | 24/27 | "I can write the post in 10 minutes. It's the 40 minutes in Canva that kills me." |
| Blank-page paralysis on structure | 19/27 | "I don't know how to break my idea into 8 slides that actually flow." |
| Text overflow / manual re-fitting | 21/27 | "Every time I edit a line, the whole slide breaks and I re-do the spacing." |
| Cross-platform re-formatting | 17/27 | "I make it for LinkedIn, then I have to redo it 4:5 for Instagram." |
| Brand inconsistency over time | 15/27 | "My last 10 posts look like they're from 5 different companies." |
| Existing AI tools stop at text | 14/27 | "ChatGPT gives me the words. I still have to build the thing." |
| Cost of outsourcing | 11/27 (agency/SMB) | "$80 a carousel, 2-day turnaround, and I still do two rounds of revisions." |

### 3.3 Why now

1. **Model capability crossed the threshold.** Frontier LLMs now reliably produce structured, constraint-respecting output (JSON slide plans with per-slide character budgets), which is what makes deterministic, overflow-free layout possible. This was not true two years ago.
2. **Inference cost collapsed.** Per-generation model cost is now low enough (est. $0.02–$0.09) to support a freemium funnel at healthy gross margin.
3. **Format demand is at peak.** Carousels/document posts remain the highest-reach organic format on LinkedIn and Instagram, and platforms have expanded slide limits.
4. **Headless rendering is commoditized.** Serverless Chromium rendering makes pixel-accurate, font-embedded export cheap and reliable.
5. **The incumbent gap is real.** Design tools have added "AI" as a feature bolted onto a blank canvas. No one owns the *carousel-specific end-to-end job*.

### 3.4 Problem statement (formal)

> Creators and marketing teams cannot produce carousel content at the frequency their distribution strategy requires, because carousel production demands a sequential combination of narrative structuring, copywriting, visual design, and per-platform formatting that takes 45–90 minutes per asset and degrades in consistency over time. Existing solutions address individual steps (AI text, design canvases, schedulers) but force the user to be the integration layer.

### 3.5 What success looks like for the user

- Time-to-first-carousel: **< 5 minutes** (from signup to downloaded asset).
- Time-per-carousel at steady state: **< 8 minutes** including edits.
- Zero manual re-fitting of text.
- Output that a stranger cannot distinguish from designer-made.
- One source carousel → all four platforms, correctly formatted, in one click.

---

## 4. Market & Opportunity

### 4.1 Segments

| Segment | Description | Est. willingness to pay/mo | Priority |
|---|---|---|---|
| Solo creators / personal brands | LinkedIn thought-leaders, IG educators, newsletter writers | $19–$39 | **P0 (beachhead)** |
| Freelance social media managers | Manage 3–10 client accounts | $39–$59 | **P0** |
| SMB marketing teams (2–10) | In-house content function | $99–$199 | P1 |
| Agencies (10–50 seats) | White-label, volume, multi-brand | $299–$999 | P1 |
| Enterprise / brand compliance | SSO, approvals, brand governance | $2K+ | P2 (year 2+) |
| Developers / platforms | API for embedded carousel generation | usage-based | P2 (year 2+) |

### 4.2 Beachhead rationale

Start with **LinkedIn-first solo creators and freelance SMMs**. They have: acute, weekly, recurring pain; short purchase cycles (self-serve, credit card, no procurement); public output that becomes distribution ("Made with SlideForge" watermark on free tier); and they are the same people who later bring the tool into agencies and teams — a natural bottom-up expansion path.

### 4.3 Go-to-market motion (summary)

Product-led growth: free tier with watermark → organic loop from published carousels → SEO on "carousel maker / LinkedIn carousel generator" long tail → creator affiliate program (30% recurring, 12 months) → agency outbound in month 9+.

---

## 5. User Personas

### 5.1 Primary — "Priya, the Personal-Brand Creator"

| Attribute | Detail |
|---|---|
| Role | Independent consultant / LinkedIn creator, 14K followers |
| Age / context | 34, solo, works from laptop, mobile-heavy consumption |
| Technical skill | High on tools, **low on design** |
| Goals | Post 3×/week; grow inbound leads; look credible and premium |
| Jobs to be done | "When I have an idea worth sharing, help me turn it into a post that looks like I have a design team, before I lose the motivation." |
| Frustrations | Canva rabbit holes; inconsistent visuals; posting cadence collapses when busy |
| Success criteria | Carousel done in <10 min; visually consistent with prior posts; strong hook slide |
| Willingness to pay | $19–$29/mo, expects monthly cancel |
| Anti-goals | Does not want a design tool. Does not want 400 template choices. |

### 5.2 Primary — "Marcus, the Freelance Social Media Manager"

| Attribute | Detail |
|---|---|
| Role | Freelance SMM, 6 retainer clients |
| Age / context | 29, works in batches (content days), heavy on client approvals |
| Technical skill | High; power user of schedulers |
| Goals | Produce 40–60 assets/month across brands without hiring a designer |
| Jobs to be done | "When it's content day, let me batch-produce a month of on-brand carousels per client and get them approved fast." |
| Frustrations | Re-applying each client's brand manually; version chaos; client revision loops |
| Success criteria | Multi-brand kits; bulk generation; shareable review link; export presets per platform |
| Willingness to pay | $39–$59/mo (bills it to clients) |
| Anti-goals | Won't accept off-brand output. Watermarks are disqualifying. |

### 5.3 Secondary — "Dana, the SMB Marketing Manager"

| Attribute | Detail |
|---|---|
| Role | Marketing manager, 22-person B2B SaaS |
| Goals | Repurpose blog posts/webinars into social; maintain brand compliance |
| Jobs to be done | "When we publish a blog post, turn it into carousels for LinkedIn and Instagram without a design ticket." |
| Frustrations | Design team is a bottleneck; brand guidelines ignored under deadline |
| Success criteria | URL → carousel; locked brand kit; 2-person approval; analytics on what worked |
| Willingness to pay | $99–$199/mo (team seats, company card) |

### 5.4 Secondary — "Tomás, the Agency Content Lead"

| Attribute | Detail |
|---|---|
| Role | Content lead, 18-person agency, 25 client brands |
| Goals | Margin. Fewer designer hours per deliverable. |
| Jobs to be done | "Let junior staff produce senior-quality carousels at volume, in each client's brand, with approvals tracked." |
| Success criteria | Seats + roles, brand kit governance, white-label export, bulk/CSV generation, API |
| Willingness to pay | $299–$999/mo |

### 5.5 Anti-persona (explicitly not served in years 1–2)

**"Alex, the Professional Designer."** Wants pixel control, layers, masks, custom typography, and asset pipelines. Serving Alex means building Figma. Every request from this persona that pulls toward infinite-canvas editing is a **scope trap** and should be declined by default (see P3).

---

## 6. User Journeys

### 6.1 Journey A — First-time user (activation), Priya

| # | Stage | User action | System behavior | Emotional state | Design requirement |
|---|---|---|---|---|---|
| 1 | Discover | Sees a carousel with "Made with SlideForge" footer | — | Curious | Watermark must be tasteful and legible |
| 2 | Land | Hits landing page | Above-fold: prompt box, **generate before signup** | Skeptical | No signup wall before first value |
| 3 | Prompt | Types "5 mistakes founders make when hiring their first salesperson" | Detects intent, suggests platform + slide count | Hopeful | Smart defaults; zero required config |
| 4 | Generate | Clicks Generate | Streaming: outline (≤5s) → slides (≤25s) → rendered preview (≤45s total) | Anticipation | Progressive reveal; never a blank spinner |
| 5 | React | Sees 8 finished slides | Preview carousel with swipe | **Aha moment** | This is the activation event; instrument it |
| 6 | Tweak | Edits headline on slide 1, swaps theme | Live re-render <2s; auto-refit text | Control | No layout breakage, ever |
| 7 | Convert | Clicks Download | Signup wall (Google/email), free tier = watermarked PNG | Mild friction, accepted | Value delivered before ask |
| 8 | Publish | Posts to LinkedIn manually | "Mark as published" + next-step nudge | Pride | Capture publish event for metrics |
| 9 | Return | Day 3 email: "3 topic ideas based on your last carousel" | Personalized re-engagement | Reminded | Retention loop |
| 10 | Upgrade | Hits free limit / wants no watermark | Contextual paywall at moment of intent | Willing | Paywall at value, not at door |

**Activation definition:** user generates ≥1 carousel **and** exports it, within 24h of signup. Target: **≥40%** of signups.

### 6.2 Journey B — Power user weekly batch, Marcus

1. Opens workspace → selects client brand kit ("Northwind Coffee").
2. Bulk input: pastes 8 topics (or uploads CSV / connects blog RSS).
3. Selects platform matrix: LinkedIn (4:5) + Instagram (4:5) + X (16:9 4-card).
4. Runs batch generation → queue view with per-item status.
5. Reviews grid; regenerates 2 items with steering ("more contrarian hook", "shorter").
6. Sends a **review link** to the client; client comments per slide; Marcus resolves.
7. Bulk-exports approved set as ZIP (PNG per platform + LinkedIn PDF) + copies captions/hashtags.
8. Schedules in his existing scheduler (MVP) / schedules in-app (Phase 2).

**Key requirement surfaced:** multi-brand switching must be ≤2 clicks and impossible to get wrong (wrong-brand export is a trust-destroying error).

### 6.3 Journey C — Repurpose from source, Dana

Blog URL → system extracts article → proposes 3 carousel angles ("listicle", "myth-vs-fact", "step-by-step") → Dana picks one → generates → brand kit auto-applied (locked by admin) → sends for approval → approver signs off → export + hand-off to scheduler.

### 6.4 Journey D — Failure & recovery (must be designed explicitly)

| Failure | System behavior |
|---|---|
| Model timeout / provider outage | Auto-failover to secondary provider; if both fail, save the partial draft, no credit charged, clear message + retry CTA |
| Content policy refusal | Explain what was blocked in plain language, offer to rephrase, no credit charged |
| Text overflow risk detected | Auto-refit (font-step-down → line-clamp → AI shorten), never silent truncation of meaning; flag slide for review |
| Export job failure | Retry ×3 with backoff, then queue for async delivery + email link |
| User closes tab mid-generation | Job continues server-side; result appears in library and via email |

---

## 7. Functional Requirements

Priority: **P0** = MVP-blocking, **P1** = fast-follow (≤90 days post-launch), **P2** = roadmap.
Every requirement carries an ID for traceability to tickets and test cases.

### 7.1 Authentication, accounts & workspaces

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-A01 | Email + password and Google OAuth signup/login | P0 | Both flows complete in <30s; verified email required before export |
| FR-A02 | Anonymous "try before signup" generation | P0 | 1 generation per browser/IP per 24h; result claimable on signup |
| FR-A03 | Workspace container owning brand kits, projects, billing | P0 | Every asset belongs to exactly one workspace |
| FR-A04 | Invite teammates by email with roles: Owner, Admin, Editor, Viewer | P1 | Role changes take effect within one request cycle |
| FR-A05 | SSO (SAML/OIDC) | P2 | — |
| FR-A06 | Account deletion with full data purge ≤30 days | P0 | GDPR/CCPA compliant; confirmation email |

### 7.2 Input & content intake

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-I01 | Free-text topic prompt (≤500 chars) | P0 | Generates without any other input |
| FR-I02 | Long-form paste (≤20,000 chars) → carousel | P0 | Handles article-length input; summarizes to slide plan |
| FR-I03 | URL import (blog/article) with readable-content extraction | P0 | ≥90% success on top-1000 CMS patterns; graceful failure message |
| FR-I04 | Guided mode: topic + audience + tone + goal + slide count | P0 | All optional; sensible defaults pre-filled |
| FR-I05 | Content type presets: Listicle, How-to, Myth-vs-Fact, Case Study, Story, Data/Stats, Hot Take, Before-After, Framework, Q&A | P0 | ≥10 presets; each maps to a distinct narrative skeleton |
| FR-I06 | File import: PDF/DOCX/TXT → carousel | P1 | ≤10MB |
| FR-I07 | YouTube/podcast transcript → carousel | P2 | — |
| FR-I08 | RSS/blog auto-watch → draft carousels | P2 | — |
| FR-I09 | Bulk input: up to 20 topics via textarea or CSV | P1 | Queued batch with per-item status |

### 7.3 AI generation

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-G01 | Two-stage generation: (a) narrative outline, (b) per-slide copy bound to layout character budgets | P0 | Output validates against JSON schema; 100% of slides within budget or auto-refit |
| FR-G02 | Hook-slide optimization: generate 3 hook variants, pick/rank | P0 | User can cycle variants without regenerating the deck |
| FR-G03 | Platform-aware generation (slide count, copy length, CTA, tone per platform) | P0 | LinkedIn ≠ Instagram output for identical input |
| FR-G04 | Per-slide regeneration with steering prompt | P0 | Regenerates only the target slide; ≤6s; preserves rest of deck |
| FR-G05 | Full-deck regeneration with steering ("more data", "funnier", "shorter") | P0 | ≤45s |
| FR-G06 | Caption + hashtag generation per platform | P0 | LinkedIn ≤3000 chars, IG ≤2200 chars, X ≤280 chars per post |
| FR-G07 | Tone controls: Professional, Conversational, Bold/Contrarian, Educational, Inspirational, Witty | P0 | Measurably distinct outputs (validated by eval set) |
| FR-G08 | Brand voice profile learned from 3–10 user-supplied samples | P1 | Applied automatically to all generations in workspace |
| FR-G09 | Multi-language generation (10 languages at launch+) | P1 | Font subset must support target script |
| FR-G10 | AI image/illustration generation for slide backgrounds | P1 | Per-generation credit cost; policy-filtered |
| FR-G11 | "Remix" — variant of an existing carousel for a different platform/angle | P1 | Preserves brand + core message |
| FR-G12 | Streaming/progressive output (outline visible before slides finish) | P0 | First visible token ≤5s |
| FR-G13 | Factual-claim flagging: statistics/claims marked "verify before publishing" | P0 | Any numeric or statistical claim gets a review chip |
| FR-G14 | Content safety filter (hate, harassment, sexual, self-harm, medical/financial/legal advice guardrails) | P0 | Blocked requests explained; logged; no credit charged |

### 7.4 Templates, design & brand

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-D01 | Curated template library, ≥15 template families at launch, each with ≥6 slide-role layouts (cover, list item, quote, stat, image, CTA) | P0 | Every template renders correctly at all supported aspect ratios |
| FR-D02 | Brand kit: logo, 5 brand colors, 2 fonts, footer handle/avatar, CTA text | P0 | Applied to all templates without breaking contrast |
| FR-D03 | Multiple brand kits per workspace | P1 | Switch in ≤2 clicks; active kit always visible in UI |
| FR-D04 | Brand kit extraction from a website URL (logo, palette, fonts) | P1 | ≥70% acceptable-without-edit rate |
| FR-D05 | Automatic contrast enforcement (WCAG AA on all text) | P0 | No generated slide ships below 4.5:1 for body text |
| FR-D06 | Automatic text fitting (no overflow, no clipping) | P0 | 0 overflow defects in a 500-deck regression corpus |
| FR-D07 | Theme variants per template (light/dark/accent) | P0 | One-click switch, no re-generation |
| FR-D08 | Stock image search + insert (licensed provider) | P1 | Attribution handled automatically where required |
| FR-D09 | Custom font upload | P2 | Requires user license attestation |
| FR-D10 | Admin-locked brand kits (users cannot override) | P2 | Enterprise governance |

### 7.5 Editor

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-E01 | Slide-strip navigation with reorder (drag), add, duplicate, delete | P0 | Reorder persists; undo available |
| FR-E02 | Inline text editing with live auto-refit | P0 | ≤100ms visual response |
| FR-E03 | Per-slide layout swap without losing content | P0 | Content maps to nearest equivalent slot |
| FR-E04 | Image upload/replace per slide with crop & focal point | P0 | ≤10MB, JPEG/PNG/WebP |
| FR-E05 | Undo/redo (≥50 steps) | P0 | Keyboard shortcuts |
| FR-E06 | Autosave (≤2s debounce) + version history (last 20 versions) | P0 | No data loss on tab close |
| FR-E07 | Slide count limits enforced per platform | P0 | UI prevents exceeding platform maximum |
| FR-E08 | AI inline actions on selected text: shorten, expand, rephrase, fix tone | P1 | ≤3s |
| FR-E09 | Real-time multiplayer editing | P2 | — |
| FR-E10 | Comment threads per slide (async review) | P1 | Mentions notify by email |

### 7.6 Export & publishing

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-X01 | Export PNG (per slide) and JPG | P0 | 2× pixel density; correct dimensions per platform preset |
| FR-X02 | Export multi-page PDF (LinkedIn document post) | P0 | Fonts embedded; text selectable where possible; ≤100MB |
| FR-X03 | ZIP bundle of all slides + captions .txt | P0 | Deterministic file naming: `01-cover.png` … |
| FR-X04 | Platform presets: IG 4:5 (1080×1350) & 1:1, LinkedIn 4:5 & 1:1, Facebook 1:1, X 16:9 & 1:1 | P0 | Pixel-exact; verified against a spec table maintained in code |
| FR-X05 | One-source → multi-platform re-render (reflow, not stretch) | P0 | Text re-fits per ratio; no distortion |
| FR-X06 | Watermark on free tier; removable on paid | P0 | Watermark non-removable client-side (applied server-side) |
| FR-X07 | Copy caption + hashtags to clipboard, per platform | P0 | One click |
| FR-X08 | Shareable public preview link (view/comment) | P1 | Revocable; no login required to view |
| FR-X09 | Direct publish to LinkedIn (personal + company page) | P1* | *Subject to API access approval — see RISK-04 |
| FR-X10 | Direct publish to Instagram (Business/Creator via Graph API) | P1* | Carousel container flow |
| FR-X11 | Direct publish to Facebook Page | P1* | — |
| FR-X12 | Direct publish to X | P2* | Subject to API tier cost |
| FR-X13 | Scheduling calendar + queue with timezone handling | P1 | Retries on transient publish failure; user-visible failure state |
| FR-X14 | Export to Buffer/Hootsuite/Later via integration or webhook | P2 | — |

### 7.7 Library & organization

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-L01 | Project library with thumbnail grid, search, sort by date | P0 | — |
| FR-L02 | Duplicate project | P0 | — |
| FR-L03 | Folders/tags, filter by brand kit and platform | P1 | — |
| FR-L04 | Trash with 30-day recovery | P1 | — |
| FR-L05 | Content calendar view | P2 | — |

### 7.8 Billing & account management

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-B01 | Stripe Checkout for subscription purchase | P0 | Monthly + annual |
| FR-B02 | Self-serve upgrade/downgrade/cancel (Stripe Customer Portal) | P0 | Proration handled by Stripe |
| FR-B03 | Credit meter: visible balance, consumption per action, monthly reset | P0 | Never charge for a failed generation |
| FR-B04 | Overage: buy credit top-up packs | P1 | — |
| FR-B05 | Usage-limit emails at 80% / 100% | P1 | — |
| FR-B06 | Dunning: retry failed payments, grace period 7 days, then downgrade to free | P0 | Assets never deleted on downgrade; export gated instead |
| FR-B07 | Invoices/VAT handling for EU/UK/IN | P0 | Stripe Tax |
| FR-B08 | Affiliate/referral tracking | P1 | 30% recurring, 12 months |

### 7.9 Analytics (product-facing)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-N01 | Per-carousel record of exports/publishes | P1 | — |
| FR-N02 | Post-performance import (impressions, engagement) from connected accounts | P2 | Requires publish integrations |
| FR-N03 | "What worked" insights → feed back into generation | P2 | Year-2 differentiator |

### 7.10 Admin & internal tooling

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-M01 | Internal admin: user lookup, credit grant, plan override, impersonate (audited) | P0 | Every impersonation logged with reason |
| FR-M02 | Prompt/model version registry with per-version quality eval scores | P0 | Rollback in ≤5 min |
| FR-M03 | Feature flags + % rollouts | P0 | — |
| FR-M04 | Abuse controls: rate limits, disposable-email blocking, generation anomaly alerts | P0 | — |

---

## 8. Non-Functional Requirements

### 8.1 Performance

| ID | Requirement | Target | Hard limit |
|---|---|---|---|
| NFR-P01 | Time to first streamed output | ≤5s p50 | ≤10s p95 |
| NFR-P02 | Full 8-slide generation + first render | ≤45s p50 | ≤90s p95 |
| NFR-P03 | Single-slide regeneration | ≤6s p50 | ≤15s p95 |
| NFR-P04 | Editor keystroke → visual update | ≤100ms | ≤250ms |
| NFR-P05 | Export (8 slides, PNG 2×) | ≤12s p50 | ≤30s p95 |
| NFR-P06 | App shell load (LCP) | ≤2.0s on 4G | ≤3.5s |
| NFR-P07 | Batch of 20 carousels | ≤10 min | ≤20 min |

### 8.2 Scalability & reliability

| ID | Requirement |
|---|---|
| NFR-S01 | Support 10,000 MAU / 3,000 concurrent editor sessions at launch scale; horizontal scale path to 100K MAU without re-architecture |
| NFR-S02 | Render workers auto-scale on queue depth; target queue wait ≤5s p95 |
| NFR-S03 | Uptime ≥99.9% monthly for the app; ≥99.5% for generation (dependent on third-party models) |
| NFR-S04 | Graceful degradation: if the primary model provider fails, fail over to secondary within 3s; if all fail, editor and export remain fully functional |
| NFR-S05 | All long-running work is a durable, idempotent job; no work is lost on deploy or worker restart |
| NFR-S06 | RPO ≤5 min, RTO ≤1h; daily DB backups retained 30 days; quarterly restore drills |

### 8.3 Security

| ID | Requirement |
|---|---|
| NFR-SEC01 | TLS 1.3 in transit; AES-256 at rest (DB, object storage) |
| NFR-SEC02 | Strict workspace-level tenant isolation enforced at the data layer (row-level policies + application guard); no cross-tenant read is possible via any API path |
| NFR-SEC03 | Secrets in a managed secret store; never in source or client bundles |
| NFR-SEC04 | OAuth tokens for social publishing encrypted with envelope encryption; scoped minimally; revocable by user |
| NFR-SEC05 | Signed, expiring URLs (≤15 min) for all private asset access |
| NFR-SEC06 | Prompt-injection defense: content fetched from user-supplied URLs is treated as untrusted data and never as instructions |
| NFR-SEC07 | Rate limiting per IP/user/workspace on all generation and export endpoints |
| NFR-SEC08 | Annual third-party penetration test; SOC 2 Type II readiness by month 18 |
| NFR-SEC09 | Dependency and container scanning in CI; block on critical CVEs |

### 8.4 Privacy & compliance

| ID | Requirement |
|---|---|
| NFR-C01 | GDPR + CCPA: export and delete on request, ≤30 days |
| NFR-C02 | Data processing agreement with all subprocessors; public subprocessor list |
| NFR-C03 | **User content is not used to train third-party models**; contractual zero-retention or ≤30-day retention with model vendors. This is a marketing claim and must be contractually true. |
| NFR-C04 | Cookie consent (EU), analytics opt-out |
| NFR-C05 | AI transparency: users informed content is AI-generated; provenance metadata retained internally |
| NFR-C06 | Data residency option (EU) | P2 |

### 8.5 Accessibility & usability

| ID | Requirement |
|---|---|
| NFR-A01 | App UI conforms to WCAG 2.1 AA (keyboard navigation, focus states, screen-reader labels on all controls) |
| NFR-A02 | Generated slide output enforces AA contrast for text (FR-D05) |
| NFR-A03 | Auto-generated alt text per slide, included in export bundle and in direct publishes |
| NFR-A04 | Responsive: full generation + export on tablet; view/light-edit + export on mobile web (full mobile editor is P2) |
| NFR-A05 | Localized UI: EN at launch; ES, PT, DE, FR by month 9 |

### 8.6 Quality & maintainability

| ID | Requirement |
|---|---|
| NFR-Q01 | Golden-set evaluation of ≥200 prompts run on every prompt/model change; ship only if quality score is non-regressive |
| NFR-Q02 | Visual regression tests on all templates × ratios × themes on every render-engine change |
| NFR-Q03 | ≥70% unit coverage on layout/fitting engine and billing logic (the two highest-risk subsystems) |
| NFR-Q04 | Structured logging with trace IDs across API → queue → worker → model call |
| NFR-Q05 | Every AI call recorded with prompt version, model, tokens, latency, cost |

### 8.7 Cost efficiency

| ID | Requirement |
|---|---|
| NFR-CO1 | Blended COGS per generated carousel ≤ $0.12 (model + render + storage + bandwidth) |
| NFR-CO2 | Target gross margin ≥78% at plan-level pricing |
| NFR-CO3 | Prompt caching and model tiering (cheap model for classification/short edits, frontier model for narrative generation) |
| NFR-CO4 | Hard per-user daily spend ceiling to cap abuse-driven cost |

---

## 9. MVP Scope

**Objective of MVP:** prove that a single-prompt generation produces output users are willing to publish and pay for. Everything not serving that proof is cut.

**Timeline:** 12 weeks to public launch. **Team assumption:** 2 full-stack engineers, 1 designer (0.5 FTE), 1 PM/founder, 1 AI/prompt engineer (0.5 FTE).

### 9.1 In scope (MVP)

| Area | Included |
|---|---|
| Platforms | **Instagram (4:5, 1:1) and LinkedIn (4:5, 1:1 PDF)** fully; Facebook (1:1) and X (16:9) as export presets reusing the same engine |
| Input | Topic prompt, long-text paste, URL import, content-type presets, tone selector |
| Generation | Two-stage outline→slides, hook variants, per-slide + full regeneration with steering, captions + hashtags, safety filter, claim flagging |
| Design | 15 template families, single brand kit per workspace, auto contrast, auto text-fit, light/dark/accent themes |
| Editor | Text edit, reorder/add/duplicate/delete slides, layout swap, image upload, undo/redo, autosave |
| Export | PNG/JPG per slide, LinkedIn PDF, ZIP bundle, caption copy, watermark on free |
| Accounts | Email + Google auth, single workspace, anonymous first-generation |
| Billing | Stripe: Free, Creator, Pro (monthly + annual), credit meter, dunning |
| Library | Grid, search, duplicate |
| Ops | Admin tooling, prompt registry, feature flags, analytics, error tracking, eval harness |

### 9.2 Explicitly out of scope (MVP)

| Excluded | Rationale |
|---|---|
| Direct publishing / scheduling | Platform API approval (esp. LinkedIn document posts) has long, uncertain lead times. Building the product's core value on a dependency we don't control at week 1 is the single biggest schedule risk. Export-first still solves the job. **Apply for API access in week 1 in parallel.** |
| Team seats, roles, approvals | Beachhead is solo users; adds auth complexity for a segment we haven't validated |
| Real-time collaboration | Very high cost, low MVP value |
| Multi-brand kits | P1, needed for SMM segment — ship in month 4 |
| AI image generation | Cost + safety surface; stock library covers MVP |
| Custom font upload | Font licensing liability |
| Mobile native apps | Mobile web is sufficient |
| Analytics/performance loop | Requires publishing integrations |
| API / white-label | No demand evidence yet |
| Video/animated carousels | Different rendering pipeline entirely |

### 9.3 MVP build sequence

| Phase | Weeks | Deliverable | Exit criteria |
|---|---|---|---|
| 0 — Foundations | 1–2 | Repo, CI/CD, auth, DB schema, workspace model, feature flags, telemetry | Deploy to prod on every merge |
| 1 — Render engine | 2–5 | Template DSL, layout + auto-fit engine, headless render worker, export (PNG/PDF/ZIP) | 5 templates × 3 ratios × 3 themes render pixel-correct; zero overflow on test corpus |
| 2 — AI pipeline | 4–7 | Outline/slide generation, schema validation, platform adaptation, captions, safety, eval harness | ≥80% of golden-set outputs rated "publishable without edit" by internal reviewers |
| 3 — Editor | 6–9 | Slide strip, inline editing, regeneration, image upload, autosave, versioning | Task-completion ≥90% in usability tests (n=8) |
| 4 — Monetization + polish | 9–11 | Stripe, credits, watermark, paywalls, library, onboarding, landing page | End-to-end paid purchase in production |
| 5 — Beta → launch | 11–12 | 50-user private beta, bug burn-down, launch assets | Activation ≥35%, NPS ≥30, no P0 defects open |

### 9.4 MVP launch gate (go/no-go)

- ≥40% of beta users export at least one carousel.
- ≥25% of beta users generate ≥3 carousels in week 1.
- ≥15% of beta users state intent to pay (or convert during beta pricing).
- p95 generation ≤90s; export success rate ≥99%.
- Zero known cross-tenant data-access defects.

---

## 10. Future Roadmap

Themes are sequenced by the value ladder: **Create → Distribute → Learn → Scale.**

### Phase 2 — "Ship it" (months 4–6)

| Item | Value |
|---|---|
| Multi-brand kits + brand extraction from URL | Unlocks freelance SMM segment |
| Team seats, roles, comment threads, approval flow | Unlocks SMB/agency |
| Direct publishing (LinkedIn, Instagram, Facebook) + scheduling calendar | Removes the manual last mile |
| Bulk/batch generation (20 at once) + CSV | Agency volume |
| Brand voice learned from samples | Differentiation vs. generic AI output |
| AI inline text actions | Editing speed |
| Public review/share links | Client approval loop |

### Phase 3 — "Make it work better" (months 7–12)

| Item | Value |
|---|---|
| Performance analytics import + "what worked" insights | Compounding data moat |
| Performance-informed generation (hooks like your top posts) | Real, defensible differentiation |
| AI image/illustration generation + background removal | Visual variety |
| Content calendar + series/campaign planning | Workflow stickiness |
| Multi-language (10 languages) | Market expansion |
| Chrome extension: any page → carousel | Top-of-funnel growth loop |
| Template marketplace (creator-submitted, rev-share) | Supply-side growth |

### Phase 4 — "Scale" (year 2)

| Item | Value |
|---|---|
| Public API + webhooks | Platform/dev segment |
| White-label for agencies (custom domain, agency branding) | High-ACV segment |
| SSO, audit logs, admin-locked brand governance, SOC 2 | Enterprise |
| Animated/video carousels (MP4 export, Reels/Shorts) | Format expansion |
| Threads, TikTok carousel, Pinterest, YouTube community posts | Platform expansion |
| Slack/Notion/HubSpot integrations | Workflow embedding |
| Agent mode: autonomous weekly content pipeline from a strategy brief | Next-gen product bet |

**Roadmap discipline:** each phase must clear a metric gate before the next begins (Phase 2 gate: 1,000 paying customers or $25K MRR; Phase 3 gate: NRR ≥100% and paid retention M3 ≥70%).

---

## 11. Monetization Strategy

### 11.1 Model

**Freemium SaaS with credit-metered subscriptions**, monthly and annual, self-serve, plus a usage top-up mechanism and an agency/enterprise contract tier.

Rationale for credits rather than unlimited: AI generation has real marginal cost (NFR-CO1), and unlimited plans invite the 2% of users who consume 60% of COGS. Credits make cost predictable, make upgrades natural (users hit a wall while in a state of high intent), and let us price image generation and other expensive actions separately.

**Credit design:**

| Action | Credits |
|---|---|
| Full carousel generation (≤10 slides) | 1 |
| Full carousel generation (11–20 slides) | 2 |
| Full-deck regeneration | 1 |
| Single-slide regeneration | 0.2 |
| Caption/hashtag regeneration | 0.1 |
| Platform remix (re-render existing deck to another platform) | 0 (free — drives multi-platform habit) |
| AI image generation | 0.5 per image |
| Export | 0 (never charge for export — exports are the value moment) |
| Failed generation | 0 (never charged) |

### 11.2 Free-tier strategy

Free tier exists to (a) deliver the aha moment with no friction and (b) generate distribution via watermark. It is deliberately **useful but not sufficient**: 5 carousels/month, watermarked exports, 1 brand kit, 3 templates.

The two upgrade triggers are **watermark removal** (identity/professionalism) and **credit exhaustion** (volume). Both are surfaced contextually at the moment of intent, never as an interstitial on load.

### 11.3 Conversion levers

| Lever | Mechanism |
|---|---|
| Watermark | Visible on every free export; removal is the single most cited upgrade reason in this category |
| Credit wall | Contextual upgrade modal at 80% and 100% consumption |
| Premium templates | ~60% of template library gated to paid |
| Export formats | PDF export (LinkedIn) and ZIP gated to paid |
| Brand kits | >1 kit is paid (the SMM trigger) |
| Annual discount | ~2 months free (≈17–20%) — improves cash and reduces churn |
| Team seats | Per-seat expansion revenue |

### 11.4 Secondary revenue (year 2)

- **Usage overage packs** (e.g., 50 credits for $9) — margin-accretive, no plan-migration friction.
- **Template marketplace** — 70/30 rev share with creators.
- **Affiliate program** — 30% recurring for 12 months; a cost, but the cheapest CAC in this category.
- **API/usage-based** — $/generation for embedded partners.
- **White-label** — annual contracts, $500–$2,000/mo.

### 11.5 Unit economics targets

| Metric | Target |
|---|---|
| Blended COGS / carousel | ≤$0.12 |
| Gross margin | ≥78% |
| Blended CAC (self-serve) | ≤$45 |
| ARPU | ≥$26/mo |
| LTV (at 5% monthly churn, 78% GM) | ≈$405 |
| LTV/CAC | ≥3.0 (target 4.0 by month 12) |
| CAC payback | ≤5 months |
| Free→paid conversion | 4–6% |

*These are targets, not forecasts. Every one requires validation against real cohort data before it is used for planning.*

---

## 12. Subscription Plans

All prices USD, excl. tax. Annual billing = 2 months free.

| | **Free** | **Creator** | **Pro** | **Team** | **Agency / Enterprise** |
|---|---|---|---|---|---|
| **Price (monthly)** | $0 | $19 | $39 | $99 | From $299 (annual contract) |
| **Price (annual/mo)** | $0 | $15 | $32 | $82 | Custom |
| **Target persona** | Trial / casual | Priya (creator) | Marcus (freelance SMM) | Dana (SMB team) | Tomás (agency) |
| **Carousel credits / mo** | 5 | 50 | 200 | 600 (pooled) | Custom / unlimited-fair-use |
| **Watermark** | Yes | No | No | No | No |
| **Slides per carousel** | 6 | 20 | 20 | 20 | 20 |
| **Templates** | 3 | All | All + premium | All + premium | All + custom-built |
| **Brand kits** | 1 (limited) | 1 | 10 | 25 | Unlimited |
| **Platforms** | IG + LinkedIn | All 4 | All 4 | All 4 | All 4 |
| **Exports** | PNG only | PNG, JPG, PDF, ZIP | + bulk ZIP | + bulk ZIP | + white-label export |
| **Direct publish + scheduling** (Ph. 2) | — | 2 accounts | 6 accounts | 15 accounts | Unlimited |
| **Bulk generation** | — | — | 20/batch | 20/batch | 100/batch |
| **Brand voice training** | — | — | Yes | Yes | Yes |
| **Seats** | 1 | 1 | 1 | 5 (+$18/extra) | Custom |
| **Comments & approvals** | — | — | — | Yes | Yes + multi-stage |
| **Analytics** (Ph. 3) | — | Basic | Full | Full | Full + export |
| **API access** (Ph. 4) | — | — | — | — | Yes |
| **Support** | Docs/community | Email (48h) | Priority email (24h) | Priority (12h) | Dedicated CSM + SLA |
| **SSO / audit logs / DPA** | — | — | — | DPA | Yes |

**Additional commercial rules**

- **Credit top-ups:** 50 credits / $9, 150 / $22 (paid plans only; never expire while subscription active).
- **Unused credits:** roll over up to 1× monthly allowance (prevents "use it or lose it" churn pressure).
- **Trial:** Pro features free for 7 days on signup, no card required — converts to Free automatically (no involuntary charge; protects trust and reduces chargebacks).
- **Student/nonprofit:** 50% off Creator on verification.
- **Downgrade behavior:** assets are never deleted; exports of previously created assets remain available, new generation is limited to the lower tier.
- **Annual refund policy:** 30-day full refund, no questions — cheap insurance against negative reviews.

---

## 13. Success Metrics

### 13.1 North Star Metric

> **Weekly Published Carousels per Active Workspace (WPC/AW)**

Chosen because it captures the whole value chain: the user found a topic, the AI produced something good enough, and they were confident enough to put it in front of their audience. It cannot be gamed by generation alone (which is cheap) or logins (which are meaningless). *Published* = exported or directly published.

**Targets:** 1.5 at launch → 2.5 by month 6 → 3.5 by month 12.

### 13.2 AARRR funnel metrics

| Stage | Metric | Launch target | M12 target |
|---|---|---|---|
| Acquisition | Monthly signups | 1,500 | 12,000 |
| | Visitor→signup rate | 6% | 10% |
| | CAC (blended) | ≤$60 | ≤$45 |
| Activation | Generate + export within 24h | 40% | 55% |
| | Time to first export | ≤6 min | ≤4 min |
| | Anonymous generation → signup | 25% | 35% |
| Retention | W1 → W4 workspace retention | 30% | 45% |
| | Paid logo retention M3 | 65% | 80% |
| | Monthly paid churn | ≤7% | ≤4% |
| Revenue | Free→paid conversion | 3% | 5.5% |
| | MRR | $4K (M1) | $40K |
| | ARPU | $22 | $28 |
| | NRR | 90% | 105% |
| Referral | % of users sharing/watermark-attributed signups | 8% | 15% |
| | Affiliate-sourced MRR | — | 12% |

### 13.3 Product-quality metrics (the ones that actually predict retention)

| Metric | Definition | Target |
|---|---|---|
| **Zero-edit export rate** | % of exported carousels published with no manual text edits | ≥35% |
| **Regeneration rate** | Avg. full-deck regenerations per accepted carousel (proxy for first-shot quality; lower is better) | ≤0.8 |
| **Slide deletion rate** | % of generated slides deleted by users | ≤12% |
| **Layout defect rate** | Overflow/clipping/contrast defects per 1,000 rendered slides | ≤1 |
| **Export success rate** | Successful export jobs / attempted | ≥99.5% |
| **Generation success rate** | Non-error generations / attempted | ≥98% |
| **p95 generation latency** | — | ≤90s |
| **Multi-platform usage** | % of carousels exported for ≥2 platforms | ≥40% |
| **CSAT on generation** (thumbs on result) | positive / total rated | ≥75% |
| **NPS** | quarterly survey | ≥40 by M12 |

### 13.4 Cost & efficiency metrics

| Metric | Target |
|---|---|
| COGS per generation | ≤$0.12 |
| Gross margin | ≥78% |
| Model spend as % of revenue | ≤12% |
| Support tickets per 100 active users | ≤4 |
| Infra cost per active workspace / mo | ≤$1.10 |

### 13.5 Measurement plan

- **Instrumentation:** product analytics (event-based) with a documented tracking plan; every FR that represents a user intent emits a named event with workspace, plan, platform, template, and prompt-version properties.
- **Experimentation:** feature-flagged A/B with pre-registered primary metric and minimum detectable effect; no shipping on eyeballing.
- **Qualitative cadence:** 5 user interviews/month; in-app thumbs-up/down on every generated deck feeding the eval corpus.
- **Weekly business review:** North Star, activation, paid churn, COGS/generation, p95 latency, layout defect rate.

---

## 14. Competitive Analysis

### 14.1 Landscape map

| Category | Examples | What they own | Where they lose |
|---|---|---|---|
| **General design tools** | Canva, Adobe Express, Visme | Brand recognition, template breadth, free tier, distribution | Blank-canvas workflow; carousel is a template, not a pipeline; manual per-slide copy; manual re-sizing; AI bolted on |
| **Carousel-specific tools** | ContentDrips, Postdrips, Carrd-style niche builders | Purpose-built templates, LinkedIn/PDF export | Weaker AI narrative generation; limited brand automation; small template systems; often single-platform |
| **LinkedIn creator suites** | Taplio, Supergrow, AuthoredUp | Distribution + analytics + LinkedIn-native workflows | Carousel design quality is secondary to text; single-platform |
| **Social schedulers** | Buffer, Later, Hootsuite, Publer | Scheduling, multi-account, analytics, incumbency | Do not *create* designed carousels; asset creation is upstream of them |
| **General AI writers/agents** | Frontier chat assistants, Jasper, Copy.ai | Copy quality, flexibility | Output is text, not a finished visual asset in platform dimensions |
| **Marketplaces/freelancers** | Fiverr, Upwork designers | Bespoke quality | $30–$150 and 1–3 day turnaround per asset; not scalable |
| **Platform-native tools** | In-app editors | Free, zero friction | Minimal design capability; no brand kits; no cross-platform |

*(Feature and pricing details of competitors change frequently; the table above states category-level positions. A maintained competitive tracker with dated, sourced entries is a required artifact — see §17 OQ-7.)*

### 14.2 Competitive positioning matrix

| Capability | Canva-class | Carousel-niche tools | LinkedIn suites | Schedulers | **SlideForge** |
|---|---|---|---|---|---|
| One-prompt → full deck | Partial | Partial | Partial (text) | No | **Yes** |
| Narrative structuring (not just copy) | No | No | Partial | No | **Yes** |
| Guaranteed no-overflow auto-layout | No | Partial | n/a | n/a | **Yes** |
| Brand kit auto-application | Yes (paid) | Partial | Limited | n/a | **Yes** |
| All 4 platforms, correct specs, one source | Manual | Partial | No | Partial | **Yes** |
| LinkedIn PDF document export | Manual | Yes | Yes | No | **Yes** |
| Publishing + scheduling | No | Rare | Yes | **Yes** | Phase 2 |
| Performance→generation feedback loop | No | No | Partial | Partial | Phase 3 |
| Price point | $$ | $ | $$ | $$ | $ – $$ |

### 14.3 Our differentiation (ranked by defensibility)

1. **End-to-end pipeline as one action.** Competitors own a step; we own the job. Hardest thing for a horizontal design tool to copy is *removing* choices.
2. **Deterministic layout engine with guaranteed text fitting.** This is real engineering, not a prompt. It's the difference between "AI made a draft" and "AI made a finished asset," and it is what makes zero-edit export possible.
3. **Platform-native adaptation from one source.** One idea → four correctly-specified outputs, reflowed rather than stretched.
4. **Brand-voice + brand-kit personalization** (Phase 2) — output that is recognizably *yours* raises switching cost.
5. **Performance feedback loop** (Phase 3) — the only truly compounding moat: proprietary data connecting carousel structure to real engagement outcomes.

### 14.4 Competitive threats and honest assessment

| Threat | Likelihood | Assessment |
|---|---|---|
| Canva ships a strong one-prompt carousel generator | **High** | Assume it happens within 12 months. Our defense is depth (platform-specific, brand-voice, performance loop) and speed, not feature parity. We must not be a worse Canva. |
| Platforms add native AI carousel creation | Medium | Would compress the low end; free tier suffers most. Defense: multi-platform (they will only serve their own) and brand/workflow features. |
| A frontier assistant with image generation does this in one chat turn | Medium-High | Chat output lacks brand kits, exact specs, editing, versioning, team workflow, and reliability. Defense: be a *system of record* for content, not a one-shot generator. |
| Price war among niche carousel tools | High | Do not compete on price; compete on zero-edit quality. |
| Model cost increase or API access loss | Medium | Multi-provider abstraction from day 1 (see §16). |

### 14.5 Why we can win

The winner in this category will be whoever gets **zero-edit quality** highest, fastest, for a *specific* set of platforms — not whoever has the most features. That is a focus problem and an engineering problem (layout + eval discipline), both of which favor a small, fast team over a horizontal incumbent for whom carousels are one template category among thousands.

---

## 15. Risks & Mitigations

| ID | Risk | Category | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-01 | **AI output quality is "fine, not good"** — users regenerate constantly and churn | Product | High | Critical | Golden-set eval harness before launch; hook-variant generation; ship only on non-regressive quality scores; measure zero-edit rate weekly as a leading indicator | PM + AI eng |
| RISK-02 | **Output homogeneity** — everyone's carousels look the same, brand dilution, "AI slop" backlash | Product/Brand | High | High | ≥15 visually distinct template families; brand kit + brand voice; randomized layout selection within a deck; templates roadmap treated as ongoing content supply, not one-time build | Design |
| RISK-03 | **Layout/rendering defects** (overflow, clipping, bad contrast) destroy trust instantly | Technical | Medium | Critical | Deterministic fitting engine with hard constraints; visual regression suite across templates × ratios × themes; defect rate as a tracked SLO | Eng |
| RISK-04 | **Platform API dependency** — LinkedIn document-post publishing requires partner approval; IG/FB require app review; X API pricing is volatile | Business/Technical | High | High | **MVP is export-first**, so the core product never blocks on API access; apply in week 1; treat all publishing as an enhancement layer behind flags; never advertise a publish integration before it is approved and live | Founder |
| RISK-05 | **Model provider outage, deprecation, or price increase** | Technical/Financial | Medium | High | Provider-agnostic abstraction with ≥2 vendors; prompt registry portable across models; cost per generation monitored daily with alert thresholds; margin buffer priced in | Eng |
| RISK-06 | **Font & stock-asset licensing** — embedding fonts in exported PDFs/PNGs used commercially | Legal | Medium | High | Ship only fonts with permissive/commercial-embed licenses (documented per font); licensed stock provider with commercial rights; custom font upload requires user attestation and is deferred | Legal/Founder |
| RISK-07 | **IP/copyright of AI-generated content**; user claims about ownership | Legal | Medium | Medium | Clear ToS on ownership and user responsibility; no training on user content; content provenance retained; do not overclaim "copyright-safe" | Legal |
| RISK-08 | **Harmful/misleading content generated at scale** (health/financial claims, hate, misinformation) | Trust & Safety | Medium | High | Multi-layer safety: input classifier, output classifier, claim-flagging chips, blocked-category list, abuse reporting, audit log; sensitive-domain disclaimers | Eng + PM |
| RISK-09 | **Prompt injection via imported URLs/files** (untrusted content steering generation or exfiltrating context) | Security | Medium | High | Treat all imported content as data, never instructions; structural separation in prompts; output schema validation; no tool/credential access from generation path (NFR-SEC06) | Eng |
| RISK-10 | **Big-incumbent competition** (Canva et al. ship the same feature) | Market | High | High | Focus + speed; go deep on platform-native and brand personalization; build the performance data loop early; do not enter a feature-breadth race | Founder |
| RISK-11 | **Unit economics break** — heavy users consume margin; free tier abuse | Financial | Medium | High | Credit metering; per-user daily spend ceiling; model tiering + prompt caching; anonymous generation rate-limited by IP + device; alert on COGS/generation drift | Founder/Eng |
| RISK-12 | **Low free→paid conversion** — tool used once per idea, not habitually | Business | Medium | High | Habit mechanics: content calendar, weekly idea emails, series/campaign generation, brand kit lock-in; monitor W4 retention as the early warning | Growth |
| RISK-13 | **Scope creep toward becoming a design tool** (the Alex trap) | Execution | High | Medium | Anti-persona documented; principle P3; every editor request evaluated against "does this raise zero-edit rate?" | PM |
| RISK-14 | **Data breach / cross-tenant leak** | Security | Low | Critical | Tenant isolation at data layer, least-privilege, encrypted tokens, pen test, incident response plan, breach notification runbook | Eng |
| RISK-15 | **Key-person/small-team dependency** | Organizational | Medium | Medium | Documented architecture and runbooks; no single-owner subsystems; ADRs for all major decisions | Founder |
| RISK-16 | **Regulatory shift on AI content disclosure** (EU AI Act transparency obligations and similar) | Compliance | Medium | Medium | AI-generation disclosure in product and ToS; provenance metadata; monitor regulatory guidance; design so disclosure can be enforced per-jurisdiction | Legal |
| RISK-17 | **Platform spec drift** (aspect ratios, slide limits, PDF page caps change without notice) | Technical | High | Medium | Platform specs live in a single versioned config module with automated periodic verification and a documented update runbook; never hardcode dimensions in templates | Eng |

**Top three risks to actively manage from week 1:** RISK-01 (quality), RISK-04 (API dependency — mitigated by export-first MVP), RISK-03 (rendering defects).

---

## 16. Technical Requirements

### 16.1 Architecture overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT (Next.js / React / TypeScript / Tailwind)                    │
│  Landing · Generator · Editor (canvas preview) · Library · Billing   │
│  Template components rendered client-side for live preview           │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS (REST + SSE for streaming)
┌───────────────▼──────────────────────────────────────────────────────┐
│  API LAYER (Next.js route handlers / Node)                           │
│  Auth · Workspace/RBAC · Projects · Generation · Export · Billing    │
│  Rate limiting · Quota/credit enforcement · Audit logging            │
└───┬───────────────┬───────────────┬──────────────────┬───────────────┘
    │               │               │                  │
┌───▼────────┐ ┌────▼─────────┐ ┌───▼──────────┐ ┌─────▼──────────────┐
│ Postgres   │ │ Redis        │ │ Job Queue    │ │ Object Storage     │
│ (primary   │ │ cache +      │ │ (durable,    │ │ (S3-compatible)    │
│  data,     │ │ rate limits  │ │  idempotent) │ │ assets, exports    │
│  RLS)      │ │              │ │              │ │ + CDN              │
└────────────┘ └──────────────┘ └───┬──────────┘ └────────────────────┘
                                    │
        ┌───────────────────────────┼────────────────────────────┐
        │                           │                            │
┌───────▼──────────┐   ┌────────────▼───────────┐   ┌────────────▼─────────┐
│ AI ORCHESTRATION │   │ RENDER WORKERS         │   │ PUBLISH WORKERS      │
│ Provider gateway │   │ Headless Chromium      │   │ (Phase 2)            │
│ multi-vendor     │   │ same template code as  │   │ LinkedIn/IG/FB/X     │
│ prompt registry  │   │ client → PNG/JPG/PDF   │   │ token vault, retries │
│ schema validate  │   │ font embedding         │   │ scheduling           │
│ safety filters   │   │ 2× density             │   │                      │
└──────────────────┘   └────────────────────────┘   └──────────────────────┘

Cross-cutting: OpenTelemetry tracing · error tracking · product analytics ·
feature flags · secret manager · CI/CD with preview environments
```

### 16.2 Technology stack (proposed)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui | Single language across stack; SSR for SEO landing pages; strong ecosystem |
| State | Server components + TanStack Query; Zustand for editor local state | Editor needs fast local state; rest is server-driven |
| Backend | Node/TypeScript (Next route handlers + separate worker service) | Shared types with frontend; shared template code between preview and render |
| Database | PostgreSQL (managed: Supabase/Neon/RDS) with row-level security | Relational fits workspaces/projects/slides; RLS enforces tenancy |
| ORM | Drizzle or Prisma | Type-safe migrations |
| Cache/limits | Redis | Rate limiting, session, hot template cache |
| Queue | Durable job queue (BullMQ on Redis, or a managed durable-workflow service) | Generation/export/publish must survive restarts; idempotency keys required |
| Object storage | S3-compatible (S3 / R2) + CDN | Exports and user uploads; signed URLs only |
| Rendering | Headless Chromium (Playwright) in a container, or serverless Chromium | Pixel-accurate HTML/CSS → PNG/PDF; identical output to preview |
| Auth | Managed auth (Clerk / Supabase Auth / Auth.js) | Don't build auth |
| Payments | Stripe (Checkout, Billing, Customer Portal, Tax) | Standard; handles proration, dunning, VAT |
| AI | Provider-agnostic gateway with ≥2 vendors (frontier tier + fast/cheap tier) | Cost control, failover, no vendor lock-in |
| Email | Transactional provider (Resend/Postmark) | Onboarding, exports, dunning |
| Analytics | Event analytics (PostHog) + warehouse export | Funnels, retention, experiments |
| Errors/APM | Sentry + OpenTelemetry | Trace across API → queue → worker → model |
| Hosting | Vercel (web) + container platform for workers (Fly/ECS/Cloud Run) | Renders need long-running, CPU/memory-heavy containers |
| CI/CD | GitHub Actions: typecheck, lint, unit, visual regression, eval suite, preview deploy | Quality gates are non-negotiable (NFR-Q01/Q02) |

### 16.3 The rendering engine (the technical core)

**Principle: one template definition, two render targets.** Templates are React components consuming a typed `SlideSpec`. The browser renders them for live preview; the server renders the *same components* in headless Chromium for export. This eliminates the entire class of "preview doesn't match export" bugs, which is the #1 credibility failure in this category.

**Requirements:**

| ID | Requirement |
|---|---|
| TR-R01 | Templates declare, per slot: max characters, min/max font size, line clamp, overflow strategy, and required contrast ratio |
| TR-R02 | **Auto-fit cascade:** (1) fit within budget → render; (2) step font down within allowed range; (3) reduce line-height/tracking within bounds; (4) clamp lines with ellipsis and flag for review; (5) request AI shortening. Silent meaning-destroying truncation is prohibited. |
| TR-R03 | Deterministic rendering: same input + same template version ⇒ byte-comparable output (fonts pinned, no network fetches at render time, fixed device pixel ratio) |
| TR-R04 | All fonts self-hosted and preloaded; no external font CDN at render time |
| TR-R05 | Aspect-ratio reflow: switching ratio re-runs layout, never scales/stretches a rendered bitmap |
| TR-R06 | Render worker isolation: one browser context per job, hard timeout (30s), memory cap, no outbound network except allowlisted asset storage |
| TR-R07 | PDF export embeds fonts, correct page size, and per-page bleed-free dimensions for LinkedIn document posts |
| TR-R08 | Output pipeline: PNG (2× density) → optional JPG/WebP transcode → ZIP assembly; artifacts stored with content-hash keys and 90-day retention for paid, 7-day for free |
| TR-R09 | Template versioning: every project stores the template version it was created with; old projects re-render identically after template updates |

### 16.4 AI orchestration

**Pipeline (per generation):**

```
1. Intake normalization   → clean input, detect language, extract URL content (untrusted)
2. Safety pre-check       → classifier; block/redirect disallowed categories
3. Planning call          → narrative outline: angle, slide roles, hook strategy
                            (frontier model, structured JSON output)
4. Copy call(s)           → per-slide copy bound to the target template's character
                            budgets, platform tone, brand voice
                            (frontier model; parallelized per slide group)
5. Schema validation      → strict JSON schema; on failure, one repair attempt,
                            then fall back to a simpler template contract
6. Layout assignment      → slide role → template layout, image/stat/quote slots
7. Auto-fit + contrast    → deterministic engine (§16.3)
8. Captions & hashtags    → fast/cheap model
9. Safety post-check      → output classifier + claim flagging
10. Render                → queue export/preview render
```

| ID | Requirement |
|---|---|
| TR-A01 | All model calls go through an internal gateway: provider routing, retries with jittered backoff, timeouts, circuit breaking, per-call cost/latency logging |
| TR-A02 | **Structured output enforced by schema**, not by hope; validation failures never reach the user as broken slides |
| TR-A03 | Model tiering: frontier model for planning/copy; fast/cheap model for classification, captions, short edits (NFR-CO3) |
| TR-A04 | Prompt registry: every prompt is versioned, immutable once shipped, and attached to each generation record for reproducibility and rollback (FR-M02) |
| TR-A05 | Prompt caching for shared system/instruction blocks to cut cost and latency |
| TR-A06 | Evaluation harness: ≥200-prompt golden set scored on structure, hook strength, copy quality, brand adherence, and safety; run in CI on every prompt/model change (NFR-Q01) |
| TR-A07 | Untrusted-content isolation: imported page/file text is passed as clearly delimited data with explicit instructions that it is content to summarize, never instructions to follow (NFR-SEC06) |
| TR-A08 | Zero-retention or ≤30-day retention configured with all model vendors; no user content used for vendor training (NFR-C03) |
| TR-A09 | Per-generation cost ceiling; abort and fail gracefully (uncharged) if exceeded |
| TR-A10 | Streaming: outline and slides stream to the client via SSE so perceived latency ≪ actual (FR-G12) |

### 16.5 Data model (core entities)

| Entity | Key fields | Notes |
|---|---|---|
| `user` | id, email, name, auth_provider, created_at | |
| `workspace` | id, name, plan, credit_balance, credit_reset_at, stripe_customer_id | Tenancy root |
| `workspace_member` | workspace_id, user_id, role | RBAC |
| `brand_kit` | id, workspace_id, logo_url, colors[], fonts[], handle, cta, voice_profile_id | |
| `brand_voice_profile` | id, workspace_id, samples[], derived_traits (JSON) | Phase 2 |
| `project` (carousel) | id, workspace_id, title, source_type, source_input, platform_targets[], template_family, template_version, theme, brand_kit_id, status | |
| `slide` | id, project_id, index, role, content (JSON), layout_id, image_asset_id, overrides (JSON), flags[] | Ordered; `content` is typed per role |
| `project_version` | id, project_id, snapshot (JSON), created_by, created_at | Version history (FR-E06) |
| `generation` | id, project_id, prompt_version, model, provider, tokens_in/out, latency_ms, cost_usd, status, safety_flags[] | Full observability + billing audit |
| `asset` | id, workspace_id, kind (upload/export/stock), storage_key, mime, bytes, checksum | Content-hash keyed |
| `export_job` | id, project_id, format, platform, status, artifact_asset_id, error | Idempotent |
| `publish_job` | id, project_id, platform, account_id, scheduled_at, status, platform_post_id, error | Phase 2 |
| `social_account` | id, workspace_id, platform, external_id, encrypted_tokens, scopes, expires_at | Envelope-encrypted |
| `credit_ledger` | id, workspace_id, delta, reason, ref_id, created_at | Append-only; source of truth for balance |
| `audit_log` | id, workspace_id, actor_id, action, target, metadata, created_at | Admin actions, impersonation, publishing |

**Data rules:** every table with workspace-scoped data carries `workspace_id` and is protected by row-level security. The credit balance is derived from the append-only ledger (never mutated in place) so billing disputes are always reconstructable.

### 16.6 Platform specification module

Platform specs **must live in one versioned config module**, never inline in templates (RISK-17). Each entry records dimensions, aspect ratios, slide/page limits, file-size caps, caption limits, and a `last_verified_at` date.

| Platform | Format | Aspect ratios | Typical slide/page range | Caption limit | Delivery |
|---|---|---|---|---|---|
| Instagram | Multi-image carousel | 4:5 (1080×1350) primary, 1:1 (1080×1080) | Up to platform maximum (verify current cap) | ~2,200 chars | PNG/JPG per slide |
| LinkedIn | Document post (PDF) or multi-image | 4:5, 1:1 | 5–12 recommended; platform page cap far higher | ~3,000 chars | PDF (primary) + PNG |
| Facebook | Multi-photo / carousel | 1:1, 4:5 | 2–10 | ~63,000 chars (practical: short) | PNG/JPG per slide |
| X | Multi-image post (image cap per post) or image thread | 16:9, 1:1 | Up to per-post image cap; thread for more | 280 chars (higher for premium) | PNG/JPG per image |

> **Engineering note:** every value in this table is treated as *unverified until confirmed against current platform documentation at implementation time* and re-verified on a scheduled cadence. Platform limits change without notice; the config module carries verification dates and the app degrades gracefully (warn, don't break) when a deck exceeds a limit.

### 16.7 Key APIs (internal, illustrative)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/generate` | Start generation; returns `job_id`; streams via SSE `/api/generate/:id/stream` |
| `POST` | `/api/projects/:id/slides/:index/regenerate` | Single-slide regeneration with steering |
| `PATCH` | `/api/projects/:id` | Autosave edits (debounced, optimistic-concurrency by version) |
| `POST` | `/api/projects/:id/render` | Preview render for a given platform/ratio/theme |
| `POST` | `/api/projects/:id/export` | Create export job (`format`, `platform`) → artifact URL |
| `POST` | `/api/projects/:id/publish` | Phase 2: schedule/publish to a connected account |
| `GET` | `/api/workspaces/:id/credits` | Balance + ledger |
| `POST` | `/api/webhooks/stripe` | Subscription lifecycle → plan + credit grants (idempotent) |
| `POST` | `/api/import/url` | Fetch + extract article content (SSRF-guarded, allowlisted schemes, no internal IP ranges) |

### 16.8 Environments, CI/CD & operations

- **Environments:** local → preview (per-PR) → staging → production. Staging uses production-shaped data volumes with synthetic content.
- **CI gates (blocking):** typecheck, lint, unit tests, layout/auto-fit unit tests, visual regression across templates × ratios × themes, AI eval suite (non-regressive), dependency/CVE scan.
- **Deploys:** trunk-based, small, behind flags; migrations forward-compatible (expand → migrate → contract).
- **Observability:** trace ID propagated through API → queue → worker → model call; dashboards for generation latency/cost/success, render defect rate, queue depth, credit consumption anomalies.
- **Alerting (paged):** generation success <95% (15 min), export success <98%, p95 generation >120s, model-provider error rate >10%, COGS/generation >$0.20, queue wait >60s.
- **Runbooks required before launch:** model provider outage, render worker saturation, Stripe webhook backlog, mass-export failure, security incident, platform API revocation.

### 16.9 Third-party dependencies (and the exit plan for each)

| Dependency | Used for | Lock-in risk | Exit plan |
|---|---|---|---|
| Model providers (≥2) | Generation | Medium | Gateway abstraction; prompts portable; eval suite validates a swap in <1 week |
| Stripe | Billing | Medium | Standard; ledger is ours, not Stripe's |
| Auth provider | Identity | Medium | Store canonical user records in our DB; migration path documented |
| S3-compatible storage | Assets | Low | Portable API |
| Headless Chromium | Rendering | Low | Open-source, self-hostable |
| Stock image provider | Imagery | Low | Swappable; attribution abstracted |
| Social platform APIs | Publishing (Ph. 2) | **High** | Export-first core; publishing is an enhancement layer, never a dependency of the core value |

---

## 17. Assumptions & Open Questions

### 17.1 Assumptions (must be validated; each has an owner and a validation method)

| ID | Assumption | Validation method | Risk if wrong |
|---|---|---|---|
| AS-1 | Users will accept AI-generated carousel copy with light editing | Beta: measure zero-edit export rate (target ≥35%) | Core value prop invalid |
| AS-2 | Export-first (no publishing) is sufficient for MVP willingness to pay | Beta conversion + interview probes | Delays revenue; forces early API dependency |
| AS-3 | $19/$39 price points clear the value bar for creators/SMMs | Van Westendorp + real checkout tests during beta | Pricing rework |
| AS-4 | Blended COGS ≤$0.12/carousel is achievable at target quality | Instrumented cost per generation in beta | Margin model breaks |
| AS-5 | Carousel demand is durable, not a format fad | Track platform reach trends quarterly | Category risk |
| AS-6 | 15 template families provide enough visual variety for 6 months | Monitor template concentration + "looks generic" feedback | RISK-02 materializes |
| AS-7 | Creators will tolerate a free-tier watermark rather than abandoning | Free-tier export rate + upgrade attribution | Growth loop weakens |

### 17.2 Open questions

| ID | Question | Needed by | Owner |
|---|---|---|---|
| OQ-1 | Final product name + trademark clearance + domain | Week 4 | Founder |
| OQ-2 | Which two model providers for launch, and what is the measured quality/cost delta? | Week 5 | AI eng |
| OQ-3 | Do we gate PDF export to paid, or is that too aggressive for LinkedIn-first users? | Week 9 | PM/Growth |
| OQ-4 | LinkedIn/Meta API partner application status and realistic timeline | Week 2 (apply), track monthly | Founder |
| OQ-5 | Font licensing shortlist with commercial-embed rights confirmed in writing | Week 6 | Legal |
| OQ-6 | Is credit rollover (1× cap) the right anti-churn mechanic, or does it suppress upgrades? | Month 4 (cohort data) | Growth |
| OQ-7 | Owner and cadence for the maintained competitive tracker (§14) | Week 3 | PM |
| OQ-8 | EU data residency: needed at launch for EU SMB segment, or deferrable to Phase 4? | Month 6 | Founder |

---

## 18. Appendices

### 18.A Glossary

| Term | Definition |
|---|---|
| **Carousel** | A multi-slide social post: swipeable images (Instagram/Facebook/X) or a multi-page document post (LinkedIn) |
| **Slide role** | Semantic function of a slide: cover/hook, list item, quote, stat, image, CTA, outro |
| **Brand kit** | Stored set of brand assets (logo, colors, fonts, handle, CTA) applied automatically to templates |
| **Credit** | Unit of metered AI consumption; 1 credit ≈ one full carousel generation |
| **Zero-edit export** | A carousel exported with no manual text edits — the primary quality signal |
| **Auto-fit cascade** | The deterministic sequence used to guarantee text fits its slot without overflow |
| **Golden set** | Fixed corpus of ≥200 prompts used to score generation quality on every model/prompt change |
| **WPC/AW** | Weekly Published Carousels per Active Workspace — the North Star metric |

### 18.B Requirement traceability summary

| Requirement group | IDs | MVP (P0) count |
|---|---|---|
| Auth & workspaces | FR-A01–A06 | 4 |
| Input & intake | FR-I01–I09 | 5 |
| AI generation | FR-G01–G14 | 10 |
| Design & brand | FR-D01–D10 | 5 |
| Editor | FR-E01–E10 | 7 |
| Export & publishing | FR-X01–X14 | 7 |
| Library | FR-L01–L05 | 2 |
| Billing | FR-B01–B08 | 5 |
| Analytics | FR-N01–N03 | 0 |
| Admin | FR-M01–M04 | 4 |
| **Total P0** | | **49** |

### 18.C Research note

The discovery findings in §3.2 are recorded as **the assumed output of a 27-participant discovery round** (solo creators, freelance SMMs, SMB marketers). The interview round must be run and the table replaced with sourced, dated findings before this PRD is used to justify funding or headcount. Frequencies shown are placeholders for planning, not measured results.

Likewise, all market sizing, competitor pricing, cost figures, and conversion benchmarks in this document are **planning estimates**. Each must be replaced with sourced data before external use (investor materials, board reporting).

### 18.D Document change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-02 | Product | Initial complete draft |

---

*End of document.*
