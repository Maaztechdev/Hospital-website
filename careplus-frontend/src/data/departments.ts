import type { LucideIcon } from "lucide-react"
import {
  HeartPulse, Brain, Bone, Baby, Eye, Stethoscope,
  Syringe, Activity, Ear, Pill,
} from "lucide-react"

export interface Department {
  id: string
  name: string
  icon: LucideIcon
  summary: string
  description: string
  services: string[]
  doctorCount: number
  image: string
}

export const departments: Department[] = [
  {
    id: "cardiology",
    name: "Cardiology",
    icon: HeartPulse,
    summary: "Heart care from routine screening to advanced cardiac surgery.",
    description:
      "Our Cardiology unit diagnoses and treats conditions of the heart and blood vessels, combining non-invasive diagnostics with a dedicated cath lab for interventional procedures.",
    services: ["ECG & Echocardiography", "Angiography", "Cardiac Surgery", "Hypertension Clinic"],
    doctorCount: 6,
    image: "cardiology",
  },
  {
    id: "neurology",
    name: "Neurology",
    icon: Brain,
    summary: "Diagnosis and treatment of brain, spine and nerve disorders.",
    description:
      "The Neurology department manages stroke, epilepsy, migraine and movement disorders with EEG, EMG and a dedicated stroke response protocol.",
    services: ["EEG & EMG", "Stroke Unit", "Epilepsy Clinic", "Nerve Conduction Studies"],
    doctorCount: 4,
    image: "neurology",
  },
  {
    id: "orthopedics",
    name: "Orthopedics",
    icon: Bone,
    summary: "Bone, joint and sports injury care with in-house physiotherapy.",
    description:
      "From fractures to joint replacements, our orthopedic team pairs surgical expertise with a full physiotherapy and rehabilitation program.",
    services: ["Joint Replacement", "Sports Injury", "Spine Care", "Physiotherapy"],
    doctorCount: 5,
    image: "orthopedics",
  },
  {
    id: "pediatrics",
    name: "Pediatrics",
    icon: Baby,
    summary: "Newborn to teen care in a calm, child-friendly environment.",
    description:
      "Our pediatric team covers routine immunization, growth monitoring and treatment of childhood illness, with a NICU for critical newborn care.",
    services: ["Immunization", "NICU", "Growth Monitoring", "Pediatric Emergency"],
    doctorCount: 7,
    image: "pediatrics",
  },
  {
    id: "ophthalmology",
    name: "Ophthalmology",
    icon: Eye,
    summary: "Complete eye care, from vision testing to cataract surgery.",
    description:
      "We offer comprehensive eye examinations, laser vision correction and cataract surgery using modern phacoemulsification technique.",
    services: ["Cataract Surgery", "LASIK", "Retina Clinic", "Pediatric Eye Care"],
    doctorCount: 3,
    image: "ophthalmology",
  },
  {
    id: "general-medicine",
    name: "General Medicine",
    icon: Stethoscope,
    summary: "Everyday illness, chronic disease management and checkups.",
    description:
      "Our internal medicine physicians manage diabetes, hypertension, infections and routine annual health checkups for adults.",
    services: ["Diabetes Clinic", "Annual Checkup", "Chronic Disease Care", "Vaccination"],
    doctorCount: 8,
    image: "general-medicine",
  },
  {
    id: "surgery",
    name: "General Surgery",
    icon: Syringe,
    summary: "Elective and emergency surgical procedures.",
    description:
      "Equipped with modern operating theatres, our surgical team performs a wide range of procedures from appendectomy to laparoscopic surgery.",
    services: ["Laparoscopic Surgery", "Emergency Surgery", "Hernia Repair", "Day Surgery"],
    doctorCount: 5,
    image: "surgery",
  },
  {
    id: "pulmonology",
    name: "Pulmonology",
    icon: Activity,
    summary: "Respiratory and lung care, including sleep studies.",
    description:
      "We diagnose and manage asthma, COPD and sleep-related breathing disorders with in-house pulmonary function testing.",
    services: ["Asthma Clinic", "Sleep Study", "PFT Testing", "TB Treatment"],
    doctorCount: 3,
    image: "pulmonology",
  },
  {
    id: "ent",
    name: "ENT",
    icon: Ear,
    summary: "Ear, nose and throat conditions for all ages.",
    description:
      "Our ENT specialists treat hearing loss, sinus conditions and throat disorders with in-house audiometry.",
    services: ["Audiometry", "Sinus Surgery", "Tonsillectomy", "Hearing Aid Fitting"],
    doctorCount: 3,
    image: "ent",
  },
  {
    id: "pharmacy",
    name: "In-House Pharmacy",
    icon: Pill,
    summary: "24/7 pharmacy stocked with prescription and OTC medicine.",
    description:
      "Our licensed pharmacy team dispenses prescriptions on-site and offers medicine counseling for inpatients and outpatients alike.",
    services: ["24/7 Dispensing", "Medicine Counseling", "Home Delivery", "Insurance Billing"],
    doctorCount: 4,
    image: "pharmacy",
  },
]
