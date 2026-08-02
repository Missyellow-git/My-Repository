# AI Carousel Generator — Product Documentation

Product documentation for an AI-powered carousel generation SaaS that turns a topic, URL, or draft into publish-ready Instagram, LinkedIn, Facebook, and X carousels.

## Documents

| Document | Description |
|---|---|
| [PRD — AI Carousel Generator](docs/PRD-AI-Carousel-Generator.md) | Complete product requirements document: vision, problem, personas, journeys, functional and non-functional requirements, MVP scope, roadmap, monetization, pricing, metrics, competitive analysis, risks, and technical architecture. |
| [System Architecture](docs/ARCHITECTURE.md) | Full technical architecture: frontend, backend, database, API layer, AI layer, rendering pipeline, background jobs, caching, storage, security, scalability, observability, deployment, and cost optimization. |

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), TypeScript, TailwindCSS |
| Backend | NestJS (Fastify), Node 22 |
| Database | PostgreSQL (RDS Multi-AZ) with row-level security |
| Queue | Redis + BullMQ |
| Storage | AWS S3 + CloudFront |
| Auth | Clerk (Auth.js as documented fallback) |
| AI — text | OpenAI · Claude · Gemini, behind a provider-agnostic routing gateway |
| AI — images | OpenAI Images · FLUX |
| Rendering | Playwright + headless Chromium |
| Compute | AWS ECS Fargate (ARM64), Vercel for web |

## Quick reference

- **Working name:** SlideForge (placeholder, pending trademark clearance)
- **Beachhead:** LinkedIn-first solo creators and freelance social media managers
- **MVP:** 12 weeks, export-first (no publishing APIs), Instagram + LinkedIn primary
- **North Star Metric:** Weekly Published Carousels per Active Workspace
- **Model:** Freemium with credit-metered subscriptions (Free / $19 / $39 / $99 / Agency)

## Status

Version 1.0 — draft for review. Market sizing, competitor details, discovery findings, and unit-economics figures in the PRD are planning estimates and are flagged in §17 and §18.C as requiring validation before external use.
