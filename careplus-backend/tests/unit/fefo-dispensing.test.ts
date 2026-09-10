/**
 * Pure-logic reimplementation of the FEFO batch-selection loop used in
 * pharmacy.service.ts#dispense, isolated from Prisma so it can be tested
 * without a database connection. Mirrors the exact algorithm.
 */
interface Batch {
  id: string;
  expiryDate: Date;
  stockQuantity: number;
}

function selectFefoBatches(batches: Batch[], quantityNeeded: number) {
  const sorted = [...batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  let remaining = quantityNeeded;
  const movements: { batchId: string; qty: number }[] = [];

  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stockQuantity, remaining);
    if (take > 0) movements.push({ batchId: batch.id, qty: take });
    remaining -= take;
  }

  return { movements, shortfall: Math.max(remaining, 0) };
}

describe("FEFO batch selection", () => {
  const d = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86400000);

  it("selects the earliest-expiring batch first", () => {
    const batches: Batch[] = [
      { id: "late", expiryDate: d(200), stockQuantity: 100 },
      { id: "early", expiryDate: d(30), stockQuantity: 100 },
    ];
    const { movements } = selectFefoBatches(batches, 50);
    expect(movements).toEqual([{ batchId: "early", qty: 50 }]);
  });

  it("spills over into the next-earliest batch when the first is insufficient", () => {
    const batches: Batch[] = [
      { id: "early", expiryDate: d(10), stockQuantity: 20 },
      { id: "mid", expiryDate: d(60), stockQuantity: 100 },
    ];
    const { movements, shortfall } = selectFefoBatches(batches, 50);
    expect(movements).toEqual([
      { batchId: "early", qty: 20 },
      { batchId: "mid", qty: 30 },
    ]);
    expect(shortfall).toBe(0);
  });

  it("reports a shortfall and deducts nothing conceptually beyond available stock when total stock is insufficient", () => {
    const batches: Batch[] = [{ id: "only", expiryDate: d(10), stockQuantity: 5 }];
    const { movements, shortfall } = selectFefoBatches(batches, 20);
    expect(movements).toEqual([{ batchId: "only", qty: 5 }]);
    expect(shortfall).toBe(15);
  });

  it("ignores batches not passed in (caller is responsible for excluding expired/inactive batches)", () => {
    const batches: Batch[] = [];
    const { movements, shortfall } = selectFefoBatches(batches, 10);
    expect(movements).toHaveLength(0);
    expect(shortfall).toBe(10);
  });
});
