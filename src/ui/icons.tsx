import type { ReactNode, SVGProps } from 'react'

/** Shared line icons: 16px grid, 1.6px stroke, inherit the text colour. Decorative by
 *  default (aria-hidden); pass `title` when an icon stands alone without a text label. */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { title?: string }

function Icon({ title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
)

export const IconMinus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8h10" />
  </Icon>
)

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  </Icon>
)

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.5h6.8l.6-8.5M6.7 7v3.5M9.3 7v3.5" />
  </Icon>
)

export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.8 2.7l2.5 2.5L5.5 13H3v-2.5l7.8-7.8zM9.3 4.2l2.5 2.5" />
  </Icon>
)

export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 5.5v-3h-8v8h3" />
  </Icon>
)

export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3L2.5 6l3 3" />
    <path d="M2.5 6h6.7a4 4 0 010 8H6" />
  </Icon>
)

export const IconRedo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.5 3l3 3-3 3" />
    <path d="M13.5 6H6.8a4 4 0 000 8H10" />
  </Icon>
)

/** A hard conflict. */
export const IconError = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.4 1.8h5.2l3.6 3.6v5.2l-3.6 3.6H5.4l-3.6-3.6V5.4z" />
    <path d="M8 4.8v3.8M8 11.1v.1" />
  </Icon>
)

/** A soft warning. */
export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.2l6.2 11H1.8z" />
    <path d="M8 6.5v3.2M8 11.6v.1" />
  </Icon>
)

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.3v3.9M8 4.8v.1" />
  </Icon>
)

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v8M4.8 7.6L8 10.8l3.2-3.2M2.5 13.5h11" />
  </Icon>
)

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 10.8v-8M4.8 5.7L8 2.5l3.2 3.2M2.5 13.5h11" />
  </Icon>
)

export const IconPrint = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 5.5v-3h7v3M4.5 11.5h-2v-6h11v6h-2" />
    <rect x="4.5" y="9" width="7" height="4.5" />
  </Icon>
)

export const IconZoomIn = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4l3.1 3.1M7 5v4M5 7h4" />
  </Icon>
)

export const IconZoomOut = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4l3.1 3.1M5 7h4" />
  </Icon>
)

/** Fit the plan to the available space. */
export const IconFit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
)

/** Automatic suggestions. */
export const IconWand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 13.5l7.5-7.5M11.5 2v2.4M11.5 7.6V10M7.5 6h2.4M13.1 6h2.4" transform="translate(-1 0)" />
  </Icon>
)

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </Icon>
)

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
)

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </Icon>
)

export const IconDots = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 8h.1M8 8h.1M12.5 8h.1" strokeWidth="2.2" />
  </Icon>
)

export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="5.5" r="2.3" />
    <path d="M1.8 13.2c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M10.6 3.4a2.3 2.3 0 010 4.3M12.2 9.9c1.1.6 1.8 1.7 2 3.3" />
  </Icon>
)

/** Floors of a building. */
export const IconLayers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.2l6 3.1-6 3.1-6-3.1zM2 8.2l6 3.1 6-3.1M2 11l6 3.1 6-3.1" />
  </Icon>
)

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
    <path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" />
  </Icon>
)

/** Jump to a place on the plan. */
export const IconLocate = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="4.2" />
    <path d="M8 1.5v2.3M8 12.2v2.3M1.5 8h2.3M12.2 8h2.3" />
  </Icon>
)

export const IconImage = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <path d="M2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5" />
    <circle cx="10.6" cy="5.9" r="0.9" />
  </Icon>
)

/** Select and move areas. */
export const IconCursor = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 2.5l9 4.6-3.8 1.3-1.4 3.9z" />
  </Icon>
)

/** Draw a new seating area. */
export const IconDrawArea = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 5V2.5H5M7 2.5h2M11 2.5h2.5V5M13.5 7v2M2.5 7v2M2.5 11v2.5H5M7 13.5h2M13.5 11v2.5H11" />
  </Icon>
)

export const IconFile = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />
  </Icon>
)

/** Move something to another day or place. */
export const IconSwap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />
  </Icon>
)

/** A workplace: desk seen from above with its chair. */
export const IconDesk = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="3" width="11" height="5.5" rx="0.6" />
    <path d="M5.8 11.2a2.2 2.2 0 014.4 0v1.8H5.8z" />
  </Icon>
)

export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" />
  </Icon>
)

export const IconUnlock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5.2a2.5 2.5 0 014.6-1.3" />
  </Icon>
)

export const IconTable = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <path d="M2.5 6.5h11M2.5 9.8h11M6.5 3v10" />
  </Icon>
)

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.9" />
  </Icon>
)

export const IconHelp = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.2 6.3a1.9 1.9 0 113 1.5c-.7.5-1.2.9-1.2 1.7M8 11.6v.1" />
  </Icon>
)
