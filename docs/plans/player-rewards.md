# Tiny rewards for players

**Track:** North Star — between-session engagement (ROADMAP §LOCKED). Credit rides on the ledger that already exists (`payments.md`, `gift-card-ledger.md`).
**Status:** intent — parked in the backlog by Grant on 2026-11-04 ("plan it but back log"); nothing built, and the first decision below is still open.
**Review on:** 2027-01-13 — has Grant decided badge or credit (below)? Has any member asked for recognition beyond kudos? If neither, this stays parked.

## Problem

Grant, 2026-11-04: *"Tiny rewards for player. Discount, credit, or in app badge."*

A member who shows up every week, logs their games and thanks their partners gets nothing back from the app but the same screen as a member who does none of that. Kudos is the one recognition surface, and it is peer to peer; the club itself says nothing.

No member has asked for this. It is Grant's idea.

## The decision that gates it

**Credit is money and a badge is not.** A credit reward is paid by someone — in a club, the organiser's pocket — and every rule the ledger carries (append-only, derived ids, the reconcile) applies to it. A badge costs nothing and needs no reconcile. The plan starts with badges; credit, if wanted, is already one admin tap away through the gift-card path, so it needs no engineering, only a decision to fund it.

## Kill criterion

- Badges: the return rate of badge holders against the rest of the roster, from `clubMetrics()`. If holders come back no more often over two months, badges are decoration and the set is not extended.
- Credit: not built until Grant names who funds it and how much a season. A reward nobody has budgeted is a liability the ledger will report daily.

## Non-goals

- Streaks, or any badge that lapses. The app deleted its streak card on purpose; a badge that can be lost is the same guilt by another name. Milestones count UP and stay earned.
- Ranking members against each other ("top attender"). The club-comparison consent gate exists because a comparison is a comparison even when it is flattering.
- Discounts on stringing. Stringing prices are the stringer's figure, exact and visible; a discount scheme is a pricing change, not a reward, and belongs in `pricing.md`.
- Pushing a badge. A badge is seen when the member opens the app, never announced.

## Shape (proposed, not built)

| Piece | Where |
|---|---|
| Milestones computed, never stored: sessions played (10, 25, 50, 100), games logged (10, 50), kudos given (5, 25), seasons played — pure over the reads Stats already makes | `lib/milestones.ts` |
| Where they show: a row on Stats → You, and the member's own Profile; counts only, no dates of absence | `components/stats/`, `components/profile/` |
| Credit, if funded: the admin mints a gift code (existing) and the badge card says so; no new ledger kind | `GiftCardsCard`, no new code |
| Tests: a milestone never goes backwards when a session is removed from history; nothing renders for a member with no sessions | `__tests__/` |
