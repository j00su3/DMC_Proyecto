// Drizzle schema for @inventienda/api.
//
// This is the foundations change (backlog #1): no domain tables are defined
// yet. Keeping this module present but empty lets `drizzle.config.ts` point
// at a valid schema path and lets `drizzle-kit generate`/`migrate` run
// end-to-end against Postgres before any table is introduced. Future
// changes add table definitions here.
export {};
