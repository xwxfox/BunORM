---
layout: home

hero:
  name: foxdb
  text: itty bitty e2e typed orm for bun
  tagline: zero codegen, fully typed, validated, smol ~ built on typebox & bun:sqlite
  image:
    src: /logo.svg
    alt: foxdb logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/xwxfox/foxdb

features:
  - icon: 🦊
    title: zero codegen
    details: your typebox schema is the source of truth. no prisma generate, no migration files to keep in sync (unless you chose to)
  - icon: 👉
    title: fully typed
    details: every query, insert, update, and relation is typed end-to-end. wrong column name? typescript bonks you
  - icon: 🫲
    title: rather smol
    details: ~20kb overhead on top of bun:sqlite. no external query builder, no connection pool, no bloat
  - icon: 🪢
    title: relations
    details: scalar relations (lazy) and automatic sub-table relations (batch resolved) with a fluent builder
  - icon: 🥺
    title: events
    details: listen to table events typed to your schema. zero overhead unless you subscribe
  - icon: 🦊
    title: lifecycle hooks
    details: onStart, onReady, onShutdown, onExit for seeding, migrating, cleaning up
---


