# Known issues

- Production Neon may still lack `0003`/`0004` (prior CONNECT_TIMEOUT). Apply membership + approval-stage migrations before cutting over production.
- Parental leave wording remains gated (`PARENTAL_LEAVE_PRODUCTION_ENABLED = false`, PTO-012).
- Holiday *generation* into org calendars is not yet a job; `officialAbsHolidayDates` is the date source.
- `LOGIN_RATE_LIMIT_DB=1` requires the `login_rate_limits` table; file-backed `LOGIN_RATE_LIMIT_FILE` is the implemented durable limiter. Production ready fails closed until one is set.
