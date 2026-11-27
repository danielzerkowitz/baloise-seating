import type { Area, AreaKind } from './types'

/** The seating areas of floor 4, traced from the supplied floor plan (2000 x 710 px).
 *
 *  Seat counts are the chairs drawn on the plan, counted four times independently with the
 *  same result: 66 regular desks. Names follow the position on the drawing with the top
 *  edge read as north; they are placeholders until the office's own names are known. */

export const FLOOR4_PLAN_SIZE = { width: 2000, height: 710 } as const

const round = (n: number) => Math.round(n * 10000) / 10000

/** `x, y, w, h` in pixels of the drawing, tight around the furniture including chairs;
 *  `pad` adds a little air so the outline does not touch the chairs. */
function area(
  id: string,
  name: string,
  kind: AreaKind,
  capacity: number,
  x: number,
  y: number,
  w: number,
  h: number,
  pad = 3,
): Area {
  const { width, height } = FLOOR4_PLAN_SIZE
  return {
    id: `f4-${id}`,
    name,
    kind,
    capacity,
    rect: {
      x: round((x - pad) / width),
      y: round((y - pad) / height),
      w: round((w + 2 * pad) / width),
      h: round((h + 2 * pad) / height),
    },
  }
}

export const FLOOR4_AREAS: Area[] = [
  // Regular desks: 66 workplaces in 18 clusters.
  // North-west team zone (semi-enclosed): two benches of six.
  area('nw1', 'NW 1', 'desks', 6, 55, 73, 155, 105),
  area('nw2', 'NW 2', 'desks', 6, 55, 209, 155, 105),
  // North row, west of the meeting rooms.
  area('n1', 'N 1', 'desks', 4, 416, 50, 111, 120),
  area('n2', 'N 2', 'desks', 4, 557, 50, 113, 120),
  area('n3', 'N 3', 'desks', 4, 700, 50, 113, 120),
  // North-east row.
  area('ne1', 'NE 1', 'desks', 4, 1434, 50, 112, 120),
  area('ne2', 'NE 2', 'desks', 2, 1571, 50, 113, 62),
  area('ne3', 'NE 3', 'desks', 4, 1709, 50, 113, 120),
  area('ne4', 'NE 4', 'desks', 4, 1845, 50, 114, 120),
  // South-east row.
  area('se1', 'SE 1', 'desks', 4, 1295, 539, 113, 119),
  area('se2', 'SE 2', 'desks', 4, 1432, 539, 113, 119),
  area('se3', 'SE 3', 'desks', 2, 1570, 596, 113, 62),
  area('se4', 'SE 4', 'desks', 4, 1708, 539, 113, 119),
  area('se5', 'SE 5', 'desks', 4, 1845, 539, 112, 119),
  // South-west.
  area('sw1', 'SW 1', 'desks', 4, 52, 395, 121, 113),
  area('sw2', 'SW 2', 'desks', 2, 224, 395, 60, 113),
  area('sw3', 'SW 3', 'desks', 2, 57, 535, 112, 61),
  area('sw4', 'SW 4', 'desks', 2, 199, 535, 112, 61),

  // Overflow: touchdown counters and the open collaboration tables (32 seats).
  area('bench', 'Touchdown bench', 'overflow', 5, 41, 638, 262, 48),
  area('hub-counter', 'Hub counter', 'overflow', 4, 1692, 264, 45, 178, 2),
  area('collab-n', 'Collab north', 'overflow', 6, 1146, 28, 262, 166, 0),
  area('collab-sw', 'Collab Lage tafel', 'overflow', 9, 407, 515, 309, 166, 0),
  area('open-table', 'Open table', 'overflow', 8, 924, 516, 86, 148),

  // Never seating: enclosed rooms and pods.
  area('room-47', 'Meeting room 4.7', 'no-seating', 6, 861, 25, 138, 174, 0),
  area('room-46', 'Meeting room 4.6', 'no-seating', 6, 1002, 25, 137, 174, 0),
  area('room-41', 'Meeting room 4.1', 'no-seating', 8, 723, 492, 136, 194, 0),
  area('room-42', 'Meeting room 4.2', 'no-seating', 8, 1139, 492, 137, 194, 0),
  area('agile-room', 'Agile room', 'no-seating', 9, 1456, 274, 234, 160, 0),
  area('room-east', 'Small meeting room', 'no-seating', 4, 1836, 262, 140, 90, 0),
  area('lounge-room', 'Lounge room', 'no-seating', 3, 1836, 355, 140, 90, 0),
  area('pod-w1', 'Pod west 1', 'no-seating', 2, 412, 269, 46, 84, 0),
  area('pod-w2', 'Pod west 2', 'no-seating', 2, 412, 355, 46, 86, 0),
  area('pod-ne', 'Pod north-east', 'no-seating', 2, 1584, 122, 87, 49, 0),
  area('pod-se', 'Pod south-east', 'no-seating', 2, 1584, 520, 87, 48, 0),
]
