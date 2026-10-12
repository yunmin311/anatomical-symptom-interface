# Known limitations

Honest list of what this product does not do, and why. Written so that nothing here has
to be discovered by a user.

Engineering completion is not clinical validation. Nothing in this repository has been
reviewed by a qualified clinician, and the unreviewed-rule count in the release gate is
the reason the product refuses a production release rather than a formality.

---

## 1. Answer history is not retained

**What we do.** An answer is stored once, as the CURRENT value, keyed on
`(episode, question)`. Correcting an answer REPLACES it. The replacement is marked
`user_edited` **by the store, from the row** — not from anything the client claims — so a
client cannot assert a correction that did not happen, and cannot downgrade a real one
either.

A correction genuinely withdraws what the original recorded. The answer-derived fields are
recomputed from the **whole** answer set on every answer write, so correcting "yes, I have
numbness in my leg" to "no" removes numbness from the record and from the clinician's summary,
and a safety flag that no longer fires is withdrawn with a transcript entry naming the rule.

Recomputation is used rather than per-question withdrawal because several questions write
the same value — `instability` is added by three, `numbness` by three, `swelling` by two — so
a per-question withdrawal has to guess who still holds it, and the cheapest way to write that
guess is to withdraw nothing. Recomputing never guesses. It writes only fields whose value
actually CHANGED, so a field nobody mentioned never gains a provenance row and coverage still
distinguishes "not asked" from "reported".

**What we do not do.** The original answer is overwritten, not kept. There is no
`answer_history` table, no event log, and no way to see what the user said before they
changed it.

**Why.** Keeping every version of every answer is an append-only medical record, and this
product is not built as one at V1.

**What a clinician loses.** They cannot see that a symptom was reported and later withdrawn.
What they get instead is that the current value is marked as corrected, so the correction
itself is visible.

**When this must change.** Before this holds real patient records over time. The migration is
additive — an `episode_answer_versions` table plus a write on every answer mutation — and
nothing in the current read path would change, because every reader goes through
`answersFor`.

---

## 2. Clinical rules are unreviewed

`packages/shared/src/rules/redflags.ts` carries a `review` block per rule with an
explicit `status`. The count of `unreviewed` rules is reported honestly and gates the
release profile. The rules are deterministic predicates over typed signals -- never
regular expressions over user text, never probabilities, never a diagnosis.

**A qualified clinical reviewer is an external release dependency.** No amount of
engineering completes it. See `docs/safety-regulatory.md`.

---

## 3. The 2D anatomy is a region locator, and on the Right Shoulder a derived pilot

There are two different things called "the 2D map", and they are not the same claim.

**The hand-drawn schematic** is SVG drawn by this repository, marked
`twoD.placeholder = true` on every structure. It is a *region locator*: it answers
"roughly where on the body is this", and nothing finer. It must never be presented as
medical artwork, and production 2D anatomy has to come from an external, professionally
licensed source. That sourcing has not been done.

**The derived Right Shoulder anatomy** replaces that silhouette on the one region that
has it. Four views — front, back, and the two side views, which are the viewer's `left`
and `right` camera positions and are both of the *right* shoulder — each in four layers:
surface, bone, muscle, vascular. Each layer is an orthographic render of the BodyParts3D
geometry with a BVH hit grid derived from it; the geometry itself is unmodified. Where a
person taps, the grid resolves to a structure, which is what makes "point at the structure
you indicated" possible on a 2D surface at all.

It is a pilot and it is honest about the limits:

- **One region, one side.** The derived build covers the **right** shoulder only, and the
  app loads exactly that one manifest. The left shoulder, neck, lower back and knee all
  still show the hand-drawn schematic. Deriving the rest is mechanical, and is not done.
- **Derived is not reviewed.** The renders are machine-derived from a source dataset, and
  a machine-derived picture of a shoulder is not a clinically reviewed tissue map. 41 of
  the 43 presentation structures are classified `machine_derived`; the 2 `evidence_supported`
  ones are supported by a source citation, not by a clinician.
- **The hit grid inherits the dataset's gaps.** It can only point at what BodyParts3D
  contains: solid anatomy, no bursae and no fascial planes. A structure that is not in the
  archive cannot be pointed at, which is a coverage limit rather than a rendering one.
