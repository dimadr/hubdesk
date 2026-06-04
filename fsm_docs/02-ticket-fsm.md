# Ticket FSM

## Lifecycle

ASSIGNED
-> ACCEPTED
-> ON_THE_WAY
-> ARRIVED
-> IN_PROGRESS
-> REVIEW
-> COMPLETED

## Rules

- Only valid transitions are allowed.
- All transitions are audited.
- Completion requires checklist validation.
- Completion may require mandatory photos.
- SLA timers use status timestamps.

## Metrics

Response Time:
Created -> ACCEPTED

Resolution Time:
Created -> COMPLETED

Labor Time:
IN_PROGRESS duration
