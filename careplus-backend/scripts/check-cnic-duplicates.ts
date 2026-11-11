import { prisma } from "../src/config/prisma";

export interface DuplicateCnicPatient {
  id: string;
  mrNumber: string;
  name: string;
  dob: string | null;
  age: number | null;
  phone: string | null;
  lastVisit: string | null;
  createdAt: Date;
}

export interface DuplicateCnicGroup {
  normCnic: string;
  count: number;
  patients: DuplicateCnicPatient[];
}


export async function checkCnicDuplicates(): Promise<{
  hasDuplicates: boolean;
  duplicates: Array<{ norm_cnic: string; count: number; mrs: string[] }>;
  groups: DuplicateCnicGroup[];
}> {
  const { hasDuplicates, groups } = await getDuplicateCnicReport();
  const duplicates = groups.map((g) => ({
    norm_cnic: g.normCnic,
    count: g.count,
    mrs: g.patients.map((p) => p.mrNumber),
  }));
  return { hasDuplicates, duplicates, groups };
}

export async function getDuplicateCnicReport(): Promise<{ hasDuplicates: boolean; groups: DuplicateCnicGroup[] }> {
  // 1. Identify distinct normalized CNICs that have more than 1 patient record
  const duplicateGroups = await prisma.$queryRaw<Array<{ norm_cnic: string; count: number }>>`
    SELECT 
      regexp_replace(cnic, '\\D', '', 'g') AS norm_cnic, 
      count(*)::int AS count
    FROM "patients"
    WHERE cnic IS NOT NULL 
      AND "deleted_at" IS NULL 
      AND length(regexp_replace(cnic, '\\D', '', 'g')) > 0
    GROUP BY regexp_replace(cnic, '\\D', '', 'g')
    HAVING count(*) > 1;
  `;

  if (duplicateGroups.length === 0) {
    return { hasDuplicates: false, groups: [] };
  }

  // 2. Fetch full patient details for each group for human review
  const groups: DuplicateCnicGroup[] = [];

  for (const group of duplicateGroups) {
    const rawPatients = await prisma.$queryRaw<Array<{
      id: string;
      mr_number: string;
      name: string;
      dob: string | null;
      age: number | null;
      phone: string | null;
      last_visit: string | null;
      created_at: Date;
    }>>`
      SELECT 
        p.id,
        p.mr_number,
        TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS name,
        to_char(p.date_of_birth, 'YYYY-MM-DD') AS dob,
        p.age,
        p.phone,
        to_char(MAX(a.appointment_date), 'YYYY-MM-DD') AS last_visit,
        p.created_at
      FROM patients p
      LEFT JOIN appointments a ON a.patient_id = p.id
      WHERE regexp_replace(p.cnic, '\\D', '', 'g') = ${group.norm_cnic}
        AND p.deleted_at IS NULL
      GROUP BY p.id, p.mr_number, p.first_name, p.last_name, p.date_of_birth, p.age, p.phone, p.created_at
      ORDER BY MAX(a.appointment_date) DESC NULLS LAST, p.created_at ASC;
    `;

    groups.push({
      normCnic: group.norm_cnic,
      count: group.count,
      patients: rawPatients.map((p) => ({
        id: p.id,
        mrNumber: p.mr_number,
        name: p.name,
        dob: p.dob,
        age: p.age,
        phone: p.phone,
        lastVisit: p.last_visit,
        createdAt: p.created_at,
      })),
    });
  }

  return { hasDuplicates: true, groups };
}

async function main() {
  console.log("===============================================================================");
  console.log("CAREPLUS PRE-DEPLOYMENT AUDIT: PATIENT CNIC DUPLICATE CHECK (REPORT-ONLY)");
  console.log("===============================================================================");
  console.log("Scanning patient records for duplicate normalized CNICs...\n");

  const { hasDuplicates, groups } = await getDuplicateCnicReport();

  if (hasDuplicates) {
    console.error("===============================================================================");
    console.error("PRE-DEPLOYMENT CHECK FAILED: DUPLICATE CNIC GROUPS DETECTED");
    console.error("===============================================================================");
    console.error(`Found ${groups.length} duplicate CNIC group(s). No automated modifications were performed.\n`);

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      console.error(`Group ${i + 1}: Normalized CNIC '${g.normCnic}' (${g.count} patient records)`);
      console.error("-------------------------------------------------------------------------------");
      console.error("  MR Number      | Name                 | DOB/Age      | Phone        | Last Visit | Created At");
      console.error("-------------------------------------------------------------------------------");
      for (const p of g.patients) {
        const mr = p.mrNumber.padEnd(16, " ");
        const name = p.name.slice(0, 20).padEnd(20, " ");
        const dobAge = (p.dob ? p.dob : p.age ? `Age ${p.age}` : "N/A").padEnd(12, " ");
        const phone = (p.phone ?? "N/A").padEnd(12, " ");
        const visit = (p.lastVisit ?? "No visits").padEnd(10, " ");
        const created = p.createdAt.toISOString().slice(0, 10);
        console.error(`  ${mr} | ${name} | ${dobAge} | ${phone} | ${visit} | ${created} (ID: ${p.id})`);
      }
      console.error("-------------------------------------------------------------------------------");
    }

    console.error("\n===============================================================================");
    console.error("ACTION REQUIRED: MANUAL HUMAN REVIEW & RESOLUTION STEPS");
    console.error("===============================================================================");
    console.error("Automated scripts MUST NEVER arbitrarily mutate patient CNICs.");
    console.error("Hospital administrators or reception staff must review physical CNIC documentation.\n");
    console.error("Option A: If an incorrect CNIC was entered due to clerical typo:");
    console.error("  Execute a PATCH request to correct the specific patient's CNIC:");
    console.error("    PATCH /api/v1/patients/<patientId>");
    console.error('    Content-Type: application/json\n    { "cnic": "35201-1234567-1" }\n');
    console.error("Option B: If the duplicate represents a duplicate registration for the same human:");
    console.error("  Execute a merge request to consolidate records into the primary MR number:");
    console.error("    POST /api/v1/patients/merge");
    console.error('    Content-Type: application/json\n    { "sourcePatientId": "<duplicateId>", "targetPatientId": "<primaryId>" }\n');
    console.error("Option C: If database administrator intervention is authorized by Medical Records:");
    console.error("  Run SQL UPDATE on verified patient IDs after identity confirmation.\n");
    console.error("Once all duplicates are manually resolved, re-run this script.");
    console.error("Exiting with status code 1.\n");

    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("SUCCESS: 0 duplicate CNICs detected across all active patient records.");
  console.log("Unique constraint migration (20261031000000) is safe to deploy.");
  await prisma.$disconnect();
  process.exit(0);
}

if (require.main === module) {
  void main().catch(async (error) => {
    console.error("Fatal error during CNIC duplicate check:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