- **Of 43 presentation structures, 10 are writable.** The rest are view-only: they
  highlight when tapped and cannot be selected, and the app says so. A view-only structure
  is not an error state and not a smaller version of a selectable one.
- **A point on a render is not a finding.** Tapping says where someone indicated, nothing
  about what is wrong. The wording is "pointed at" and "indicated", and the summary does
  not use a stronger word.

Where any of this is unavailable — a layer fails to load, the 3D viewer cannot start — the
product says why on the surface instead of showing an empty canvas.

---

## 4. Anatomy coverage is limited by the source, not by effort

All four V1 regions are built from BodyParts3D 4.0 (CC BY 4.0). What is missing is
missing from the dataset, and the gaps are recorded per concept with the evidence:

- **The archive contains no knee ligaments at all.** Every one of its 38 "ligament"
  concepts is an extraocular muscle. No patellar, collateral or cruciate.
- **No meniscus, and no bursa anywhere in the archive.**
- **Suboccipital muscles are asymmetric**: six concepts on the left, four on the right.
  The right side is therefore reported explicitly unavailable rather than mirrored.
- **BodyParts3D is a solid-anatomy dataset.** Joint spaces, bursae and fascial planes
  are not in it, so those concepts stay `non-solid-space`.

Where a concept resolves to several source meshes — a cervical spine is seven
vertebrae — it is a composite, and each component keeps its own mesh id and FMA claim.

---

## 5. Anatomy identity is region-scoped by convention

A structure belongs to as many regions as it does, and has exactly ONE id and ONE
source provenance. The id prefix records where a user first meets the structure, not
exclusive ownership of it: `asi:shoulder.trapezius-upper` is also a neck structure.

Retired ids are resolved through `canonicalStructureId()` in the record projection, not
in the field store, so the raw store remains a faithful log of what arrived.

---

## 6. FMA bindings are unverified

Every `fma.conceptId` is a claim read from the source's own concept list, recorded as
`status: 'unverified'`. None has been checked against FMA Explorer by a human. They are
provenance, not identity: the `asi:` id is the product identity.

---

## 7. Laterality is stated, never inferred

The side of every mesh comes from the source concept that named it, carried
unchanged through the manifest, the renderer entry and the pick. Nothing infers it from
a filename, an `M` suffix, an x coordinate, a camera angle or which half of the screen
a mesh lands on.

This is not hypothetical caution: BodyParts3D's `M` suffix convention holds for 1109
meshes and is violated by 655. In the neck, sternocleidomastoid is `FJ1573` = LEFT with
no suffix, and `FJ1595` = RIGHT.

---

## 8. Anatomy coverage differs per laterality, and that is deliberate

Real anatomy is not symmetric. The neck suboccipital set is six source concepts on the left
and four on the right, so the right is reported **unavailable with its reason** rather than
mirrored or averaged. BodyParts3D's own `M` suffix looks like a laterality convention and is
not: it holds for 1109 meshes and is violated by 655. Laterality is read from the source
concept and carried through the manifest, the renderer entry and the pick.

Two regions have no midline geometry at all, because the dataset models them per side. The
product says "the source models this per side" — a fact about the data — rather than "not
built yet", which is a claim about the repository and implies a promise.

## 9. `bilateral` shows one side at a time

A bilateral complaint mounts the real left scene or the real right scene, one at a time, with
the side named on screen and a control to switch. Neither is ever mirrored from the other,
and the side is never left unnamed — a 3D viewer with no side named is the one place a user
could look at left anatomy and believe it was right.

## 10. A free-text or multi-select answer cannot be "withdrawn"

Some questions have no negative answer. "Which arm movements set it off?" records whatever
the user typed, and correcting it means answering again — an empty answer is *not asked*, not
a withdrawal. Four questions are like this and are listed, with reasons, in
`CANNOT_WITHDRAW` in `packages/shared/test/answer-withdrawal.test.ts`. That test fails if a
question starts recording on an affirmative without appearing in one list or the other, which
is how six questions escaped in the first place.

## 11. Grounding can refuse, and refusal is a feature

A complaint that does not localise to shoulder, neck, lower back or knee is refused with a
reason, and no episode is created. There is no default region. A chest complaint exits and
points at a clinician rather than entering a musculoskeletal interview.
