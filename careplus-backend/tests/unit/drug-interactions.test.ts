import { findDrugInteractions } from "../../src/common/validation/drugInteractions";

describe("local prescription interaction checks", () => {
  it("returns a red warning for a high-risk medication pair", () => {
    expect(findDrugInteractions(["Warfarin 5 mg", "ibuprofen"])).toMatchObject([
      { severity: "RED", medicines: ["Warfarin 5 mg", "ibuprofen"] },
    ]);
  });

  it("returns amber warnings and ignores single medicines or unknown pairs", () => {
    expect(findDrugInteractions(["lisinopril", "spironolactone"])[0].severity).toBe("AMBER");
    expect(findDrugInteractions(["lisinopril"])).toEqual([]);
    expect(findDrugInteractions(["paracetamol", "amoxicillin"])).toEqual([]);
  });
});
