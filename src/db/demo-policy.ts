/**
 * DEMO policy constants. Labeled DEMO — not a production calendar or jurisdiction.
 */

/** DEMO: 8.00h workday. */
export const DEMO_WORKDAY_MINUTES = 480;

/** DEMO: 17 vacation days × 480 min. */
export const DEMO_VACATION_DAYS = 17;
export const DEMO_VACATION_GRANT_MINUTES = DEMO_VACATION_DAYS * DEMO_WORKDAY_MINUTES; // 8160
export const DEMO_VACATION_TAKE_CEILING_MINUTES = DEMO_VACATION_GRANT_MINUTES;

/** DEMO: monthly slice of the 17-day grant (680 × 12 = 8160). */
export const DEMO_VACATION_PERIODIC_MINUTES = 680;

/** DEMO: 3 sick days × 480 min. */
export const DEMO_SICK_DAYS = 3;
export const DEMO_SICK_GRANT_MINUTES = DEMO_SICK_DAYS * DEMO_WORKDAY_MINUTES; // 1440

export const DEMO_MIN_INCREMENT_MINUTES = 60;

export const DEMO_ORG_NAME = "Absolute Addiction";
export const DEMO_VACATION_TYPE_CODE = "vacation_unpaid";
export const DEMO_VACATION_TYPE_NAME = "Vacation / Unpaid";
export const DEMO_VACATION_POLICY_NAME = "Vacation / Unpaid 17d monthly";
export const DEMO_SICK_TYPE_CODE = "sick";
export const DEMO_SICK_TYPE_NAME = "Sick";
export const DEMO_SICK_POLICY_NAME = "Sick 3d allotment";
export const DEMO_DEFAULT_ADMIN_EMAIL = "preston@absoluteaddiction.com";
export const DEMO_DEFAULT_OPERATORS = [
  { email: "preston@absoluteaddiction.com", name: "Preston" },
  { email: "das@absoluteaddiction.com", name: "Das" },
] as const;
