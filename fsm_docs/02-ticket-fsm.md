# Ticket FSM

## Lifecycle

ASSIGNED
-> ACCEPTED
-> IN_PROGRESS
-> COMPLETED

## Rules

- Only valid transitions are allowed.
- All transitions are audited.
- Completion requires checklist validation (mandatory fields must not be empty/false/whitespace).
- Completion may require mandatory photos.
- SLA timers use status timestamps.

## Metrics

Response Time:
Created -> ACCEPTED

Resolution Time:
Created -> COMPLETED

Labor Time:
IN_PROGRESS duration
