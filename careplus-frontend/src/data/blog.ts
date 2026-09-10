export interface BlogPost {
  id: string
  title: string
  excerpt: string
  content: string[]
  category: string
  author: string
  date: string
  readMinutes: number
}

export const blogPosts: BlogPost[] = [
  {
    id: "managing-hypertension-daily-life",
    title: "Managing Hypertension in Daily Life",
    excerpt:
      "Simple, sustainable habits that help keep blood pressure in a healthy range without upending your routine.",
    category: "Heart Health",
    author: "Dr. Ayesha Khan",
    date: "2026-07-02",
    readMinutes: 5,
    content: [
      "High blood pressure often has no symptoms, which is why regular checkups matter more than how you feel on a given day.",
      "Reducing salt intake, walking for 30 minutes most days, and limiting caffeine after noon are three changes that consistently move the needle for our patients.",
      "If you're on medication, take it at the same time each day — pairing it with an existing habit like breakfast makes it easier to remember.",
    ],
  },
  {
    id: "childhood-vaccination-schedule",
    title: "Understanding the Childhood Vaccination Schedule",
    excerpt:
      "A parent's guide to which vaccines matter when, and why staying on schedule protects your child long-term.",
    category: "Pediatrics",
    author: "Dr. Sana Malik",
    date: "2026-06-18",
    readMinutes: 6,
    content: [
      "Pakistan's Expanded Programme on Immunization covers the essential vaccines your child needs in the first two years of life.",
      "Delaying a dose doesn't reset the schedule, but it does leave a window of vulnerability — our pediatric team can help you catch up safely.",
      "Keep a physical or digital vaccination card and bring it to every visit, even ones unrelated to immunization.",
    ],
  },
  {
    id: "signs-you-shouldnt-ignore-stroke",
    title: "Stroke Warning Signs You Shouldn't Ignore",
    excerpt:
      "Recognizing the early signs of stroke and acting within the golden hour can be the difference in recovery outcomes.",
    category: "Neurology",
    author: "Dr. Imran Siddiqui",
    date: "2026-05-27",
    readMinutes: 4,
    content: [
      "The F.A.S.T. method — Face drooping, Arm weakness, Speech difficulty, Time to call emergency — remains the fastest way to recognize a stroke in progress.",
      "Every minute matters: brain cells begin dying within minutes of blood flow being cut off.",
      "If you notice sudden numbness, confusion, or trouble seeing, treat it as an emergency and come to our stroke unit immediately rather than waiting to see if it passes.",
    ],
  },
  {
    id: "post-surgery-recovery-tips",
    title: "Post-Surgery Recovery: What to Expect",
    excerpt:
      "A practical timeline for healing after common surgical procedures, and when to call your doctor.",
    category: "Surgery",
    author: "Dr. Zara Abbasi",
    date: "2026-05-10",
    readMinutes: 5,
    content: [
      "Most laparoscopic procedures allow patients to return to light activity within a week, though full recovery timelines vary by procedure.",
      "Watch your incision site for increasing redness, warmth, or discharge — these can be early signs of infection worth calling in about.",
      "Following your prescribed physiotherapy or movement plan speeds healing more reliably than resting completely still.",
    ],
  },
  {
    id: "protecting-your-eyesight-screens",
    title: "Protecting Your Eyesight in a Screen-Heavy World",
    excerpt:
      "Practical strategies to reduce digital eye strain for both adults and children.",
    category: "Eye Care",
    author: "Dr. Hina Raza",
    date: "2026-04-22",
    readMinutes: 4,
    content: [
      "The 20-20-20 rule — every 20 minutes, look at something 20 feet away for 20 seconds — remains the simplest defense against digital eye strain.",
      "Children are especially prone to reduced blinking during screen time, which dries out the eyes faster than adults realize.",
      "An annual eye exam catches most vision changes early, even if you feel your eyesight hasn't changed.",
    ],
  },
  {
    id: "living-well-with-asthma",
    title: "Living Well with Asthma",
    excerpt:
      "How to identify your asthma triggers and build a daily routine that keeps flare-ups rare.",
    category: "Respiratory",
    author: "Dr. Hamza Tariq",
    date: "2026-04-05",
    readMinutes: 5,
    content: [
      "Keeping a simple symptom diary for a few weeks often reveals patterns — dust, weather changes, or exertion — that patients hadn't connected before.",
      "A properly fitted inhaler technique matters as much as the medication itself; ask our team to review yours at your next visit.",
      "Peak flow monitoring at home gives an early warning before symptoms become severe enough to need urgent care.",
    ],
  },
]
