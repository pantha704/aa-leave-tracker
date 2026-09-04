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
export const DEMO_PTO_TYPE_CODE = "pto";
/** @deprecated Use DEMO_PTO_TYPE_CODE. Production seed/accrual use pto, not vacation_unpaid. */
export const DEMO_VACATION_TYPE_CODE = DEMO_PTO_TYPE_CODE;
export const DEMO_VACATION_TYPE_NAME = "PTO";
export const DEMO_VACATION_POLICY_NAME = "PTO 17d monthly";
export const DEMO_SICK_TYPE_CODE = "sick";
export const DEMO_SICK_TYPE_NAME = "Sick";
export const DEMO_SICK_POLICY_NAME = "Sick 3d allotment";
export const DEMO_LWOP_TYPE_CODE = "lwop";
export const DEMO_LWOP_TYPE_NAME = "Leave Without Pay";
export const DEMO_LWOP_POLICY_NAME = "LWOP unpaid";
/** PTO-012: parental types exist; production enablement stays gated. */
export const DEMO_MATERNITY_TYPE_CODE = "maternity";
export const DEMO_PATERNITY_TYPE_CODE = "paternity";
export const PARENTAL_LEAVE_PRODUCTION_ENABLED = false;
export const DEMO_PTO_CARRYOVER_MINUTES = 10 * DEMO_WORKDAY_MINUTES; // 4800
export const DEMO_NOTICE_CALENDAR_DAYS = 14;
export const DEMO_DEFAULT_ADMIN_EMAIL = "preston@absoluteaddiction.com";
export const DEMO_DEFAULT_OPERATORS = [
  { email: "preston@absoluteaddiction.com", name: "Preston" },
  { email: "das@absoluteaddiction.com", name: "Das" },
] as const;
