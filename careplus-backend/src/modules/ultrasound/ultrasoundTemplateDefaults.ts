export const ultrasoundTemplateDefaults = [
  {
    examinationType: "Obstetric",
    sections: [
      { key: "lmp", label: "LMP", type: "date" },
      { key: "edd", label: "EDD", type: "estimatedDueDate", calculatedFrom: "lmp" },
      { key: "gestationalAge", label: "Gestational age", type: "gestationalAge", calculatedFrom: "lmp" },
      { key: "fetalPresentation", label: "Fetal presentation", type: "text" },
      { key: "fetalHeartRate", label: "Fetal heart rate", type: "number", unit: "bpm" },
      { key: "liquorAfi", label: "Liquor / AFI", type: "text" },
      { key: "placentaPosition", label: "Placenta position", type: "text" },
      { key: "estimatedFetalWeight", label: "Estimated fetal weight", type: "number", unit: "g" },
      { key: "bpd", label: "BPD", type: "number", unit: "mm" },
      { key: "hc", label: "HC", type: "number", unit: "mm" },
      { key: "ac", label: "AC", type: "number", unit: "mm" },
      { key: "fl", label: "FL", type: "number", unit: "mm" },
    ],
  },
  {
    examinationType: "Abdomen",
    sections: ["Liver", "Gallbladder", "Pancreas", "Spleen", "Right kidney", "Left kidney", "Aorta", "Free fluid"].map((label) => ({
      key: label.toLowerCase().replaceAll(" ", "_"),
      label,
      type: "organ",
    })),
  },
  {
    examinationType: "KUB",
    sections: [
      { key: "rightKidney", label: "Right kidney", type: "organ" },
      { key: "leftKidney", label: "Left kidney", type: "organ" },
      { key: "ureters", label: "Ureters", type: "organ" },
      { key: "bladder", label: "Bladder", type: "organ" },
      { key: "prostate", label: "Prostate", type: "organ", patientGender: "MALE" },
      { key: "postVoidResidual", label: "Post-void residual", type: "number", unit: "ml" },
    ],
  },
  {
    examinationType: "Renal",
    sections: [
      { key: "rightKidney", label: "Right kidney", type: "organ" },
      { key: "leftKidney", label: "Left kidney", type: "organ" },
      { key: "collectingSystems", label: "Collecting systems", type: "organ" },
      { key: "ureters", label: "Ureters", type: "organ" },
      { key: "bladder", label: "Bladder", type: "organ" },
    ],
  },
  {
    examinationType: "Pelvis",
    sections: [
      { key: "uterus", label: "Uterus", type: "organ", patientGender: "FEMALE" },
      { key: "endometrium", label: "Endometrium", type: "organ", patientGender: "FEMALE" },
      { key: "rightOvary", label: "Right ovary", type: "organ", patientGender: "FEMALE" },
      { key: "leftOvary", label: "Left ovary", type: "organ", patientGender: "FEMALE" },
      { key: "prostate", label: "Prostate", type: "organ", patientGender: "MALE" },
      { key: "bladder", label: "Bladder", type: "organ" },
      { key: "freeFluid", label: "Free fluid", type: "organ" },
    ],
  },
  {
    examinationType: "Thyroid",
    sections: ["Right lobe", "Left lobe", "Isthmus", "Cervical lymph nodes"].map((label) => ({
      key: label.toLowerCase().replaceAll(" ", "_"),
      label,
      type: "organ",
    })),
  },
  {
    examinationType: "Breast",
    sections: ["Right breast", "Left breast", "Axillary lymph nodes"].map((label) => ({
      key: label.toLowerCase().replaceAll(" ", "_"),
      label,
      type: "organ",
    })),
  },
  {
    examinationType: "Doppler",
    sections: [
      { key: "vessel", label: "Vessel / region", type: "text" },
      { key: "flowPattern", label: "Flow pattern", type: "organ" },
      { key: "waveform", label: "Waveform", type: "organ" },
      { key: "peakSystolicVelocity", label: "Peak systolic velocity", type: "number", unit: "cm/s" },
      { key: "resistiveIndex", label: "Resistive index", type: "number" },
      { key: "additionalFindings", label: "Additional findings", type: "text" },
    ],
  },
  {
    examinationType: "Other",
    sections: [
      { key: "region", label: "Region / organ", type: "text" },
      { key: "observation", label: "Observation", type: "organ" },
      { key: "additionalFindings", label: "Additional findings", type: "text" },
    ],
  },
]
