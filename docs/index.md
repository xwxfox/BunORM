---
layout: home

hero:
  name: foxdb
  text: typed sqlite orm for bun
  tagline: zero codegen, fully typed, tiny ~ built on typebox & bun:sqlite
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
  - icon: 🎯
    title: zero codegen
    details: your typebox schema is the source of truth. no prisma generate, no migration files to keep in sync
  - icon: 🔒
    title: fully typed
    details: every query, insert, update, and relation is typed end-to-end. wrong column name? typescript bonks you
  - icon: 🪶
    title: tiny
    details: ~2kb overhead on top of bun:sqlite. no external query builder, no connection pool, no bloat
  - icon: 🔗
    title: relations
    details: scalar relations (lazy) and sub-table relations (batch resolved) with a fluent builder
  - icon: 📡
    title: events
    details: listen to table events typed to your schema. zero overhead unless you subscribe
  - icon: ⚡
    title: lifecycle hooks
    details: onStart, onReady, onShutdown, onExit for seeding, migrating, cleaning up
---


