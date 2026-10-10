import { Prisma } from "@prisma/client";
import { ConflictError } from "../../src/common/errors/AppError";
import { consumeLabInventory } from "../../src/modules/lab/labInventory.service";

function inventoryTx() {
  let savedConsumption: Record<string, unknown> | null = null;
  const movementCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => data);
  const createConsumption = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    savedConsumption = data;
    return data;
  });
  const tx = {
    labInventoryConsumption: {
      findUnique: jest.fn(async () => savedConsumption),
      create: createConsumption,
    },
    labTestInventoryMapping: {
      findMany: jest.fn(async () => [{
        itemId: "item-1",
        quantityPerTestRun: 9,
        item: { name: "Reagent", unit: "mL" },
      }]),
    },
    labInventoryBatch: {
      findMany: jest.fn(async () => [
        { id: "fresh-first", batchNumber: "F1", expiryDate: new Date("2099-01-01T00:00:00Z"), quantity: 2 },
        { id: "fresh-next", batchNumber: "F2", expiryDate: new Date("2099-02-01T00:00:00Z"), quantity: 1 },
        { id: "expired", batchNumber: "E1", expiryDate: new Date("2000-01-01T00:00:00Z"), quantity: 5 },
      ]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    labInventoryMovement: { create: movementCreate },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, movementCreate, createConsumption };
}

describe("Lab inventory result consumption", () => {
  const request = { orderId: "order-1", testId: "test-1", resultId: "result-1", actorId: "user-1" };

  it("requires a reason before consuming expired stock for a shortage", async () => {
    const { tx, movementCreate, createConsumption } = inventoryTx();
    await expect(consumeLabInventory(tx, request)).rejects.toBeInstanceOf(ConflictError);
    expect(movementCreate).not.toHaveBeenCalled();
    expect(createConsumption).not.toHaveBeenCalled();
  });

  it("deducts FEFO, records an override and shortage, and does not consume twice", async () => {
    const { tx, movementCreate, createConsumption } = inventoryTx();
    const saved = await consumeLabInventory(tx, { ...request, overrideReason: "Emergency run; approved by pathologist" });

    expect(saved).toMatchObject({ overrideReason: "Emergency run; approved by pathologist" });
    expect(movementCreate.mock.calls.map(([call]) => [call.data.batchId, call.data.quantity])).toEqual([
      ["fresh-first", 2],
      ["fresh-next", 1],
      ["expired", 5],
    ]);
    expect(createConsumption).toHaveBeenCalledTimes(1);
    const details = createConsumption.mock.calls[0][0].data.details as Array<{ shortage: number; deducted: number }>;
    expect(details[0]).toMatchObject({ deducted: 8, shortage: 1 });
    await consumeLabInventory(tx, { ...request, overrideReason: "Duplicate save" });
    expect(createConsumption).toHaveBeenCalledTimes(1);
    expect(movementCreate).toHaveBeenCalledTimes(3);
  });
});
