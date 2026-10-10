import { searchIcd10 } from "../../src/common/validation/icd10";

describe("bundled ICD-10 search", () => {
  it("searches code and diagnosis text without an external service", () => {
    expect(searchIcd10("E11.9")).toEqual([
      { code: "E11.9", description: "Type 2 diabetes mellitus without complications" },
    ]);
    expect(searchIcd10("hypertension")[0].code).toBe("I10");
  });

  it("requires two characters and caps result counts", () => {
    expect(searchIcd10("E")).toEqual([]);
    expect(searchIcd10("e", 100)).toEqual([]);
    expect(searchIcd10("unspecified", 1)).toHaveLength(1);
  });
});
