import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { MessageCircle } from "lucide-react"

export function WhatsAppButton() {
  const reduce = useReducedMotion()
  const [bounced, setBounced] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setBounced(true), 1200)
    return () => clearTimeout(t)
  }, [])

  return (
    <motion.a
      href="https://wa.me/923211234567"
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with us on WhatsApp"
      initial={{ scale: 0, opacity: 0 }}
      animate={
        reduce
          ? { scale: 1, opacity: 1 }
          : bounced
          ? { scale: 1, opacity: 1, y: [0, -14, 0, -7, 0] }
          : { scale: 1, opacity: 1 }
      }
      transition={{ duration: 0.9, ease: "easeInOut" }}
      whileHover={{ scale: 1.06 }}
      className="no-print fixed bottom-5 left-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-care-hover"
    >
      <MessageCircle className="h-6 w-6" fill="white" />
    </motion.a>
  )
}
