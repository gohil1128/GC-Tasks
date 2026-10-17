/*
  Card order within a column.

  A card's position is a float. Dropping a card between two others gives it
  the midpoint of their positions, so a move writes one row instead of
  renumbering the column. The ends are open: a card above the top one takes
  its position minus a step, a card below the bottom one its position plus a
  step.

  Halving a gap cannot go on for ever — after about thirty drops into the same
  slot the two neighbours are closer than a double can usefully split. When
  that happens the column is rebalanced (renumbered STEP, 2·STEP, … in its
  current order) in the same transaction as the move, and the card is placed
  in the fresh gap. It is rare enough that the one bulk write does not matter.

  Pure: no database, so it is unit-tested on its own.
*/

export const POSITION_STEP = 1024;

/**
  Below this the gap is treated as used up. Far above double precision at the
  magnitudes positions reach, so a midpoint is always a distinct number.
*/
export const MIN_GAP = 1e-6;

/** Where a card goes between `above` (null: it is the top) and `below` (null: it is the bottom). */
export function positionBetween(above: number | null, below: number | null): number {
  if (above === null && below === null) return POSITION_STEP;
  if (above === null) return (below as number) - POSITION_STEP;
  if (below === null) return above + POSITION_STEP;
  return above + (below - above) / 2;
}

/**
  Whether positionBetween(above, below) would land strictly between them with
  room to spare. False means the column has to be rebalanced first. Also
  false when the two are equal or out of order, which only happens if
  positions were tied by concurrent writes — a rebalance straightens that out.
*/
export function hasRoomBetween(above: number | null, below: number | null): boolean {
  if (above === null || below === null) return true;
  if (!(below - above >= MIN_GAP)) return false;
  const mid = positionBetween(above, below);
  return mid > above && mid < below;
}

/** Fresh, evenly spaced positions for `count` cards, top to bottom. */
export function rebalancedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_STEP);
}

/**
  Where in `column` (top to bottom, the moving card NOT included) a card
  lands, as an index: the cards before it end up above it.

  The browser names neighbours rather than an index, and by the time the move
  arrives another person may have moved or archived one of them. So:
    - `afterId` still in the column: directly below it (it wins if the two
      neighbours have since been pulled apart);
    - otherwise `beforeId` still in the column: directly above it;
    - otherwise the end the browser was aiming at — the bottom if it named a
      card to sit under, the top if it did not.
  A stale neighbour never fails the move; the card just lands as close to
  where it was dropped as the column now allows.
*/
export function insertionIndex(
  column: ReadonlyArray<{ id: string }>,
  afterId: string | null,
  beforeId: string | null,
): number {
  if (afterId !== null) {
    const i = column.findIndex((c) => c.id === afterId);
    if (i >= 0) return i + 1;
  }
  if (beforeId !== null) {
    const i = column.findIndex((c) => c.id === beforeId);
    if (i >= 0) return i;
  }
  return afterId !== null ? column.length : 0;
}

/**
  The position for a card landing at `index` in `column`, and whether the
  column must be rebalanced first to make room. When `rebalance` is true,
  `position` is computed against the rebalanced column.
*/
export function placeInColumn(
  column: ReadonlyArray<{ position: number }>,
  index: number,
): { position: number; rebalance: boolean } {
  const above = index > 0 ? column[index - 1].position : null;
  const below = index < column.length ? column[index].position : null;
  if (hasRoomBetween(above, below)) {
    return { position: positionBetween(above, below), rebalance: false };
  }
  const fresh = rebalancedPositions(column.length);
  return {
    position: positionBetween(index > 0 ? fresh[index - 1] : null, index < fresh.length ? fresh[index] : null),
    rebalance: true,
  };
}
