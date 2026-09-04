# Known issues

- Production Neon has not applied `0003` yet (prior CONNECT_TIMEOUT). Membership tables must exist before cutting over production.
- Parental leave wording remains gated (PTO-012).
- Approval workflow engine (Manager→Executive/HR steps), durable outbox worker wired into decide, MFA for privileged accounts, shared/platform rate limiting, and PITR restore drill are not production-complete.
- Holiday *generation* into org calendars is not yet a job; `officialAbsHolidayDates` is the date source.
