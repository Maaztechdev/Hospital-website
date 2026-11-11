/**
 * CarePlus Centralized Print Utility
 * Handles font loading, image decoding, DOM layout stability, and print triggers
 * across all hospital modules without blank pages, clipping, or race conditions.
 */

export interface PrintOptions {
  title?: string
  beforePrint?: () => void | Promise<void>
  afterPrint?: () => void
}

/**
 * Ensures all fonts and images within a target container are fully loaded and decoded
 * before invoking window.print().
 */
export async function printElement(
  target: string | HTMLElement,
  options: PrintOptions = {}
): Promise<void> {
  const element = typeof target === "string" ? document.getElementById(target) : target

  if (!element) {
    throw new Error(`Print target element "${typeof target === "string" ? target : "node"}" not found in DOM`)
  }

  const targetId = element.id || (typeof target === "string" ? target : "careplus-print-root")
  document.body.setAttribute("data-careplus-printing", targetId)

  const cleanupPrintingState = () => {
    document.body.removeAttribute("data-careplus-printing")
  }

  window.addEventListener("afterprint", cleanupPrintingState, { once: true })

  if (options.title) {
    const originalTitle = document.title
    document.title = options.title
    window.addEventListener(
      "afterprint",
      () => {
        document.title = originalTitle
      },
      { once: true }
    )
  }

  if (options.beforePrint) {
    await options.beforePrint()
  }

  // 1. Wait for document fonts to finish loading
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready
    } catch {
      // ignore font loading timeouts
    }
  }

  // 2. Wait for all <img> tags within the target element to load and decode
  const images = Array.from(element.querySelectorAll("img"))
  if (images.length > 0) {
    await Promise.all(
      images.map(async (img) => {
        if (!img.src) return
        if (img.complete && img.naturalWidth > 0) {
          try {
            await img.decode()
          } catch {
            // decoding can fail on corrupted images, proceed anyway
          }
          return
        }
        await new Promise<void>((resolve) => {
          const onDone = () => {
            img.removeEventListener("load", onDone)
            img.removeEventListener("error", onDone)
            resolve()
          }
          img.addEventListener("load", onDone, { once: true })
          img.addEventListener("error", onDone, { once: true })
        })
      })
    )
  }

  // 3. Allow browser layout engine two animation frames to calculate geometry
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  })

  // 4. Attach afterprint callback if provided
  if (options.afterPrint) {
    window.addEventListener("afterprint", options.afterPrint, { once: true })
  }

  // 5. Trigger print dialog
  window.print()
}
