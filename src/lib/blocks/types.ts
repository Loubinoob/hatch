// ─── Block system type definitions ───────────────────────────────────────────

export type BlockType =
  | "hero"
  | "plans"
  | "features"
  | "testimonials"
  | "logos"
  | "comparison"
  | "faq"
  | "urgency"
  | "guarantee"
  | "video"
  | "stats"
  | "footer"

export type Block = {
  id: string                          // stable uuid
  type: BlockType
  props: Record<string, unknown>      // typed per block, see definitions.ts
}

export type DisplayMode = "modal" | "fullscreen"

/** Minimal theme passed alongside blocks for rendering */
export type BlockTheme = {
  accentColor: string
  fontFamily:  "system" | "serif" | "mono"
  buttonShape: "rounded" | "pill" | "square"
  overlayOpacity: number
}

// ─── Prop schema (for builder UI field generation) ────────────────────────────

export type PropFieldType =
  | "text"
  | "textarea"
  | "image_url"
  | "color"
  | "enum"
  | "boolean"
  | "number"
  | "items"       // array of objects — renders an "Add item" repeater

export type PropField = {
  key:         string
  label:       string
  type:        PropFieldType
  options?:    string[]          // for enum
  placeholder?: string
  itemSchema?: PropField[]       // for items[] repeater
}

export type BlockDefinition = {
  label:        string
  icon:         string           // emoji
  defaultProps: Record<string, unknown>
  propSchema:   PropField[]
}
