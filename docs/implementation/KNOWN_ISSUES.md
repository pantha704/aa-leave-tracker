# Known issues

- Production Neon may still lack `0003`/`0004` (prior CONNECT_TIMEOUT). Apply membership + approval-stage migrations before cutting over production.
- Parental leave wording remains gated (`PARENTAL_LEAVE_PRODUCTION_ENABLED = false`, PTO-012).
- Holiday *generation* into org calendars is not yet a job; `officialAbsHolidayDates` is the date source.
- Production login throttle uses `LOGIN_RATE_LIMIT_FILE` or the `login_rate_limits` table (`consumeLoginThrottle`). Production ready fails closed until a durable store is configured.
