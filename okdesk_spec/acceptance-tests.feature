Feature: Ticket lifecycle

Scenario: Complete ticket
  Given mandatory checklist is completed
  When engineer closes ticket
  Then status becomes COMPLETED

Scenario: Reject completion
  Given mandatory photo is missing
  When engineer closes ticket
  Then validation error is returned
