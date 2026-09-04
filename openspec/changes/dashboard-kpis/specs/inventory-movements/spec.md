# Delta for inventory-movements

## ADDED Requirements

### Requirement: Recent Movimientos Are Readable Across All Productos, Unfiltered, By Both Roles
The system MUST expose a read query returning the N most recently recorded movimientos across
ALL productos and ALL actors, ordered most-recent-first by `fecha`, with no producto or actor
predicate. Each row MUST include: producto nombre, tipo, fecha, usuario. This read MUST be
permitted for `rol='encargado'` and `rol='deposito'` sessions, returning identical results for
both.

#### Scenario: Returns exactly N most recent when more exist
- GIVEN 15 movimientos recorded across several productos and actors, and N=10
- WHEN the recent-movimientos read is requested
- THEN exactly 10 rows are returned, the 10 most recent by `fecha`, most-recent-first

#### Scenario: Returns all movimientos when fewer than N exist
- GIVEN 4 movimientos have ever been recorded and N=10
- WHEN the recent-movimientos read is requested
- THEN exactly those 4 rows are returned, most-recent-first

#### Scenario: Empty result when zero movimientos exist
- GIVEN zero movimientos exist in the system
- WHEN the recent-movimientos read is requested
- THEN an empty list is returned, not an error

#### Scenario: Not scoped to a single actor or producto
- GIVEN movimientos recorded by two different usuarios across two different productos, all
  within the most recent N
- WHEN the recent-movimientos read is requested
- THEN rows from both usuarios and both productos appear in the same result

#### Scenario: Either role reads identical results
- GIVEN a fixed set of recorded movimientos
- WHEN both an `encargado` and a `deposito` session request the recent-movimientos read
- THEN both receive the identical result
