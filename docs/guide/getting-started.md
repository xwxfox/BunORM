# Getting Started

Welcome to **foxdb** - a tiny, fully-typed SQLite ORM for Bun built on top of [TypeBox](https://github.com/sinclairzx81/typebox).

## Installation

```bash
bun add @xwxfox/foxdb
```

> foxdb requires `bun:sqlite` and is designed exclusively for the Bun runtime.

## Your First Table

Everything in foxdb starts with a **TypeBox schema**. Schemas define both your TypeScript types *and* your database tables.

```typescript
import { Object, String, Number, Integer } from "typebox";
import { createORM, table } from "@xwxfox/foxdb";

const UserSchema = Object({
  id: String(),
  name: String(),
  email: String(),
  age: Integer(),
});

const orm = createORM({
  tables: {
    users: table(UserSchema, (s) => ({
      primaryKey: s.id,
      indexes: [{ columns: [s.email] }],
    })),
  },
});
```

That's it - no codegen, no decorators, no magic. Just plain objects that compile to SQLite tables.

## CRUD in One Breath

```typescript
// insert
const user = orm.users.insert({
  id: "usr-1",
  name: "alice",
  email: "alice@example.com",
  age: 30,
});

// find
const found = orm.users.findById("usr-1");

// update
orm.users.update({ id: "usr-1", name: "alice smith" });

// query
const adults = orm.users.findMany({
  where: { age: { gte: 18 } },
  orderBy: { column: "name", direction: "ASC" },
});

// paginate
const page = orm.users.findPage({
  where: { age: { gte: 18 } },
  limit: 10,
  offset: 0,
});

orm._close();
```

Every method is fully typed - pass the wrong column name and TypeScript will bonk you immediately.

## Next Steps

- Read about [Core Concepts](./core-concepts.md) to understand schemas, tables, and repositories
- Browse the [Examples](./examples.md) for real-world patterns
- Explore the API Reference for complete type-level documentation
