export interface Doctor {
  id: string
  name: string
  departmentId?: string
  specialization?: string
  qualifications?: string
  experienceYears?: number
  languages?: string[]
  availability?: string[]
  rating?: number
  bio?: string
  photoSeed?: string
  photoUrl?: string
}

export const doctors: Doctor[] = []
