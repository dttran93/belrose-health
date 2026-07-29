# Permissions Data Model

## Current shape

`records/{recordId}` holds four permission role arrays directly on the record document:
`owners`, `administrators`, `sharers`, `viewers` (plus `subjects` and `uploaded by`, but to
be clear those are not permission roles, just metadata). Every permission change also appends an
entry to `records/{recordId}/permissionHistory` via `writePermissionChangeEvent`.

This means every permission change touches two locations: the arrays (current state) and the
permission history subcollection (audit log). At first glance it looks like that is redundant and
a potential source of bugs as you have to keep them in sync. It is also different than how other
records related collections such as `wrappedKeys`, `trusteeRelationships`, and `verifications` are
treated with junction documents that are looked up as needed.

**We considered separating record role arrays from the record data and rejected it.** This doc records why,
so it doesn't get re-litigated from scratch next time it comes up.

## Why the arrays stay on the record

### 1. `useUserRecords.ts` requires it

[useUserRecords.ts](../ViewEditRecord/hooks/useUserRecords.ts) runs a single live query against
the top-level `records` collection:

```ts
query(
  recordsRef,
  or(
    where('owners', 'array-contains', userId),
    where('administrators', 'array-contains', userId),
    where('sharers', 'array-contains', userId),
    where('viewers', 'array-contains', userId),
    where('subjects', 'array-contains', userId)
  ),
  orderBy('uploadedAt', 'desc')
);
```

This is how the app answers "list every record this user can access," and it's used constantly
(record lists, dashboards). Firestore has no joins — a query can only filter on fields that live
on the documents in the collection being queried. If the role arrays moved to a
`permissions` subcollection, this query would no longer work as a single call. The alternatives
are strictly worse:

- **Collection-group query** on `permissions`, then a second fetch of the parent records by ID —
  turns one live single-query listener into a two-stage fetch (query → derive record IDs → fetch
  those records), with more reads, more latency, and a consistency window between the two
  listeners.
- **Duplicate the arrays** in both the record and the subcollection — reintroduces the exact
  sync problem this restructuring was meant to solve, now across three places instead of two.

### 2. The arrays are a universal gate, not a conditional lookup

Every read of every record, by every consumer, needs to check the role arrays first — they're the
authorization gate itself. `wrappedKeys` and verification/credibility data are different: they're
fetched conditionally, only once the user has already passed the gate and needs that specific
sub-resource (decrypting content, opening the sharing-management view). Nothing forces those onto
the record doc, and embedding them there would bloat the hot path (loading a record you're allowed
to view) with data most consumers generally do not need.

So the rule of thumb going forward: **couple data that's queried against and gated-on-every-read;
keep data that's conditionally-fetched-per-purpose in its own collection.** Role arrays satisfy the
first case. `wrappedKeys` satisfies the second.

### 3. Moving `current` out doesn't help blockchain reconciliation, either

We initially thought a dedicated `permissions/current` doc would make on-chain reconciliation
cleaner. It doesn't: the drift risk that actually matters is between `permissionHistory` (which
contains the blockchain Tx data we compare against chain events) and whatever grants access — and
that comparison never touches the role arrays regardless of where they live. Relocating `current`
changes nothing about that.

### 4. The solution to drift between permissionHistory and current permissions arrays is atomic batch writes

We initially considered that a separate document might reduce the need for synchronization between permission
history and current permissions arrays but that is not the case. PermissionHistory is for auditing and blockchain
reconciliation in order to derive current status from the history you would have to query the history for each user's
latest status, this would make a query that is run literally every time the app opens slower and more expensive. So
the key is to make sure that all permission writes throughout are atomic with a permission history write using a
batch write that throws if either do not work.

## Summary

| Data                                                        | Where it lives                                 | Why                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Role arrays (`owners`/`administrators`/`sharers`/`viewers`) | On the record doc                              | Queried directly (`useUserRecords.ts`); gates every read                             |
| Permission history                                          | `records/{id}/permissionHistory` subcollection | Append-only audit log; not gated-on-every-read; source for blockchain reconciliation |
| `wrappedKeys`                                               | Junction docs, keyed per user                  | Conditionally fetched (decrypt / manage sharing); never queried against `records`    |
