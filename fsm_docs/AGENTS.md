# AGENTS

Read all files before making changes.

Never invent business rules.

When information is missing:
- ask questions
- document assumptions

Architecture:
- Modular monolith
- FastAPI
- PostgreSQL
- React
- Redis

Constraints:
- Status changes only through FSM.
- Inventory changes only through accounting documents.
- Business logic must not exist in controllers.

Before generating code:
1. Review requirements.
2. Review domain model.
3. Review FSM.
4. Review ACL.
