import { normalizeMedicineName } from "./prescription";

export interface DrugInteraction {
  medicines: [string, string];
  severity: "AMBER" | "RED";
  warning: string;
}

const INTERACTION_TABLE: DrugInteraction[] = [
  { medicines: ["warfarin", "ibuprofen"], severity: "RED", warning: "Increased bleeding risk." },
  { medicines: ["warfarin", "aspirin"], severity: "RED", warning: "Increased bleeding risk." },
  { medicines: ["sildenafil", "nitroglycerin"], severity: "RED", warning: "May cause a dangerous drop in blood pressure." },
  { medicines: ["lisinopril", "spironolactone"], severity: "AMBER", warning: "May increase potassium; monitor renal function and potassium." },
  { medicines: ["metformin", "alcohol"], severity: "AMBER", warning: "May increase the risk of lactic acidosis." },
  { medicines: ["ciprofloxacin", "warfarin"], severity: "AMBER", warning: "May increase anticoagulant effect; monitor INR." },
];

export function findDrugInteractions(medicineNames: string[]): DrugInteraction[] {
  const names = medicineNames.map((name) => ({ raw: name.trim(), normalized: normalizeMedicineName(name) })).filter((item) => item.normalized);
  return INTERACTION_TABLE.flatMap((interaction) => {
    const pairIndexes = interaction.medicines.map((term) =>
      names.findIndex((item) => item.normalized.includes(normalizeMedicineName(term))),
    );
    if (pairIndexes[0] < 0 || pairIndexes[1] < 0 || pairIndexes[0] === pairIndexes[1]) return [];
    return [{ ...interaction, medicines: [names[pairIndexes[0]].raw, names[pairIndexes[1]].raw] as [string, string] }];
  });
}
